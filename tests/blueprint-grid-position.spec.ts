import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import {
    ROW_HEIGHT,
    FIELD_WIDTH,
    COL1_X,
    COL2_X,
} from '../packages/editor/src/UI/BlueprintAlignment'
import { ALIGNMENT_X, ALIGNMENT_Y } from '../packages/editor/src/UI/BlueprintInfoEditor'

/*
    BlueprintAlignment's "Grid position" field, added after a real screenshot
    from the game showed two X/Y pairs where the editor only ever had one -
    "Grid position" above the Absolute/Relative choice, and a second pair
    beside "Absolute" itself. Round-tripping real blueprint strings through
    the game at each step (not reasoning about it) settled what each one
    actually is, and it took two rounds to get right:

        "Grid position" writes NO blueprint field of its own, and there is no
        LuaItemStack property that sets it directly either - the game's own
        oracle probe for this (`probe-blueprint-grid-position.mjs`) set
        `blueprint_position_relative_to_grid` instead, which is "Absolute"'s
        own X/Y, a different field a row below. That probe's conclusion (grid
        position leaves entities alone) is correct for the field it actually
        touched and does not transfer.

        Decoding real exports settled the actual field: it displays
        `-floor(minX), -floor(minY)` over every entity's raw position (see
        `Blueprint.getGridPositionDisplay()`'s own doc comment for the
        formula and how it was measured), and typing a target into it in the
        real game genuinely moves every entity so that formula, applied
        afterwards, reads back exactly what was typed. So the first
        implementation here (#222 review) - `Blueprint.translateEntities`,
        moving every `Entity.position` by the negated typed amount - had the
        right idea for what the game does, but could not work in *this*
        codebase for an unrelated reason this spec is shaped to guard
        against: `Blueprint.serialize()` re-centres every exported position
        on `getCenter()`'s bounding box of the *current* entities, recomputed
        on every call. Translating every entity by (dx, dy) moves that box's
        centre by exactly (dx, dy) too, so subtracting the shifted centre
        from the shifted positions always reproduces the pre-translation
        numbers - the shift is invisible to the exported string by
        construction, for any implementation built on moving entities.
        Nothing in the first version of this file could have caught that:
        every assertion read `entityPosition()`, the live model, which
        genuinely did change - the exported string, which did not, was never
        checked.

    The fix stores the *offset needed to reach the typed target* separately
    (`Blueprint.gridPositionOffset`, see its own doc comment) and applies it
    only inside `serialize()`, against the already-computed centre - after
    the recentring, not before it, which a recentre cannot undo. Live entity
    positions - and so `PositionGrid`, rendering, and every other model-level
    read - never move at all. So every test below checks the *exported*
    positions (via `encodeLoaded` + `decodeBlueprintString`), and the first
    one explicitly pins that the live model does NOT move, which is the
    regression guard against reintroducing a translate-based approach in
    this codebase specifically - not a claim that the real game avoids
    moving entities, which it does not.

    BlueprintAlignment's own coordinates - packages/editor/src/UI/
    BlueprintAlignment.ts, imported directly rather than copied, so a layout
    change there cannot silently desync what this file clicks - since there
    is no test hook for a control buried this deep in a dialog, the same
    shape tests/chest-editor.spec.ts uses for ChestEditor's filter grid.
*/

type Page = import('@playwright/test').Page

const VERSION = version(2, 0, 55)

const TWO_CHESTS = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 8.5, y: 8.5 } },
    ],
})

async function openBlueprintInfo(page: Page): Promise<{ x: number; y: number }> {
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    return { x: dialog.x + ALIGNMENT_X, y: dialog.y + ALIGNMENT_Y }
}

/** Ticks the "Snap to grid" checkbox at BlueprintAlignment's own (0, 0). */
async function enableSnapToGrid(page: Page, align: { x: number; y: number }): Promise<void> {
    await page.mouse.click(align.x + 8, align.y + 8)
}

