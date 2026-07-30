import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString as decode,
    encodeBlueprint as encode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

type Page = import('@playwright/test').Page

/*
    Two curved-rail-a entities two tiles apart. Factorio accepts the pair, but
    the editor models each as a 2x6 rectangle, so their grid footprints overlap.
*/
const OVERLAPPING_CURVED_RAILS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'curved-rail-a', position: { x: 0, y: 0 }, direction: 0 },
        { entity_number: 2, name: 'curved-rail-a', position: { x: 0, y: 2 }, direction: 0 },
    ],
})

const FAST_REPLACE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'iron-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 4.5, y: 0.5 } },
    ],
})

const ROTATE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'fast-inserter',
            position: { x: 0.5, y: 0.5 },
            direction: 4,
        },
        { entity_number: 2, name: 'fast-inserter', position: { x: 4.5, y: 0.5 } },
    ],
})

const entityCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.entityContainerCount())

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

async function load(page: Page, source: string): Promise<void> {
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, source)
}

/** Ctrl-drags over the numbered range, leaving its entities in PAINT. */
async function copyIntoPaint(page: Page, firstNumber: number, lastNumber: number): Promise<void> {
    const first = await screenOf(page, firstNumber)
    const last = await screenOf(page, lastNumber)
    await page.mouse.move(first.x, first.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(
        last.x + (firstNumber === lastNumber ? 4 : 0),
        last.y + (firstNumber === lastNumber ? 4 : 0)
    )
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('PAINT')
}

async function serializedEntity(page: Page, entityNumber: number): Promise<any> {
    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decode(source).blueprint.entities as any[]
    const entity = entities.find(e => e.entity_number === entityNumber)
    if (!entity) throw new Error(`entity ${entityNumber} is not in the serialized blueprint`)
    return entity
}

test('a paste is planned before its own overlapping footprints change the grid', async ({
    page,
}) => {
    await load(page, OVERLAPPING_CURVED_RAILS)
    await copyIntoPaint(page, 1, 2)

    const first = await screenOf(page, 1)
    const second = await screenOf(page, 2)
    const pixelsPerTile = Math.abs(second.y - first.y) / 2

    // Four tiles right clears the originals. The expected four are the original
    // pair plus both pasted rails; the sequential loop silently dropped one.
    await page.mouse.click(second.x + pixelsPerTile * 4, second.y)
    expect(await entityCount(page)).toBe(4)
})

test('a destination entity still blocks a paste', async ({ page }) => {
    await load(page, OVERLAPPING_CURVED_RAILS)
    await copyIntoPaint(page, 1, 2)

    // The copied pair is still aligned with the originals at the release point,
    // so both decisions must stay blocked by destination entities.
    const second = await screenOf(page, 2)
    await page.mouse.click(second.x, second.y)
    expect(await entityCount(page)).toBe(2)
})

test('a planned fast replacement re-derives its live target', async ({ page }) => {
    await load(page, FAST_REPLACE)
    await copyIntoPaint(page, 1, 1)

    const target = await screenOf(page, 2)
    await page.mouse.click(target.x, target.y)

    expect(await entityCount(page)).toBe(2)
    expect((await serializedEntity(page, 2)).name).toBe('iron-chest')
})

test('a planned rotation re-derives its live target', async ({ page }) => {
    await load(page, ROTATE)
    await copyIntoPaint(page, 1, 1)

    const target = await screenOf(page, 2)
    await page.mouse.click(target.x, target.y)

    expect(await entityCount(page)).toBe(2)
    expect((await serializedEntity(page, 2)).direction).toBe(4)
})
