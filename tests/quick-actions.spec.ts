import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { importTextarea, exportTextarea } from './helpers/dialog-textareas'
import { PADDING, REPLACE_Y, APPEND_Y } from '../packages/editor/src/UI/ImportDialog'
import {
    ROW_BUTTON_WIDTH,
    ROW_BUTTON_HEIGHT,
} from '../packages/editor/src/UI/controls/DescribedButton'

/*
    First coverage of `QuickActions` (packages/editor/src/common/globals.ts) -
    the bridge ToolsPanel's quick-action buttons and ImportDialog/ExportDialog
    use to reach website-level clipboard/file logic (PR #221 review, then
    #242's re-review of the recreated PR). Nothing under tests/ named
    ImportDialog, importReplace/importAppend, or exportString/exportImage
    before this.

    Paste's own real clipboard *read* stays out of reach here - a headless
    run has no OS clipboard content to read back, and there is no safe way to
    seed one. What IS covered, including on a *loaded* (non-empty) blueprint,
    which used to be the one case nothing here reached:

    - importReplace/importAppend, driven through ImportDialog's real Replace/
      Append buttons with an explicit textarea value - the same route
      ImportDialog itself uses to bypass `navigator.clipboard` for a
      hand-edited or typed string. Covers the empty-field guard and the
      close-only-on-success behaviour a bad string needs (#242 review).
    - The empty-blueprint guard exportString/exportImage/encodeCurrent all
      share, on both an empty and a loaded blueprint - `exportGuardResult`'s
      own test below proves the loaded case reaches neither
      `navigator.clipboard.writeText` nor a real file download, which is
      the other #242 finding: the guard used to run the real actions rather
      than only reporting them.
    - ExportDialog's own textarea - read-only, pre-selected once it actually
      renders (not before, which was the first #242 blocking issue) - reads
      the loaded blueprint's real string without going through
      `navigator.clipboard` on the read side, the same reason ExportDialog
      exists as a fallback for a browser that blocks it.

    Three of the tests here cover the focus hand-back at the end of
    `Dialog.close()`, and they are a set rather than three takes on one thing.
    Measured on 2026-08-30 by mutating that one line and running this file plus
    tests/settings-pane-book-index.spec.ts, 17 tests in all:

      shipped   `if (document.activeElement === document.body) focus()`
                  -> 17 pass

      A         `if (!Dialog.anyOpen() && ...)`, ie. also requiring this to be
                the last dialog - the plausible-looking re-addition, since a
                surviving dialog reads like something that should keep the
                keyboard
                  -> only "hands the focus back even while another dialog
                     stays open" fails. This was the gap #281 was filed for:
                     before that test existed the whole set went green.

      B         unconditional `focus()`, no guard at all - the first version
                of the #242 fix
                  -> "does not take the focus off a field that still has it"
                     fails here, and so does settings-pane-book-index's
                     "a dialog closing on the first arrow does not steal the
                     focus off the index box".

      C         the hand-back deleted outright
                  -> both hand-back tests here fail; both settings-pane tests
                     pass, since nothing is being stolen.

    Read down the columns rather than across: A is caught by exactly one test
    in either file, the one #281 added, and by nothing else anywhere. B is
    caught by the live-field test here and by the settings-pane treatment.
    C is caught by the two hand-back tests here and by neither settings-pane
    test. So the guard's two halves fail in opposite directions and each needs
    its own test; a set missing any one of the three leaves a mutation green.
*/

type Page = import('@playwright/test').Page

const VERSION = version(2, 0, 55)

const ONE_CHEST = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

const ONE_ASSEMBLER = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'assembling-machine-1', position: { x: 0.5, y: 0.5 } }],
})

const TWO_CHESTS = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 8.5, y: 8.5 } },
    ],
})

/*
    Ctrl + right-drag over the entity, the same gesture
    tests/editor-mode-input.spec.ts documents. The 1px move after mouse-down
    is load-bearing: DELETE mode only *defines* the selection-area callback
    on entry, a later pointermove is what actually populates the entities
    under it, so a plain down/up with no move in between selects and
    deletes nothing.
*/
async function deleteEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await page.evaluate(n => window.__fbe_test.entityScreenPosition(n), entityNumber)
    if (!at) throw new Error(`entity ${entityNumber} not found in the loaded blueprint`)
    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(at.x + 1, at.y)
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')
}

