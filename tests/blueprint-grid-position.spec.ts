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
import { openBlueprintInfo, enableSnapToGrid } from './helpers/blueprint-info-dialog'

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

const ONE_ASSEMBLER = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'assembling-machine-1', position: { x: 10.5, y: 10.5 } }],
})

const EMPTY_BLUEPRINT = encode({ item: 'blueprint', version: VERSION })

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

/** All DOM input values currently on the page, in the order BlueprintInfoEditor
 * draws them: Name, Width, Height, Grid position X, Grid position Y, Absolute
 * X, Absolute Y. */
async function fieldValues(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll('input')]
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )
}

async function gridPositionFields(page: Page): Promise<{ x: string; y: string }> {
    const fields = await fieldValues(page)
    return { x: fields[3], y: fields[4] }
}

/** Where an entity of the loaded blueprint currently is, in client coordinates. */
async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(n => window.__fbe_test.entityScreenPosition(n), entityNumber)
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
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

    // The field is a target, not a one-shot nudge - it keeps showing what
    // was typed rather than resetting, the same as Width/Height and
    // Absolute X/Y do.
    expect(await gridPositionFields(page)).toEqual({ x: '3', y: '4' })

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

test('undo reverts the exported shift one commit at a time, X and Y separately', async ({
    page,
}) => {
    await loadBlueprint(page, TWO_CHESTS)

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    const exportedBefore = await exportedPositionsOf(page)

    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')

    await blurToCanvas(page)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    /*
        X and Y each committed their own write to `gridPositionOffset` (see
        the first test) - two separate transactions on the undo stack. A
        single combined undo of *both* would land back on exportedBefore too
        (see below), which is why the intermediate state after exactly one
        undo is the one that actually distinguishes "two commits" from "one
        commit plus something else on the stack" - here specifically the
        checkbox's own `snapToGrid` transaction, whose undo would also
        happen to leave positions unchanged (gridPositionOffset applies in
        serialize() regardless of snapToGrid), so a version that coalesced
        X and Y into a single write could still pass a check that only
        looked at the state after two undos.
    */
    await page.keyboard.press('Control+KeyZ')
    const exportedAfterOneUndo = await exportedPositionsOf(page)
    const minX = Math.min(...exportedAfterOneUndo.map(p => p.x))
    const minY = Math.min(...exportedAfterOneUndo.map(p => p.y))
    // Y's commit alone is undone - X (3) still holds, Y is back to whatever
    // it displayed before being typed into.
    expect(-Math.floor(minX)).toBe(3)
    expect(-Math.floor(minY)).not.toBe(4)

    await page.keyboard.press('Control+KeyZ')
    const exportedAfterTwoUndos = await exportedPositionsOf(page)
    expect(exportedAfterTwoUndos).toEqual(exportedBefore)
})

test('Grid position reads a multi-tile entity by its footprint edge, not its centre', async ({
    page,
}) => {
    /*
        #243 review: getGridPositionDisplay() read e.position.x directly -
        the entity's own centre - rather than the edge of its tile
        footprint. Every blueprint this spec used before was 1x1 entities on
        a half-integer centre, where centre-floor and edge-floor land on the
        same tile and so agree by construction; a single 3x3
        assembling-machine-1 is what separates them. At (10.5, 10.5), the
        edge sits at 9 (10.5 - 3/2) and the centre at 10.5 - measured
        against the game (`tools/oracle/fixtures/blueprint-grid-position-gui.json`,
        `entityEdgesAndTiles` is the only surviving reading), the edge is
        the one the game reads. getCenter() rounds this single entity's own
        3x3 bounding box (9..12) to a centre of 11, so the two formulas
        predict different displayed values - edge-based gives 2, a
        centre-based reading would give 1.
    */
    await loadBlueprint(page, ONE_ASSEMBLER)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    expect(await gridPositionFields(page)).toEqual({ x: '2', y: '2' })
})

test('Grid position clears when Snap to grid is turned off, rather than silently shifting every future export', async ({
    page,
}) => {
    /*
        serialize() applies gridPositionOffset unconditionally - it has no
        field of its own to omit the way snap-to-grid/absolute-snapping/
        position-relative-to-grid do. Tick Snap to grid, type a target,
        untick Snap to grid: all three snapping keys used to leave the
        export while gridPositionOffset stayed in Blueprint.set snapToGrid's
        store, still shifting every export for the rest of the session with
        no field left enabled to zero it (#243 review).
    */
    await loadBlueprint(page, TWO_CHESTS)
    const exportedBefore = await exportedPositionsOf(page)

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    await fillGridPositionField(page, align, 'x', '3')
    await fillGridPositionField(page, align, 'y', '4')
    expect(await exportedPositionsOf(page)).not.toEqual(exportedBefore)

    // Unticks the checkbox - same control as enableSnapToGrid, since Checkbox
    // only ever toggles.
    await enableSnapToGrid(page, align)

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    expect(decoded.blueprint['snap-to-grid']).toBeUndefined()
    expect(await exportedPositionsOf(page)).toEqual(exportedBefore)
})

