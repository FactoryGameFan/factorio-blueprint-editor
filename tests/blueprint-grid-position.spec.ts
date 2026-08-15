import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    BlueprintAlignment's "Grid position" field, added after a real screenshot
    from the game showed two X/Y pairs where the editor only ever had one -
    "Grid position" above the Absolute/Relative choice, and a second pair
    beside "Absolute" itself. Decoding blueprint strings exported at each
    step (not reasoning about it) settled what each one actually is:

        typing into "Grid position" writes NO blueprint field at all - not
        `snap-to-grid`, `absolute-snapping` nor `position-relative-to-grid`.
        It moves every entity's own `position` by the NEGATION of whatever
        was typed, baked straight into the exported entity coordinates, and
        then resets to 0. "Absolute"'s own X/Y is the one that actually
        round-trips as `position-relative-to-grid` (blueprint-snapping.spec.ts
        covers that half already).

    So this is a real, undoable model mutation - `Blueprint.translateEntities`
    - not a form field bound to a blueprint property, and it needed
    `Entity.forceMoveBy` to bypass `position`'s own collision/wire-reach
    checks: those compare a moving entity against every other entity's
    CURRENT position, which mid-shift is a mix of already-moved and
    not-yet-moved ones, and would misfire on a pair close enough together
    that one's target lands on the other's not-yet-vacated tile - even though
    the final, fully-shifted layout is exactly as valid as the one it started
    from, translation being the one move that cannot change any entity's
    position relative to any other.

    BlueprintAlignment's own coordinates - packages/editor/src/UI/
    BlueprintAlignment.ts - since there is no test hook for a control buried
    this deep in a dialog, the same shape tests/chest-editor.spec.ts uses for
    ChestEditor's filter grid.
*/

type Page = import('@playwright/test').Page

const VERSION = version(2, 0, 55)

// Two entities eight tiles apart, so a wrong per-entity-looped implementation
// (checking collision/wire-reach against the OTHER entity's still-old
// position mid-shift) has room to misfire without them ever truly colliding.
const TWO_CHESTS = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 8.5, y: 8.5 } },
    ],
})

// BlueprintAlignment's own layout constants.
const ROW_HEIGHT = 32
const FIELD_WIDTH = 44
const CONTENT_RIGHT = 336
const COL2_X = CONTENT_RIGHT - FIELD_WIDTH
const COL1_X = COL2_X - FIELD_WIDTH - 62
// BlueprintInfoEditor.ts: `alignment.position.set(12, ALIGNMENT_Y)`, ALIGNMENT_Y = 278.
const ALIGN_X = 12
const ALIGN_Y = 278

async function openBlueprintInfo(page: Page): Promise<{ x: number; y: number }> {
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    return { x: dialog.x + ALIGN_X, y: dialog.y + ALIGN_Y }
}

/** Ticks the "Snap to grid" checkbox at BlueprintAlignment's own (0, 0). */
async function enableSnapToGrid(page: Page, align: { x: number; y: number }): Promise<void> {
    await page.mouse.click(align.x + 8, align.y + 8)
}

/**
 * Types into one of "Grid position"'s two fields and commits with Tab -
 * TextInput fires `changed` on blur, same as tests/text-input.spec.ts. Left
 * on whichever field Tab lands on afterwards; `blurToCanvas` is what gets
 * focus back off the dialog's own input chain before a keybind is expected
 * to fire (Editor.ts's keydown listener ignores every key while an
 * <input>/<textarea> has focus).
 */
async function fillGridPositionField(
    page: Page,
    align: { x: number; y: number },
    axis: 'x' | 'y',
    value: string
): Promise<void> {
    const colX = axis === 'x' ? COL1_X : COL2_X
    const x = align.x + colX + FIELD_WIDTH / 2
    const y = align.y + ROW_HEIGHT * 2 + 4 + 10
    await page.mouse.click(x, y)
    await page.keyboard.press('Control+A')
    await page.keyboard.type(value)
    await page.keyboard.press('Tab')
}

/** Blurs whatever DOM input Tab left focused, by clicking the dialog's own title bar. */
async function blurToCanvas(page: Page): Promise<void> {
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(dialog.x + 30, dialog.y + 14)
}

async function positionsOf(
    page: Page,
    entityNumbers: number[]
): Promise<{ x: number; y: number }[]> {
    const positions = await page.evaluate(
        nums => nums.map(n => window.__fbe_test.entityPosition(n)),
        entityNumbers
    )
    return positions.map((p, i) => {
        if (p === undefined)
            throw new Error(`no entity ${entityNumbers[i]} in the loaded blueprint`)
        return p
    })
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('typing into Grid position moves every entity by the negated value and resets to 0', async ({
    page,
}) => {
    await loadBlueprint(page, TWO_CHESTS)
    const before = await positionsOf(page, [1, 2])

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    const inputValues = await page.evaluate(() =>
        [...document.querySelectorAll('input')]
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )
    // Name, Width, Height, Grid position X, Grid position Y, Absolute X, Absolute Y.
    expect(inputValues.slice(3, 5)).toEqual(['0', '0'])

    const after = await positionsOf(page, [1, 2])
    // X committed alone first (Y still 0), then Y committed alone (X back to
    // 0) - two separate nudges of (-3, 0) and (0, -4) that sum to (-3, -4),
    // the same shape Width/Height's own two independently-committed fields
    // already have.
    expect(after[0]).toEqual({ x: before[0].x - 3, y: before[0].y - 4 })
    expect(after[1]).toEqual({ x: before[1].x - 3, y: before[1].y - 4 })
    // The two entities' offset from each other is exactly what it started as -
    // a translation cannot change any entity's position relative to another.
    expect({ x: after[1].x - after[0].x, y: after[1].y - after[0].y }).toEqual({
        x: before[1].x - before[0].x,
        y: before[1].y - before[0].y,
    })
})

test('Grid position does not write snap-to-grid, absolute-snapping or position-relative-to-grid', async ({
    page,
}) => {
    /*
        The whole point of the game measurement this feature is built on:
        "Grid position" is not a second copy of Absolute's own field, and
        writes nothing of its own - `position-relative-to-grid` stays absent
        because Absolute's own X/Y (a different pair, on a different row)
        were never touched, regardless of what "Grid position" was typed.
        `snap-to-grid`/`absolute-snapping` do appear, but from the checkbox
        turning grid snapping on (which defaults to Absolute), not from this.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    expect(decoded.blueprint['snap-to-grid']).toEqual({ x: 1, y: 1 })
    expect(decoded.blueprint['absolute-snapping']).toBe(true)
    expect(decoded.blueprint['position-relative-to-grid']).toBeUndefined()
})

test('undo reverts the shift entity by entity, matching the per-field commit', async ({ page }) => {
    await loadBlueprint(page, TWO_CHESTS)
    const before = await positionsOf(page, [1, 2])

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    await blurToCanvas(page)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    // Two separate transactions went on the undo stack (one per field commit,
    // see the first test) - both have to unwind before the entities are back
    // where they started.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')

    const after = await positionsOf(page, [1, 2])
    expect(after).toEqual(before)
})