async function openImportDialog(page: Page): Promise<void> {
    await page.evaluate(() => window.__fbe_test.openImportDialog())
}

/** Its Import sibling has had one since this spec was written; this is the
 * same call, and it is a toggle - a second one closes the dialog again. */
async function openExportDialog(page: Page): Promise<void> {
    await page.evaluate(() => window.__fbe_test.openExportDialog())
}

/** Fills ImportDialog's textarea - disambiguated from ExportDialog's
 * identically styled one by placeholder, see helpers/dialog-textareas.ts. */
async function fillImportField(page: Page, source: string): Promise<void> {
    await importTextarea(page).fill(source)
}

async function clickImportRow(page: Page, rowY: number): Promise<void> {
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(
        dialog.x + PADDING + ROW_BUTTON_WIDTH / 2,
        dialog.y + rowY + ROW_BUTTON_HEIGHT / 2
    )
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('exportString/exportImage/encodeCurrent report the empty-blueprint guard', async ({
    page,
}) => {
    /*
        The fresh, unloaded editor starts on an empty blueprint - see
        packages/website/src/index.ts's `new Blueprint()` fallback. Safe to
        call for real here: the guard fires before either reaches the
        clipboard or a file save.
    */
    expect(await page.evaluate(() => window.__fbe_test.exportGuardResult())).toEqual({
        exportString: false,
        exportImage: false,
    })
    expect(await page.evaluate(() => window.__fbe_test.encodeCurrentResult())).toBeUndefined()
})

test('encodeCurrent answers a string once a blueprint is loaded', async ({ page }) => {
    /*
        Pins the other side of the guard without calling exportString/
        exportImage themselves - `encodeCurrent` is pure serialization with no
        clipboard or file side effect, unlike its two siblings.
    */
    await loadBlueprint(page, ONE_CHEST)

    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    expect(out).toEqual(expect.any(String))
    expect(decodeBlueprintString(out as string).blueprint.entities[0].name).toBe('wooden-chest')
})

test("ImportDialog's Replace button calls importReplace and swaps the loaded blueprint", async ({
    page,
}) => {
    await loadBlueprint(page, ONE_CHEST)

    await openImportDialog(page)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)

    await fillImportField(page, ONE_ASSEMBLER)
    await clickImportRow(page, REPLACE_Y)

    // Closes only once the async import actually succeeds (#242 review), not
    // synchronously on click - waited for rather than asserted immediately.
    await page.waitForFunction(() => window.__fbe_test.openDialogCount() === 0)

    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    expect(decodeBlueprintString(out as string).blueprint.entities[0].name).toBe(
        'assembling-machine-1'
    )
})

test("ImportDialog's Append button calls importAppend and enters PAINT with the appended entities", async ({
    page,
}) => {
    /*
        appendBlueprint (Editor.ts) spawns a paint container rather than
        merging immediately - the same shape a paste does - so the observable
        result of a successful append is PAINT mode, not a changed entity
        count straight away.
    */
    await loadBlueprint(page, ONE_CHEST)

    await openImportDialog(page)
    await fillImportField(page, ONE_ASSEMBLER)
    await clickImportRow(page, APPEND_Y)

    // Same as Replace above - closes only once importAppend resolves true.
    await page.waitForFunction(() => window.__fbe_test.openDialogCount() === 0)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('PAINT')
    expect(await page.evaluate(() => window.__fbe_test.paintContainerVisible())).toBe(true)
})

test('Replace/Append do nothing and leave the dialog open when the field is empty', async ({
    page,
}) => {
    /*
        Used to call importReplace(''), which fell past bpString.ts's
        `DATA[0] === '0'` branch into `new URL('https://')` and threw -
        reported as "Invalid URL" rather than anything naming the actual
        problem (#242 review). Guarded up front now, before `action` is ever
        called, so the dialog stays open with the loaded blueprint untouched,
        the same as if nothing had been clicked at all.

        This no longer holds that guard up, and the measurement is the point.
        Issue #298 made `getBlueprintOrBookFromSource` reject an empty source
        instead of throwing, and every assertion here is satisfied by the
        rejection alone: it is caught by `importReplace`, resolves `false`,
        and `runImport` closes only on success - so the dialog stays open,
        the blueprint is untouched and no page error is raised whether or not
        `runImport` checks the field first. Measured 2026-09-01 by deleting
        that check: 15 of 15 passed, this test included.

        So what the test now pins is the *outcome*, which two separate
        mechanisms produce, and the guard itself is uncovered. The only thing
        it still decides alone is which warning appears - "Paste a blueprint
        string first.", naming the field, rather than "There was nothing to
        import." Nothing asserts that, here or anywhere.

        Worth knowing before deleting the guard as dead code: the outcome is
        the same, the message is worse, and no test will say so.
    */
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await loadBlueprint(page, ONE_CHEST)
    await openImportDialog(page)

    await clickImportRow(page, REPLACE_Y)
    await clickImportRow(page, APPEND_Y)

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    expect(pageErrors).toEqual([])

    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    expect(decodeBlueprintString(out as string).blueprint.entities[0].name).toBe('wooden-chest')
})