test('Grid position keeps showing what was typed on an empty blueprint, instead of visibly resetting to 0', async ({
    page,
}) => {
    /*
        getGridPositionDisplay() used to early-return {0, 0} for an empty
        blueprint regardless of gridPositionOffset. Tick Snap to grid on an
        empty blueprint, type 5 into Grid position X: the offset became
        {x: -5, y: 0}, but the very refresh that commit triggers read the
        still-empty blueprint's display as {0, 0} again and reset the box in
        front of the user - who watched the value they just typed vanish,
        with every entity placed afterwards exporting shifted by -5 and
        nothing on screen saying why (#243 review).
    */
    await loadBlueprint(page, EMPTY_BLUEPRINT)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    await fillGridPositionField(page, align, 'x', '5')
    expect(await gridPositionFields(page)).toEqual({ x: '5', y: '0' })
})

test("placing or deleting an entity while the dialog is open keeps Grid position's display honest", async ({
    page,
}) => {
    /*
        getGridPositionDisplay() derives from every entity's and tile's own
        position, not from any of the four blueprint-level events the
        dialog originally subscribed to (snapToGrid, absoluteSnapping,
        positionRelativeToGrid, gridPositionOffset). Deleting the entity
        that sets the blueprint's minimum corner while the dialog stays open
        used to leave the box showing its old, now-stale value - and
        blurring it afterwards would have committed that stale reading as a
        fresh target (#243 review).
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    const before = await gridPositionFields(page)

    // Ctrl + right-drag over entity 1 (0.5, 0.5), the one setting the
    // blueprint's minimum corner - DELETE mode, the same gesture
    // tests/editor-mode-input.spec.ts uses. The dialog does not block the
    // canvas (ExportDialog's own #243 finding says the same of its field).
    // The 1px move after mouse-down is load-bearing: entering DELETE mode
    // only *defines* the selection-area callback, a later pointermove is
    // what actually calls it and populates the entities under it, so a
    // plain down/up with no move in between selects and deletes nothing.
    const at = await screenOf(page, 1)
    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(at.x + 1, at.y)
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')

    expect(await page.evaluate(() => window.__fbe_test.entityPosition(1))).toBeUndefined()
    /*
        Polled rather than read once: the entity hooks are coalesced onto the
        next frame now (`scheduleRefreshFromModel`), because they arrive one
        per entity and each costs a whole-blueprint read - a 500-entity
        deletion used to run 500 of them. A single read here would race that
        frame.
    */
    await expect.poll(() => gridPositionFields(page)).not.toEqual(before)
})

test('clicking through Grid position without typing pushes no undo entry (#243 review)', async ({
    page,
}) => {
    /*
        `gridPositionOffset`'s setter compared the raw store field, and
        `pointsEqual(undefined, {x: 0, y: 0})` is false - so on a blueprint
        that had never carried an offset, an untouched blur wrote `{0, 0}`
        over "unset" and pushed a `Change blueprint grid position offset`
        transaction. `commitGridPosition` solves for "make the display read
        what is typed", and an untouched field types back exactly what it
        shows, so the delta is 0 and the write should have been a no-op - the
        getter already answers `{0, 0}` for an absent offset, which is why
        comparing against it rather than the raw field is the fix.

        The visible cost was one stolen Ctrl+Z: the undo below has to reach
        the checkbox, not an offset write nobody asked for.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)

    // The one real edit on the stack.
    await enableSnapToGrid(page, align)

    // Click into Grid position X and straight back out, typing nothing.
    await page.mouse.click(align.x + COL1_X + FIELD_WIDTH / 2, align.y + ROW_HEIGHT * 2 + 4 + 10)
    await blurToCanvas(page)

    await page.keyboard.press('Control+KeyZ')

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    expect(decodeBlueprintString(out).blueprint['snap-to-grid']).toBeUndefined()
})

test('an entity appearing while a field is being typed into leaves what was typed alone (#243 review)', async ({
    page,
}) => {
    /*
        `refreshFromBlueprint` overwrites all six boxes and clears
        `m_PositionDirty`, and the entity hooks added for the stale-display
        finding above put it on `'create-entity'`/`'remove-entity'` - so an
        entity arriving mid-edit threw away what was being typed *and* the
        flag that would have committed it on blur (#243 review). A
        model-driven refresh now leaves a focused field alone; one the
        dialog's own controls ask for still rewrites everything, which is
        what the Relative-radio race in blueprint-info-editor.spec.ts needs.

        Driven through the `createEntity` hook rather than a canvas click for
        the reason that hook's own doc comment gives: a click on the canvas
        blurs the field first, which is the one thing this test must not do.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    const before = await gridPositionFields(page)

    // Absolute X, typed into and deliberately not blurred.
    await page.mouse.click(align.x + COL1_X + FIELD_WIDTH / 2, align.y + ROW_HEIGHT * 3 + 4 + 10)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('12')

    // Well outside the two chests, so it moves the minimum corner and the
    // Grid position display really does have something new to show.
    await page.evaluate(() => window.__fbe_test.createEntity('wooden-chest', -20.5, -20.5))

    // The refresh this schedules lands on a later frame - wait for the box it
    // is allowed to rewrite, which also proves it ran at all.
    await expect.poll(() => gridPositionFields(page)).not.toEqual(before)

    // ...and the one it is not allowed to rewrite still holds the edit.
    expect(await fieldValues(page)).toHaveLength(7)
    expect((await fieldValues(page))[5]).toBe('12')

    // Which the blur then commits, the same as if nothing had been placed.
    await blurToCanvas(page)
    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    expect(decodeBlueprintString(out).blueprint['position-relative-to-grid']).toEqual({
        x: 12,
        y: 0,
    })
})
