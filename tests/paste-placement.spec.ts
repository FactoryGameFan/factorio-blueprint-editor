import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString as decode,
    encodeBlueprint as encode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    The decision/execution split for a pasted selection (issue #163).

    `PaintBlueprintEntityContainer.checkBuildable` tints the whole preview
    against the destination grid before the click, so placement has to use
    decisions made against that same unchanged grid. It did not: the old loop
    planned and placed each entity in turn, so from the second entity on it was
    asking a grid the previous placement had already mutated. An entity the
    preview had drawn green was then silently dropped - no error, no toast, just
    one fewer entity than the user watched themselves paste.

    Three of the four tests below are negative controls, and their names do not
    say so. Only the first fails against the pre-#160 code; each of the other
    three exists to kill a different way of "fixing" the first that breaks
    something else. Mutation-checked, each of these fails exactly one test:

      planPlacement returns { type: 'create' } unconditionally
        -> a destination entity still blocks a paste
      the checkFastReplaceableGroup arm is deleted
        -> a planned fast replacement re-derives its live target
      the checkSameEntityAndDifferentDirection arm is deleted
        -> a planned rotation re-derives its live target
      revert to the pre-#160 plan-and-place-in-one-loop code
        -> a paste is planned before its own overlapping footprints change the grid

    Fast replace and rotate need their own tests because both reuse an entity
    that already exists and return `undefined` rather than entering the
    wire-remapping map, so no entity count can see them go wrong. Their targets
    are deliberately re-derived during execution instead of being carried in the
    plan: an earlier planned action can destroy the object planning found, while
    a second lookup can only return the current live entity or safely nothing.

    What this spec cannot see is the preview itself. Nothing in tests/ reads a
    sprite tint, so "the green matches the result" is held structurally instead -
    `checkBuildable` asks `planPlacement` rather than repeating its three grid
    questions (issue #181). Writing that expression out twice would be invisible
    to every test here.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

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

    // Not aligned with the originals, which is easy to assume and wrong: the
    // rail-parity snapping in PaintBlueprintContainer.moveAtCursor offsets the
    // paste 2 tiles down. Measured, the originals sit at (0, -1) and (0, 1) and
    // the copies land at (0, 1) and (0, 3) - one exactly on original entity 2
    // and the other inside its 2x6 rectangle. The overlap is what blocks both
    // decisions, so moving these coordinates has to preserve the overlap, not
    // an alignment that was never there.
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