test('a bad blueprint string leaves the field intact and the dialog open, rather than closing on click', async ({
    page,
}) => {
    /*
        `close()` used to run synchronously right after the click, before the
        async import chain it started could even fail - so a hand-edited
        string that turned out to be bad was gone along with the dialog, and
        had to be retyped from scratch (#242 review). Now the promise
        `runImport` gets back has to resolve `true` before `close()` runs.
    */
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await loadBlueprint(page, ONE_CHEST)
    await openImportDialog(page)
    await fillImportField(page, 'not a blueprint string')
    await clickImportRow(page, REPLACE_Y)

    // No waitForFunction here on purpose - the point is that nothing ever
    // makes this true, so this is read once rather than polled for it.
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    expect(await importTextarea(page).inputValue()).toBe('not a blueprint string')
    expect(pageErrors).toEqual([])

    // The loaded blueprint is untouched too, not left half-imported.
    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    expect(decodeBlueprintString(out as string).blueprint.entities[0].name).toBe('wooden-chest')
})

test('Escape closes ImportDialog and ExportDialog even while the textarea has focus', async ({
    page,
}) => {
    /*
        Editor.ts's own keydown listener drops every key while an
        <input>/<textarea> is the event target (`e.target instanceof
        HTMLTextAreaElement`), so the app-level `closeWindow` action never
        ran and neither dialog had any way to close via keyboard once its
        field was focused - clicking the ToolsPanel slot again, or clicking
        the canvas first to blur, were the only exits (#242 review).
    */
    await openImportDialog(page)
    await importTextarea(page).click()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    await openExportDialog(page)
    await exportTextarea(page).click()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
})

test('Closing a dialog whose field held the focus hands the keyboard back to the canvas', async ({
    page,
}) => {
    /*
        Ctrl+C and Ctrl+V used to go silently dead after either dialog had
        been open (#242 review). `TextInput._onRemoved` takes the focused
        <input> out of document.body as the dialog is destroyed, which resets
        `document.activeElement` to <body>, and nothing focused the canvas
        back - so both clipboard listeners in packages/website/src/index.ts,
        each of which opens with `if (document.activeElement !== CANVAS)
        return`, returned early on every press. No toast, no error; clicking
        the canvas was the only way to get them back.

        This asserts on the focus rather than on a real Ctrl+C because the
        listeners' own guard *is* this condition - and a real copy would need
        clipboard permissions to report anything past it, which is exactly the
        browser-dependent path ExportDialog exists to avoid.
    */
    await loadBlueprint(page, ONE_CHEST)
    await openExportDialog(page)

    /*
        Load-bearing, though not for the reason this used to give: the canvas
        is not what the field takes the focus from. A fresh page has it on
        <body> - `waitForEditor` only navigates and `loadBlueprint` runs
        through `page.evaluate`, so nothing here has ever clicked. What this
        waits for is the field taking the focus so that destroying it is what
        *orphans* it, which is the condition `Dialog.close()` reads. Without
        it the close below could be handing back a focus it never took, and
        the assertion would say nothing about the guard.

        ExportDialog's focus is also deferred a tick past the render that
        shows the field (`ExportDialog.ts`), so this is a real barrier rather
        than a restatement of the line above it.
    */
    await expect(exportTextarea(page)).toBeFocused()

    await page.keyboard.press('Escape')

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
    await expect(page.locator('canvas#editor')).toBeFocused()
})

