import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { ROW_HEIGHT, FIELD_WIDTH, COL1_X } from '../packages/editor/src/UI/BlueprintAlignment'
import { ALIGNMENT_X, ALIGNMENT_Y } from '../packages/editor/src/UI/BlueprintInfoEditor'

/*
    The rest of the PR #243 review that isn't specifically about "Grid
    position" (that half lives in tests/blueprint-grid-position.spec.ts,
    which this file's helpers mirror rather than duplicate by hand - see that
    file's own header for why the coordinates are imported constants and not
    guessed numbers).
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

/** Clicks the "Absolute"/"Relative" radio at BlueprintAlignment's row 3/4 - both
 * drawn by RadioButton.drawGraphic, a circle scaled to a local (9, 9) centre. */
async function clickRadio(
    page: Page,
    align: { x: number; y: number },
    which: 'absolute' | 'relative'
): Promise<void> {
    const row = which === 'absolute' ? 3 : 4
    await page.mouse.click(align.x + 9, align.y + ROW_HEIGHT * row + 8 + 9)
}

/** Types into Absolute's own X field without blurring - the field a click
 * on the Relative radio races against (#243 review, finding #2). */
async function typeAbsoluteXWithoutBlur(
    page: Page,
    align: { x: number; y: number },
    value: string
): Promise<void> {
    const x = align.x + COL1_X + FIELD_WIDTH / 2
    const y = align.y + ROW_HEIGHT * 3 + 4 + 10
    await page.mouse.click(x, y)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(value)
}

async function exportedLabel(page: Page): Promise<{ label: string; description?: string }> {
    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    return { label: decoded.blueprint.label, description: decoded.blueprint.description }
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('typing into Absolute X and switching to Relative before blur does not commit a phantom origin position (#243 finding 2)', async ({
    page,
}) => {
    /*
        Pixi's own pointerdown on the Relative radio fires before the DOM
        `blur` a click away from a focused text input also triggers. Before
        the fix, that left `m_PositionDirty` set from the earlier keystroke,
        and the radio's own refreshFromBlueprint() call rewrote the X box to
        the blueprint's *current* (still uncommitted) value just ahead of
        that deferred blur - which then read the freshly-rewritten box and
        committed it as though it were the user's own edit.

        `position-relative-to-grid` is only ever written while Absolute is
        selected (Blueprint.serialize's own condition, this file's Blueprint.ts
        comment above the return statement), so the phantom commit is
        invisible from Relative - switching back to Absolute afterwards,
        without ever retyping X, is what surfaces it: the key stays entirely
        *absent* if nothing committed, or reappears as an explicit `{0, 0}`
        if the race wrote one. Never having touched Absolute X at all before
        this sequence is what makes the two outcomes different objects
        rather than the same default value read two different ways.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    await typeAbsoluteXWithoutBlur(page, align, '12')
    await clickRadio(page, align, 'relative')
    await clickRadio(page, align, 'absolute')

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    expect(decoded.blueprint['position-relative-to-grid']).toBeUndefined()
})

test('a rejected keystroke reverts to the last real value, not to a stale empty string (#243 finding 4)', async ({
    page,
}) => {
    /*
        `_restrict_value` used to be written only inside `_applyRestriction`,
        on a real keystroke - every programmatic `.text =` assignment
        (construction, and every commit-then-redisplay from
        refreshFromBlueprint) left it at its constructor default of `''`.
        Committing a real value through the field and then typing something
        the restriction rejects used to roll the field back to that stale
        `''` instead of to what was actually showing.

        Grid position X is numeric-only (`restrict = /^-?\d*$/`) and gets
        redisplayed by refreshFromBlueprint on every commit, so it exercises
        exactly the write the fix added.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    const x = align.x + COL1_X + FIELD_WIDTH / 2
    const y = align.y + ROW_HEIGHT * 2 + 4 + 10
    await page.mouse.click(x, y)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('5')
    await page.keyboard.press('Tab')

    // Committed and redisplayed - refreshFromBlueprint's own `.text =` write
    // is the one that used to leave `_restrict_value` stale at ''.
    await page.mouse.click(x, y)
    await page.keyboard.type('a')

    const value = await page.evaluate(
        () => (document.activeElement as HTMLInputElement | null)?.value
    )
    expect(value).toBe('5')
})

test('a second click of the corner button only closes the dialog when it is the topmost one (#243 finding 5)', async ({
    page,
}) => {
    /*
        The corner button is drawn outside dialogsContainer and stays clickable
        while any dialog sits on top of BlueprintInfoEditor - before the fix,
        `toggleBlueprintInfoEditor` closed `this.blueprintInfoEditor`
        unconditionally whenever it existed, orphaning whatever dialog the
        user had actually opened over it (the icon picker, here).
        `openBlueprintInfoEditor()` is the same call the button makes
        (Editor.ts's own doc comment), so calling it a second time here is
        exactly a second real click.
    */
    await loadBlueprint(page, TWO_CHESTS)
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)

    // The first icon slot, at dialog-local (12, 119), 36 across - opens the
    // picker as a second dialog on top.
    const info = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(info.x + 12 + 18, info.y + 119 + 18)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(2)

    // A second "click" of the corner button while the picker is on top must
    // not touch BlueprintInfoEditor underneath it.
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(2)

    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)

    // Now BlueprintInfoEditor is topmost again, so the same call does close it.
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
})

