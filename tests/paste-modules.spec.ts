import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    Module slot positions through paste-settings (issue #100).

    `Entity.modules` is positional - one entry per slot, undefined for an empty
    one - and everything that touches it keeps it that way. `get modules` places
    each module by its `in_inventory` stack, `set modules` writes `stack: i` from
    the array index, and the `Modules` UI component assigns `m_Modules[index]`
    and writes the whole array back.

    `Entity.pasteSettings` was the exception. It copied modules with a filter:

        sourceEntity.modules.filter(m => m !== undefined && aM.includes(m))

    which drops the empty slots rather than preserving them, so every module
    behind a gap shifted left. Measured before the fix, with a source holding
    two speed modules in stacks 2 and 3:

        source [null, null, "speed-module-3", "speed-module-3"]
        target ["speed-module-3", "speed-module-3", null, null]

    Nothing asserted anything about module positions, which is why it survived:
    every count, set and round-trip of that paste is identical either way.

    What this is *not* is a gameplay bug - Factorio applies every module in a
    machine whichever slot it sits in. What differs is the blueprint that comes
    out and what the module dialog shows.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/* inventory 4 is the module inventory for these machines - the index
   `getModuleInventoryIndex` answers, and what `get modules` matches on. */
const MODULE_INVENTORY = 4

const BLUEPRINT = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'assembling-machine-3' } }],
    entities: [
        /*
            1 is the position source: four module slots with the two modules at
            the *back*, so compacting them is visible as a move to the front
            rather than as no change.
        */
        {
            entity_number: 1,
            name: 'assembling-machine-3',
            position: { x: 1.5, y: 1.5 },
            items: [
                {
                    id: { name: 'speed-module-3' },
                    items: {
                        in_inventory: [
                            { inventory: MODULE_INVENTORY, stack: 2 },
                            { inventory: MODULE_INVENTORY, stack: 3 },
                        ],
                    },
                },
            ],
        },
        { entity_number: 2, name: 'assembling-machine-3', position: { x: 5.5, y: 1.5 } },
        /*
            3 holds its modules in the back slots like 1 does, and 4 is an
            assembling-machine-2, which has two module slots where a 3 has four.
            Same `type`, which paste requires - see the note on the test.
        */
        {
            entity_number: 3,
            name: 'assembling-machine-3',
            position: { x: 9.5, y: 1.5 },
            items: [
                {
                    id: { name: 'speed-module-3' },
                    items: {
                        in_inventory: [
                            { inventory: MODULE_INVENTORY, stack: 2 },
                            { inventory: MODULE_INVENTORY, stack: 3 },
                        ],
                    },
                },
            ],
        },
        { entity_number: 4, name: 'assembling-machine-2', position: { x: 13.5, y: 1.5 } },
        /*
            5 and 6 are the control: a full source, where compacting and
            preserving produce the same answer. If this one ever fails, the
            paste is broken outright rather than merely misplacing things.
        */
        {
            entity_number: 5,
            name: 'assembling-machine-3',
            position: { x: 17.5, y: 1.5 },
            items: [
                {
                    id: { name: 'speed-module-3' },
                    items: {
                        in_inventory: [
                            { inventory: MODULE_INVENTORY, stack: 0 },
                            { inventory: MODULE_INVENTORY, stack: 1 },
                            { inventory: MODULE_INVENTORY, stack: 2 },
                            { inventory: MODULE_INVENTORY, stack: 3 },
                        ],
                    },
                },
            ],
        },
        { entity_number: 6, name: 'assembling-machine-3', position: { x: 21.5, y: 1.5 } },
    ],
})

async function loadMachines(page: Page): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, BLUEPRINT)
    return errors
}

const modulesOf = (page: Page, entityNumber: number): Promise<(string | undefined)[]> =>
    page.evaluate((n: number) => window.__fbe_test.entityModules(n), entityNumber)

/** Copies settings off one entity and pastes them onto another, with real input. */
async function pasteSettings(page: Page, from: number, to: number): Promise<void> {
    const source = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        from
    )
    const target = await page.evaluate((n: number) => window.__fbe_test.entityScreenPosition(n), to)
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

test('pasted modules land in the slots they came from', async ({ page }) => {
    const errors = await loadMachines(page)

    // The source's own reading, so a failure here is the getter rather than the
    // paste - they are different bugs and the assertion should say which.
    expect(await modulesOf(page, 1)).toEqual([
        undefined,
        undefined,
        'speed-module-3',
        'speed-module-3',
    ])

    await pasteSettings(page, 1, 2)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(await modulesOf(page, 2)).toEqual([
        undefined,
        undefined,
        'speed-module-3',
        'speed-module-3',
    ])
})

test('modules past the end of a smaller target are dropped, not moved forward', async ({
    page,
}) => {
    /*
        A deliberate consequence of preserving positions, pinned here so it is a
        decision on the record rather than something discovered later.

        `pasteSettings` slices to the target's slot count. Keeping positions
        means a module in slot 3 of a four-slot machine falls outside a two-slot
        one and is lost; the old compacting code would have moved it forward and
        kept it. Neither is obviously right - this way a pasted machine looks
        like the one it was copied from, that way nothing is dropped - and the
        common case, pasting between two machines of the same kind, is identical
        either way. Preserving positions is the choice, and this is its cost.

        Note the pair has to share `type`: `canPasteSettings` refuses anything
        else, which is why this is an assembling-machine-2 rather than the
        beacon a first draft of this spec reached for.
    */
    const errors = await loadMachines(page)
    expect(await modulesOf(page, 3)).toEqual([
        undefined,
        undefined,
        'speed-module-3',
        'speed-module-3',
    ])

    await pasteSettings(page, 3, 4)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(await modulesOf(page, 4)).toEqual([undefined, undefined])
})

test('a full set of modules pastes unchanged', async ({ page }) => {
    /*
        The control. With no empty slots, compacting and preserving agree, so
        this passed before the fix and has to go on passing after it - it is
        what separates "modules moved" from "modules stopped being copied".
    */
    await loadMachines(page)

    await pasteSettings(page, 5, 6)

    expect(await modulesOf(page, 6)).toEqual([
        'speed-module-3',
        'speed-module-3',
        'speed-module-3',
        'speed-module-3',
    ])
})