test('Closing a dialog hands the focus back even while another dialog stays open', async ({
    page,
}) => {
    /*
        The case `Dialog.close()`'s comment argues hardest for, and which
        nothing pinned until #281: the hand-back is deliberately *not* also
        conditional on this being the last dialog. Measured, every other test
        touching that guard - the two around this one and both in
        tests/settings-pane-book-index.spec.ts - passes under
        `!Dialog.anyOpen() && document.activeElement === document.body` as
        well, so re-adding that half would go green everywhere it was looked
        for. See this file's own mutation table above.

        Only ExportDialog focuses its own field; ImportDialog never does. So
        closing Export out from under an Import nobody has clicked leaves a
        dialog on screen, `document.activeElement` on <body>, and nothing
        focused - the same dead keyboard the guard exists to remove, with a
        dialog still open. That is the one state where the shipped guard and
        the `!anyOpen()` variant disagree.

        Import is opened first so that Export's field is the one holding the
        focus, and Export is closed through its own toggle, the same route
        the test below uses.
    */
    await loadBlueprint(page, ONE_CHEST)
    await openImportDialog(page)
    await openExportDialog(page)

    // Same barrier and the same reason as the test below - the field has to
    // hold the focus before the close, or the close orphans nothing.
    await expect(exportTextarea(page)).toBeFocused()

    await openExportDialog(page)

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    await expect(page.locator('canvas#editor')).toBeFocused()
})

test('Closing a dialog does not take the focus off a field that still has it', async ({ page }) => {
    /*
        The other half of the guard: the hand-back only claims focus that this
        close orphaned, so a live element keeps it.

        `document.activeElement === document.body` is what says which case this
        is. The first version of this guard read "is this the last dialog"
        instead, on the grounds that a surviving dialog's field is what the
        keyboard should be talking to - which this code does not do, since only
        ExportDialog focuses its own field. tests/settings-pane-book-index.spec.ts
        covers the same guard from outside the editor entirely, where an
        unconditional call cost a real user a keypress (#242 review).

        Both dialogs open, the focus deliberately parked in Import's field, and
        Export closed out from under it through its own toggle - not Escape,
        which the focused field would route to ImportDialog instead.
    */
    await loadBlueprint(page, ONE_CHEST)
    await openImportDialog(page)
    await openExportDialog(page)

    /*
        Barrier, not decoration. ExportDialog's own focus is deferred -
        `refreshText({ select: true })` schedules `select()` on
        `G.app.ticker.addOnce` (`ExportDialog.ts`) - so nothing otherwise
        orders it against the click below. Should the click ever win, the
        focus lands on Export's field instead, the toggle then destroys a
        *focused* field, the guard fires exactly as it should, and the last
        assertion fails on a 60s timeout that reads as a broken guard rather
        than as a raced test.
    */
    await expect(exportTextarea(page)).toBeFocused()

    await importTextarea(page).click()
    await expect(importTextarea(page)).toBeFocused()

    await openExportDialog(page)

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    await expect(importTextarea(page)).toBeFocused()
})

test('ImportDialog and ExportDialog can be open at once, and each helper still finds its own textarea', async ({
    page,
}) => {
    /*
        Nothing stops both being open together - `toggleImportDialog`/
        `toggleExportDialog` (UIContainer.ts) each track their own dialog
        independently. `cssText !== ''` used to be how both this spec and
        tools-panel.spec.ts told the two textareas apart, and it matched
        every TextInput equally (TextInput's constructor sets several inline
        styles on all of them), so with two on the page a bare `.find()`
        silently picked whichever the DOM happened to list first (#242
        review). `importTextarea`/`exportTextarea` key on each dialog's own
        placeholder instead, which this proves actually disambiguates them
        rather than coincidentally working with only one dialog open.
    */
    await loadBlueprint(page, ONE_CHEST)

    await openExportDialog(page)
    await openImportDialog(page)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(2)

    await fillImportField(page, ONE_ASSEMBLER)

    // The Import field holds what was just typed into it; the Export field
    // holds the loaded blueprint's own string - neither is the other's.
    expect(await importTextarea(page).inputValue()).toBe(ONE_ASSEMBLER)
    const exportValue = await exportTextarea(page).inputValue()
    expect(exportValue).not.toBe(ONE_ASSEMBLER)
    expect(decodeBlueprintString(exportValue).blueprint.entities[0].name).toBe('wooden-chest')
})

