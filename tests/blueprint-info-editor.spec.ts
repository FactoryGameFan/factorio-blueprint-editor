import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { ROW_HEIGHT, FIELD_WIDTH, COL1_X } from '../packages/editor/src/UI/BlueprintAlignment'
import { openBlueprintInfo, enableSnapToGrid } from './helpers/blueprint-info-dialog'

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

/** Absolute's own X box, read from the DOM - see `fieldValues`' own comment
 * in blueprint-grid-position.spec.ts for the full field ordering. */
async function absoluteXValue(page: Page): Promise<string> {
    return page.evaluate(
        () => [...document.querySelectorAll('input')].filter(el => el.style.cssText !== '')[5].value
    )
}

/** The loaded blueprint's own string, straight from the test hook. */
async function encodeLoaded(page: Page): Promise<string> {
    return page.evaluate(() => window.__fbe_test.encodeLoaded())
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
    // The helper for the first open, for its render-frame wait: the icon slot
    // clicked below is hit-tested by pixi against a world transform that is
    // only current once a frame has run, so a click sent before that misses
    // it and no picker opens - see the helper's own doc comment.
    await openBlueprintInfo(page)
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
    /*
        No settling call before this any more. `serialize()` used to generate
        the missing icons into the model, which put a transaction of its own
        on the stack, so the first `encodeLoaded()` below had to be spent
        getting that out of the way or it - not the checkbox - was what the
        undo reverted. Auto icons are computed at export now and written
        nowhere (`Blueprint.computeAutoIcons`), so the checkbox's click is
        the only thing on the stack and the undo below reaches it directly.
    */

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    let out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    expect(decodeBlueprintString(out).blueprint['snap-to-grid']).toEqual({ x: 1, y: 1 })

    await page.keyboard.press('Control+KeyZ')

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

    // Through the helper, for the render-frame wait it carries - a click on
    // the Name field computed from the dialog's bounds lands on the canvas
    // until the field has been positioned, and the typing that follows then
    // goes to the app's keybinds with nothing to show for it.
    await openBlueprintInfo(page)
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
    await page.keyboard.press('Control+KeyZ')
    expect((await exportedLabel(page)).label).toBe(before.label)
})

test('serializing a blueprint with no icons of its own writes nothing to it (#243 finding 14, #243 review)', async ({
    page,
}) => {
    /*
        Three versions of this, and the middle one is the reason the test
        moved. `generateIcons()` first wrote straight into `this.icons` (a
        plain Map, no History involved), so an auto icon could not be undone
        and no `'icon'` event redrew the slot - finding 14. Routing it through
        `setIcon` fixed the bypass and made `serialize()` a *writer*, which is
        worse: `History.commitTransaction` trims the redo stack before
        pushing, so a Ctrl+C spent the user's redos (see the test below).

        Now nothing is written at all, which closes finding 14 from the other
        side - there is no History bypass left, because there is no write. The
        exported string still carries the icons; the model still says the
        blueprint chose none, which is what puts `setIcon`'s "clearing every
        slot returns to auto" back where it belongs.
    */
    await loadBlueprint(page, TWO_CHESTS)

    const before = await page.evaluate(() => window.__fbe_test.blueprintIcons())
    expect(before).toEqual([undefined, undefined, undefined, undefined])

    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    // The export carries the auto icon - this is not "no icons anywhere".
    expect(decodeBlueprintString(out).blueprint.icons?.[0].signal.name).toBe('wooden-chest')

    // ...and the model is untouched by having been read.
    expect(await page.evaluate(() => window.__fbe_test.blueprintIcons())).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
    ])
})

test('copying a blueprint with no icons of its own leaves the redo stack alone (#243 review)', async ({
    page,
}) => {
    /*
        The blocker that came out of finding 14's own fix. With icon
        generation routed through History and `serialize()` calling it,
        `commitTransaction` trimmed the redo stack before pushing - so on a
        blueprint carrying no icons, any serialize after an undo threw the
        redos away. Ctrl+C is the obvious way in; the share URL and
        ExportDialog serialize too.

        Driven here through `encodeLoaded()` rather than a real Ctrl+C, which
        would reach `navigator.clipboard` - `serialize()` is the shared step,
        and it is where the write was.
    */
    await loadBlueprint(page, TWO_CHESTS)

    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)
    expect(decodeBlueprintString(await encodeLoaded(page)).blueprint['snap-to-grid']).toEqual({
        x: 1,
        y: 1,
    })

    await page.keyboard.press('Control+KeyZ')
    expect(
        decodeBlueprintString(await encodeLoaded(page)).blueprint['snap-to-grid']
    ).toBeUndefined()

    // The redo above has to survive both of those serializes - one of which
    // ran while the blueprint still had no icons of its own.
    await page.keyboard.press('Control+KeyY')
    expect(decodeBlueprintString(await encodeLoaded(page)).blueprint['snap-to-grid']).toEqual({
        x: 1,
        y: 1,
    })
})

test('a keystroke the field rejects commits no grid position (#243 review)', async ({ page }) => {
    /*
        `TextInput._onInputInput` ran the restriction and then emitted
        `'changed'` unconditionally, so a character the restriction had just
        thrown away still reported a change: `BlueprintAlignment` set
        `m_PositionDirty`, and the next blur committed
        `positionRelativeToGrid` - putting `"position-relative-to-grid":
        {"x":0,"y":0}` into a blueprint that had never carried the key
        (`Blueprint.serialize` writes it whenever it is not undefined, and
        undefined is the only thing it treats as unset).

        This is the finding-2 phantom origin arriving by a route the dirty
        flag itself cannot see, since the flag is exactly what a spurious
        `'changed'` sets.
    */
    await loadBlueprint(page, TWO_CHESTS)
    const align = await openBlueprintInfo(page)
    await enableSnapToGrid(page, align)

    // Absolute X shows `0`, and `a` is not in that field's `^-?\d*$`.
    await typeAbsoluteXWithoutBlur(page, align, 'a')

    // The restriction really did reject it - otherwise the rest of this
    // proves nothing about a *rejected* keystroke.
    expect(await absoluteXValue(page)).toBe('0')

    const info = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(info.x + 30, info.y + 14)

    expect(
        decodeBlueprintString(await encodeLoaded(page)).blueprint['position-relative-to-grid']
    ).toBeUndefined()
})
