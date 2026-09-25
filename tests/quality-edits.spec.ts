import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    Quality through an edit, not just through a load. The badges in
    tests/quality-badges.spec.ts read quality off the blueprint, and every test
    there loads one and looks. None of them writes, so a setter that drops
    quality on the way through passed them all - and since the badge reads the
    same raw data the export does, a dropped quality is lost from the saved
    blueprint, not just from the screen (PR #504 review).

    Each test here makes one edit and then reads the exported blueprint back.
*/

type Page = import('@playwright/test').Page

// The module inventory of an assembling machine 3, as quality-badges.spec.ts uses it.
const MODULE_INVENTORY = 4

const slots = (stacks: number[]) => ({
    in_inventory: stacks.map(stack => ({ inventory: MODULE_INVENTORY, stack })),
})

const BLUEPRINT = encodeBlueprint({
    item: 'blueprint',
    version: packVersion(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'assembling-machine-3',
            position: { x: 1.5, y: 1.5 },
            items: [
                {
                    id: { name: 'speed-module-3', quality: 'legendary' },
                    items: slots([0, 1, 2, 3]),
                },
            ],
        },
        // The same module name at two qualities, which must stay two entries.
        {
            entity_number: 2,
            name: 'assembling-machine-3',
            position: { x: 5.5, y: 1.5 },
            items: [
                { id: { name: 'speed-module-3', quality: 'legendary' }, items: slots([0]) },
                { id: { name: 'speed-module-3', quality: 'rare' }, items: slots([1]) },
            ],
        },
        // An empty machine to paste onto.
        { entity_number: 3, name: 'assembling-machine-3', position: { x: 9.5, y: 1.5 } },
        /*
            The splitters sit on a second row, near the left. One drawn toward
            the right of the screen could not be hovered reliably, on the base
            branch as well, and a copy that never starts pastes nothing.
        */
        {
            entity_number: 4,
            name: 'splitter',
            position: { x: 2, y: 6.5 },
            output_priority: 'left',
            filter: { name: 'iron-plate', quality: 'legendary' },
        },
        { entity_number: 5, name: 'splitter', position: { x: 6, y: 6.5 } },
        {
            entity_number: 6,
            name: 'fast-inserter',
            position: { x: 9.5, y: 6.5 },
            use_filters: true,
            filters: [
                { index: 1, name: 'iron-plate', quality: 'legendary' },
                { index: 2, name: 'copper-plate', quality: 'rare', comparator: '>' },
            ],
        },
    ],
})

async function exportedEntity(page: Page, entityNumber: number) {
    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const { entities } = decodeBlueprintString(source).blueprint
    return entities.find((e: { entity_number: number }) => e.entity_number === entityNumber)
}

/** Each module slot's item as the exported blueprint holds it. */
async function exportedModuleSlots(page: Page, entityNumber: number) {
    const entity = await exportedEntity(page, entityNumber)
    const out: ({ name: string; quality?: string } | undefined)[] = Array.from({ length: 4 })
    for (const item of entity.items ?? []) {
        for (const inv of item.items.in_inventory ?? []) {
            if (inv.inventory === MODULE_INVENTORY) out[inv.stack] = item.id
        }
    }
    return out
}

/** Copies settings off one entity and pastes them onto another, with real input. */
async function pasteSettings(page: Page, from: number, to: number): Promise<void> {
    const source = await page.evaluate(n => window.__fbe_test.entityScreenPosition(n), from)
    const target = await page.evaluate(n => window.__fbe_test.entityScreenPosition(n), to)
    if (!source || !target) throw new Error(`no entity ${from} or ${to} in the loaded blueprint`)

    await page.mouse.move(source.x, source.y)
    await page.keyboard.down('Shift')
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
}

let errors: string[] = []

test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, BLUEPRINT)
})

test.afterEach(() => {
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

const LEGENDARY_SPEED = { name: 'speed-module-3', quality: 'legendary' }

test('changing one module keeps the quality of the slots left alone', async ({ page }) => {
    // What the module dialog sends: every slot's name, one of them changed.
    await page.evaluate(() =>
        window.__fbe_test.setEntityModules(1, [
            'efficiency-module-3',
            'speed-module-3',
            'speed-module-3',
            'speed-module-3',
        ])
    )
    expect(await exportedModuleSlots(page, 1)).toEqual([
        // The changed slot has no quality to keep: the dialog cannot pick one.
        { name: 'efficiency-module-3' },
        LEGENDARY_SPEED,
        LEGENDARY_SPEED,
        LEGENDARY_SPEED,
    ])
    // And the badges still draw, since they read the same data.
    const badges = await page.evaluate(() => window.__fbe_test.qualityBadgeFrames(1))
    expect(badges?.map(b => b.quality)).toEqual(['legendary', 'legendary', 'legendary'])
})

test('one module name at two qualities stays two entries after an edit', async ({ page }) => {
    await page.evaluate(() =>
        window.__fbe_test.setEntityModules(2, [
            'speed-module-3',
            'speed-module-3',
            'speed-module-3',
            undefined,
        ])
    )
    expect(await exportedModuleSlots(page, 2)).toEqual([
        LEGENDARY_SPEED,
        { name: 'speed-module-3', quality: 'rare' },
        { name: 'speed-module-3' },
        undefined,
    ])
})

test('pasted modules keep their quality', async ({ page }) => {
    await pasteSettings(page, 1, 3)
    expect(await exportedModuleSlots(page, 3)).toEqual([
        LEGENDARY_SPEED,
        LEGENDARY_SPEED,
        LEGENDARY_SPEED,
        LEGENDARY_SPEED,
    ])
})

test('a pasted splitter filter keeps its quality', async ({ page }) => {
    await pasteSettings(page, 4, 5)
    expect((await exportedEntity(page, 5)).filter).toEqual({
        name: 'iron-plate',
        quality: 'legendary',
    })
    const badges = await page.evaluate(() => window.__fbe_test.qualityBadgeFrames(5))
    expect(badges?.map(b => b.quality)).toEqual(['legendary'])
})

test('changing one inserter filter keeps the quality of the others', async ({ page }) => {
    // What the filter dialog sends: every slot's index, name and count, with
    // no quality, because it has no way to show one.
    await page.evaluate(() =>
        window.__fbe_test.setEntityFilters(6, [
            { index: 1, name: 'iron-plate', count: undefined },
            { index: 2, name: 'copper-plate', count: undefined },
            { index: 3, name: 'coal', count: undefined },
        ])
    )
    expect((await exportedEntity(page, 6)).filters).toEqual([
        { index: 1, name: 'iron-plate', quality: 'legendary' },
        { index: 2, name: 'copper-plate', quality: 'rare', comparator: '>' },
        { index: 3, name: 'coal' },
    ])
})