test("ExportDialog's field is read-only and pre-selected once the textarea actually renders", async ({
    page,
}) => {
    /*
        The blocking half of the #242 review: `select()` used to run inside
        the same microtask as `encodeCurrent()`'s resolution, before any
        render tick had shown the textarea (`TextInput._onAdded` sets
        `display: none`, and nothing sets it back to `block` until
        `_updateDOMInput` runs). `focus()`/`select()` on a `display: none`
        element are no-ops, so `document.activeElement` stayed the canvas and
        a plain Ctrl/Cmd+C fell through to `navigator.clipboard.writeText`
        instead of a hand-select - defeating the one thing this dialog exists
        to offer a clipboard-blocked browser. Now deferred to a tick after
        the render that shows the field, at UTILITY priority, below
        Application's own render step.
    */
    await loadBlueprint(page, ONE_CHEST)
    await openExportDialog(page)

    const textarea = exportTextarea(page)
    await expect(textarea).toBeFocused()
    expect(await textarea.evaluate((el: HTMLTextAreaElement) => el.readOnly)).toBe(true)

    const selection = await textarea.evaluate((el: HTMLTextAreaElement) => ({
        start: el.selectionStart,
        end: el.selectionEnd,
        length: el.value.length,
    }))
    expect(selection.length).toBeGreaterThan(0)
    expect(selection).toMatchObject({ start: 0, end: selection.length })
})

test('exportGuardResult reports the guard without writing to the clipboard or starting a file save', async ({
    page,
}) => {
    /*
        Used to call the real exportString()/exportImage() and report
        whatever they returned - which mirrors the guard only for an empty
        blueprint; for a loaded one it silently performed the real action,
        a real clipboard write and a real PNG download, every time it was
        called (#242 review, the other blocking issue). `__fbe_test` is
        dev-only since #292, so that no longer sits on `window` at
        fbe.factorygamefan.com for any script on the page to call - but it
        would still reach every spec here, because this suite runs against
        `vp dev`, where the hook exists. The gate is not what makes this
        safe; reading state instead of changing it is.

        The clipboard write is caught by wrapping `navigator.clipboard.
        writeText` before the app's own scripts run - has to happen before
        the shared beforeEach's first `page.goto`, so this reloads through
        waitForEditor again once the wrapper is registered. The file save is
        caught with Playwright's own `download` event, which needs no wrapper.
    */
    await page.addInitScript(() => {
        ;(window as unknown as { __clipboardWrites: string[] }).__clipboardWrites = []
        if (navigator.clipboard?.writeText) {
            const original = navigator.clipboard.writeText.bind(navigator.clipboard)
            navigator.clipboard.writeText = (text: string) => {
                ;(window as unknown as { __clipboardWrites: string[] }).__clipboardWrites.push(text)
                return original(text)
            }
        }
    })
    await waitForEditor(page)

    let downloadFired = false
    page.on('download', () => {
        downloadFired = true
    })

    await loadBlueprint(page, ONE_CHEST)

    const result = await page.evaluate(() => window.__fbe_test.exportGuardResult())
    expect(result).toEqual({ exportString: true, exportImage: true })

    // Proving a negative needs a bounded wait rather than a condition to
    // poll for - there is no event a correct implementation ever fires here.
    await page.waitForTimeout(250)

    const clipboardWrites = await page.evaluate(
        () => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites
    )
    expect(clipboardWrites).toEqual([])
    expect(downloadFired).toBe(false)
})

test('the export field re-encodes only when the blueprint actually changes, not on a blind interval (#242 review follow-up)', async ({
    page,
}) => {
    /*
        This used to re-encode on a plain 500 ms interval regardless of
        whether anything had changed - measured at a 310 ms median re-encode
        on the largest corpus blueprint, ~62% of the main thread and 19
        dropped frames every cycle the dialog sat open, purely idle, being
        read. `ExportDialog` now polls `History.revision` every frame (an
        integer compare) and only starts a debounced re-encode once that
        actually moves - see both doc comments.

        Nothing about the field's own text can prove the idle half of this:
        a re-encode of unchanged content is textually identical to no
        re-encode at all, which is exactly why `encodeCount` exists - see
        its own doc comment.
    */
    await loadBlueprint(page, TWO_CHESTS)
    await openExportDialog(page)

    /*
        Not polled: `refreshText`'s first line bumps `encodeCount`
        synchronously in the constructor, so the value is already whatever
        it will be by the time `openExportDialog()`'s own `evaluate()` call
        has returned - polling here only extended a real failure's report
        to the full poll timeout instead of failing immediately (#242
        review).
    */
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(1)

    // Idle for well over two of the old 500 ms interval's cycles - nothing
    // in the blueprint changed, so the count must not move.
    await page.waitForTimeout(1300)
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(1)

    const textBefore = await exportTextarea(page).inputValue()

    // ExportDialog does not block the canvas (its own doc comment), which
    // is the whole reason a stale field was reachable in the first place.
    await deleteEntity(page, 1)

    // One history transaction, debounced to exactly one re-encode - not
    // fired instantly (this is a wait for the debounce delay to elapse, not
    // a race against it).
    await expect
        .poll(() => page.evaluate(() => window.__fbe_test.exportEncodeCount()), { timeout: 2000 })
        .toBe(2)

    const textAfter = await exportTextarea(page).inputValue()
    expect(textAfter).not.toBe(textBefore)
    expect(decodeBlueprintString(textAfter).blueprint.entities).toHaveLength(1)
})