test('ticking Snap to grid on is one undo step, not two (#243 finding 6)', async ({ page }) => {
    /*
        The checkbox writes `snapToGrid` and `absoluteSnapping` in two
        separate setter calls, each of which used to end in its own
        `history.updateValue(...).commit()` - two undo steps for one click.
        A single Ctrl+Z must revert both, back to no snapping at all.
    */
    await loadBlueprint(page, TWO_CHESTS)
    // Settles the icon-autogeneration transaction (finding #14, below) out of
    // the way first - encodeLoaded() -> serialize() calls generateIcons()
    // once per blueprint (guarded on icons.size === 0), and since that write
    // now goes through History too, it would otherwise be the transaction
    // the first undo below reverts instead of the checkbox's.
    await page.evaluate(() => window.__fbe_test.encodeLoaded())

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    let out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    expect(decodeBlueprintString(out).blueprint['snap-to-grid']).toEqual({ x: 1, y: 1 })

    await page.keyboard.press('Control+z')

    out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    expect(decoded.blueprint['snap-to-grid']).toBeUndefined()
    expect(decoded.blueprint['absolute-snapping']).toBeUndefined()
})

test('turning grid snapping on floors an emptied Grid size box at 1, never writing snap-to-grid: 0 (#243 finding 7)', async ({
    page,
}) => {
    /*
        The checkbox's checked-branch used to read Width/Height through
        parseGridValue, which floors an empty or non-numeric box to 0 rather
        than 1 - the exact `snap-to-grid: {"x":0,"y":1}` the game will not
        accept back, and the one shape parseGridSize exists everywhere else
        in this file to prevent. The box only ever shows something other than
        '1' while snapping is actually on (refreshFromBlueprint resets it to
        '1' the rest of the time, and a disabled DOM input refuses focus), so
        this writes the underlying DOM value directly rather than fighting
        that - it is exactly what the click handler reads
        (`this.m_WidthInput.text` is a plain `.value` read), not a real
        keystroke sequence.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)

    await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')].filter(
            el => (el as HTMLElement).style.cssText !== ''
        ) as HTMLInputElement[]
        // Name(0), Width(1) - see fieldValues' own comment in
        // blueprint-grid-position.spec.ts for the full ordering.
        inputs[1].value = ''
    })

    await enableSnapToGrid(page, align)

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const decoded = decodeBlueprintString(out)
    expect(decoded.blueprint['snap-to-grid']).toEqual({ x: 1, y: 1 })
})

test('Name and Description commit once on blur, not once per keystroke (#243 finding 8)', async ({
    page,
}) => {
    /*
        Both used to be wired to 'changed' (the DOM 'input' event, firing per
        keystroke), and every commit re-renders from the blueprint - so a
        20-character rename used to push 20 separate undo steps, one per
        character. 'blur' waits for the edit to actually finish.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const before = await exportedLabel(page)

    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    const info = await page.evaluate(() => window.__fbe_test.topDialogBounds())

    // Name field: dialog-local (12, 65), see BlueprintInfoEditor.ts.
    await page.mouse.click(info.x + 12 + 30, info.y + 65 + 10)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Renamed Blueprint')

    // Not yet committed - the model must still read the original name.
    expect((await exportedLabel(page)).label).toBe(before.label)

    // Blur by clicking the dialog's own title bar, well away from any field.
    await page.mouse.click(info.x + 30, info.y + 14)
    expect((await exportedLabel(page)).label).toBe('Renamed Blueprint')

    // One commit, one undo step.
    await page.keyboard.press('Control+z')
    expect((await exportedLabel(page)).label).toBe(before.label)
})

test('the icon regenerated at export time is undoable, not a bypass of History (#243 finding 14)', async ({
    page,
}) => {
    /*
        `generateIcons()` used to write straight into `this.icons` (a plain
        Map, no History involved) whenever a blueprint with no icons of its
        own got serialized - Blueprint.setIcon's own "clearing every slot
        returns to auto mode" design relies on `serialize()` calling this
        every time `icons.size === 0`, but the write itself never went
        through the undo stack and never emitted 'icon', so nothing in the
        UI could see it happen and undo could not remove it.
    */
    await loadBlueprint(page, TWO_CHESTS)

    // Nothing has been generated yet - generateIcons only runs inside
    // serialize(), not on load.
    expect(await page.evaluate(() => window.__fbe_test.blueprintIcons())).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
    ])

    await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const generated = await page.evaluate(() => window.__fbe_test.blueprintIcons())
    expect(generated.some(i => i !== undefined)).toBe(true)

    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.__fbe_test.blueprintIcons())).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
    ])
})