/**
 * Types into one of "Grid position"'s two fields and commits on blur (Tab
 * away) - BlueprintAlignment wires those fields to `'blur'` specifically,
 * not `'changed'` (which fires per keystroke), since the commit re-renders
 * from the blueprint and would otherwise wipe out whatever was typed after
 * the first character. Left on whichever field Tab lands on afterwards;
 * `blurToCanvas` is what gets focus back off the dialog's own input chain
 * before a keybind is expected to fire (Editor.ts's keydown listener ignores
 * every key while an <input>/<textarea> has focus).
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
    // ControlOrMeta, not Control - see display-panel-editor.spec.ts's own
    // note on this: Control+A is "beginning of line" on macOS, not
    // select-all, so the typed value would land beside the old text instead
    // of replacing it.
    await page.keyboard.press('ControlOrMeta+A')
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

/** The two chests' positions as `serialize()` would write them right now. */
async function exportedPositionsOf(page: Page): Promise<{ x: number; y: number }[]> {
    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    return decoded.blueprint.entities.map((e: { position: { x: number; y: number } }) => e.position)
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('typing a target into Grid position moves the exported positions to match it, without moving the live model', async ({
    page,
}) => {
    await loadBlueprint(page, TWO_CHESTS)
    const modelBefore = await positionsOf(page, [1, 2])

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    // Enabling the checkbox alone must not move anything either - the
    // export-side baseline is taken after it, not before, so the assertions
    // below isolate the commit's own effect from the checkbox's.
    const exportedBefore = await exportedPositionsOf(page)

    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    const inputValues = await page.evaluate(() =>
        [...document.querySelectorAll('input')]
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )
    // Name, Width, Height, Grid position X, Grid position Y, Absolute X, Absolute Y.
    // The field is a target, not a one-shot nudge - it keeps showing what
    // was typed rather than resetting, the same as Width/Height and
    // Absolute X/Y do.
    expect(inputValues.slice(3, 5)).toEqual(['3', '4'])

    /*
        The regression guard: the live model - what PositionGrid, rendering
        and every other in-editor read sees - must be exactly what it was
        before any of this. A version built on moving entities in this
        codebase would fail here first (see the file header for why that
        cannot work here even though the real game does move entities).
    */
    const modelAfter = await positionsOf(page, [1, 2])
    expect(modelAfter).toEqual(modelBefore)

    /*
        The bug this whole spec exists to catch: the EXPORTED positions must
        actually have moved. What they move BY depends on where the
        blueprint's bounding box started (there is no fixed sign/magnitude
        the way a plain nudge would have), so the real invariant to check is
        the one measured against the game: applying
        `Blueprint.getGridPositionDisplay()`'s own formula to the exported
        result reproduces exactly what was typed.
    */
    const exportedAfter = await exportedPositionsOf(page)
    expect(exportedAfter).not.toEqual(exportedBefore)
    const minExportedX = Math.min(...exportedAfter.map(p => p.x))
    const minExportedY = Math.min(...exportedAfter.map(p => p.y))
    expect({ x: -Math.floor(minExportedX), y: -Math.floor(minExportedY) }).toEqual({ x: 3, y: 4 })
    // The two entities' offset from each other is exactly what it started as -
    // a uniform export-time shift cannot change any entity's position
    // relative to another.
    expect({
        x: exportedAfter[1].x - exportedAfter[0].x,
        y: exportedAfter[1].y - exportedAfter[0].y,
    }).toEqual({
        x: exportedBefore[1].x - exportedBefore[0].x,
        y: exportedBefore[1].y - exportedBefore[0].y,
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

test('undo reverts the exported shift, matching the per-field commit', async ({ page }) => {
    await loadBlueprint(page, TWO_CHESTS)

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    const exportedBefore = await exportedPositionsOf(page)

    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    await blurToCanvas(page)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    // X and Y each committed their own write to `gridPositionOffset` (see
    // the first test) - two separate transactions on the undo stack, both
    // have to unwind before the export is back to where it started.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')

    const exportedAfter = await exportedPositionsOf(page)
    expect(exportedAfter).toEqual(exportedBefore)
})