test('a burst of edits inside one debounce window collapses to a single re-encode (#242 review follow-up)', async ({
    page,
}) => {
    /*
        The test above cannot tell a real debounce from one that fires on the
        very next frame after a change - deleting the debounce entirely
        (encoding straight from `changeTick`) still passes it, since all it
        checks is that *a* second encode eventually happens, not that two edits
        close together produce exactly one (#242 review). What only a debounce
        produces is two revision-changing operations collapsing to a single
        re-encode: the count reaching 2 (one at open, one for the burst) and
        not 3.

        A delete then an undo, not two deletes: `History.revision` moves on
        either, and undo is one keypress with no pointer targeting.

        The window is widened first, past anything a round-trip here can take.
        At the shipped 500 ms this test raced the very timer it measured -
        `page.waitForTimeout` and every `page.evaluate` are wall-clock waits
        with no ceiling, so on a loaded shard the slack between the two
        operations could cross 500 ms on its own, fire the delete's re-encode
        alone, and make the burst genuinely two encodes - CPU contention
        wearing the shape of a bug (#313). Widened, nothing re-encodes on its
        own: `exportEncodeCount` staying at 1 through both edits is the "not
        one re-encode per change" check - the one a `waitForTimeout` + "still
        1" assertion used to reach for and lose to the same race - and
        `flushExportReencode()` then runs the single coalesced re-encode on
        demand.
    */

    // Poll this to a fixed value between an edit and the asserts that follow:
    // a delete drag and an undo both move `History.revision` over more than
    // one frame, and `changeTick` re-arms the (widened) debounce on each, so
    // a flush fired mid-settle would leave another re-encode armed behind it.
    const revisionSettled = async (): Promise<boolean> => {
        const before = await page.evaluate(() => window.__fbe_test.historyRevision())
        await page.waitForTimeout(100)
        return (await page.evaluate(() => window.__fbe_test.historyRevision())) === before
    }

    await loadBlueprint(page, TWO_CHESTS)
    await openExportDialog(page)
    await page.evaluate(() => window.__fbe_test.setExportReencodeDebounceMs(120_000))
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(1)

    await deleteEntity(page, 1)
    await expect.poll(revisionSettled).toBe(true)
    expect(await page.evaluate(() => window.__fbe_test.exportReencodePending())).toBe(true)
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(1)

    // The delete's own mousedown already blurred ExportDialog's read-only
    // field (focused since open), so this reaches the undo keybind rather
    // than being swallowed by Editor.ts's "ignore keys while an input has
    // focus" guard.
    await page.keyboard.press('Control+KeyZ')
    await expect
        .poll(() => page.evaluate(() => window.__fbe_test.entityScreenPosition(1) !== undefined))
        .toBe(true)
    await expect.poll(revisionSettled).toBe(true)

    // Still one armed re-encode for the whole burst, and still no encode yet -
    // the undo pushed the same debounce out rather than scheduling its own.
    expect(await page.evaluate(() => window.__fbe_test.exportReencodePending())).toBe(true)
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(1)

    // Run it: exactly one more encode, and nothing left armed after.
    expect(await page.evaluate(() => window.__fbe_test.flushExportReencode())).toBe(true)
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(2)
    expect(await page.evaluate(() => window.__fbe_test.flushExportReencode())).toBe(false)
    expect(await page.evaluate(() => window.__fbe_test.exportEncodeCount())).toBe(2)

    // The undo put entity 1 back - the field should show both chests again.
    await expect
        .poll(async () => {
            try {
                return decodeBlueprintString(await exportTextarea(page).inputValue()).blueprint
                    .entities.length
            } catch {
                return -1
            }
        })
        .toBe(2)
})
