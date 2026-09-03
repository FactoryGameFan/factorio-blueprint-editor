import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { importTextarea } from './helpers/dialog-textareas'

/*
    What the `copy` and `paste` document listeners in
    packages/website/src/index.ts do while a dialog is open (issue #279).

    Nothing under tests/ pressed Ctrl+C or Ctrl+V at all before this.
    tests/quick-actions.spec.ts drives both dialogs and both import actions,
    but only through ImportDialog's own buttons and the `__fbe_test` hooks -
    its own header says the real clipboard read "stays out of reach here".
    That is what left the bug live: the listeners' guard was
    `document.activeElement !== CANVAS` and nothing else, and the ordinary
    route to ImportDialog leaves the canvas focused, because clicking
    ToolsPanel's Import slot *is* a click on the canvas and ImportDialog
    never focuses its own field (only ExportDialog does). So Ctrl+V with the
    Import dialog open ran `importReplace()` and replaced the whole blueprint
    from the OS clipboard, closing the dialog and taking anything typed into
    its field with it - and the fresh blueprint carries a fresh empty
    `History`, so neither Ctrl+Z nor the ToolsPanel Undo slot brought the old
    one back.

    ## The clipboard is reachable here, unlike in quick-actions.spec.ts

    `test.use({ permissions: [...] })` grants clipboard-read/clipboard-write
    for this file's context, which lets the spec seed the OS clipboard with
    `navigator.clipboard.writeText` and read it back. Measured: a real
    `keyboard.press('ControlOrMeta+v')` on the focused canvas dispatches a
    real `paste` event to `document`, so these tests drive the shipped
    listener rather than a synthetic `ClipboardEvent`.

    `ControlOrMeta`, not `Control`: this chord is handled by the browser and
    the OS - it is Cmd+V on macOS - so it is the second of the two classes
    tests/spec-modifier-keys.test.ts describes and needs no allowlist entry.

    ## Two blueprints, and why the focus is asserted every time

    Blueprint A is one chest and blueprint B is five, so
    `entityContainerCount()` names which one is live in a single number.

    The four tests that run against a started editor click the canvas at
    (150, 120) first, and that click is load-bearing rather than decoration:
    measured, `document.activeElement` right after `loadBlueprint` is
    `<body>`, not the canvas, and with the canvas unfocused the listeners'
    *original* guard already returns early - so a test that skipped the click
    would pass against the unfixed code for a reason having nothing to do
    with dialogs. The fifth reaches the canvas with a Tab instead, since it
    presses its keys before the editor has drawn anything to click.

    (150, 120) is empty canvas away from the centred blueprint, from the
    quickbar and from ToolsPanel; measured, it leaves the editor in NONE mode
    with no dialog open and no entity hovered - a click on the chest itself
    would enter EDIT and open the entity GUI, which is a dialog. The
    tests that open a dialog then assert the canvas *still* holds the focus,
    which is the premise the whole issue rests on - if ImportDialog ever
    started focusing its own field, these would silently stop testing the new
    guard and start testing the old one.

    ## Positive controls

    Two of the five tests are controls, and they carry as much weight as the
    gated pair: a "fix" that simply killed both listeners passes the gated
    tests and fails these.

    ## Mutation record (measured 2026-08-30)

    Mutation 1, reverting the fix - `clipboardShortcutsBelongToCanvas()` back
    to a bare `document.activeElement !== CANVAS` early return in both
    listeners. 2 failed, 3 passed:

      - "Ctrl+V does not touch the blueprint while ImportDialog is open"
        FAILS at
            expect(await page.evaluate(() =>
                window.__fbe_test.entityContainerCount())).toBe(ONE_CHEST_COUNT)
        with
            Error: expect(received).toBe(expected) // Object.is equality
            Expected: 1
            Received: 5
      - "Ctrl+C does not touch the clipboard while ImportDialog is open"
        FAILS at
            expect(await page.evaluate(() => navigator.clipboard.readText()))
                .toBe(FIVE_CHESTS)
        with the received value being the loaded blueprint's own string
        rather than the seeded five-chest one.
      - Both controls still PASS, which is what says the two failures above
        are about the dialog and not about the listeners being dead.

    Mutation 2, dropping only the `startupFinished &&` term. 1 failed, 4
    passed - and the four that pass are the whole reason the fifth test
    exists:

      - "a clipboard shortcut pressed before startup finishes does nothing at
        all" FAILS at `expect(pageErrors).toEqual([])` with two entries of
            "Cannot read properties of undefined (reading 'openDialogCount')"
        one per press.

    Restored, all five pass.
*/

type Page = import('@playwright/test').Page

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const VERSION = version(2, 0, 55)

const ONE_CHEST_COUNT = 1
const FIVE_CHESTS_COUNT = 5

/** Blueprint A - what the editor has loaded when each test starts. */
const ONE_CHEST = encode({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

/** Blueprint B - what sits on the OS clipboard, waiting to be pasted. */
const FIVE_CHESTS = encode({
    item: 'blueprint',
    version: VERSION,
    entities: Array.from({ length: FIVE_CHESTS_COUNT }, (_, i) => ({
        entity_number: i + 1,
        name: 'wooden-chest',
        position: { x: i * 2 + 0.5, y: 0.5 },
    })),
})

/*
    Long enough that a paste which was going to happen has happened. Measured
    against the ungated control below, which settles in well under half of
    this; a negative has no event to poll for, so the wait is bounded rather
    than conditional - the same shape quick-actions.spec.ts uses for its own
    "nothing reached the clipboard" check.
*/
const NOTHING_HAPPENS_MS = 1500

/*
    How long data.json is held back in the startup test, the same technique
    tests/test-hook-readiness.spec.ts uses. Comfortably longer than the Tab,
    the two key presses and NOTHING_HAPPENS_MS that run inside it, so every
    assertion there is made while startup is genuinely unfinished.
*/
const STARTUP_DELAY_MS = 6000

/**
 * Puts the keyboard focus on the canvas the way a user does, and proves it
 * landed there - see the header for why skipping this makes every test here
 * pass against the unfixed code.
 */
async function focusCanvasByClicking(page: Page): Promise<void> {
    await page.mouse.click(150, 120)
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor')
}

async function openImportDialog(page: Page): Promise<void> {
    await page.evaluate(() => window.__fbe_test.openImportDialog())
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    // The premise of issue #279: opening it does not take the focus off the
    // canvas, so the original guard let the shortcut straight through.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor')
}

async function seedClipboard(page: Page, text: string): Promise<void> {
    await page.evaluate(t => navigator.clipboard.writeText(t), text)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
}

/** How many entities the loaded blueprint actually serializes to. */
async function loadedEntityCount(page: Page): Promise<number> {
    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    return decodeBlueprintString(out as string).blueprint.entities.length
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('Ctrl+V does not touch the blueprint while ImportDialog is open', async ({ page }) => {
    /*
        The reported bug. Blueprint A loaded, blueprint B on the clipboard,
        the Import dialog open and the canvas still focused - the exact state
        the issue measured 1 -> 5 entities and 1 -> 0 dialogs in.

        The Import field is filled by assigning `.value` and dispatching
        `input`, not through Playwright's `fill()`, and that is not a
        shortcut: `fill()` focuses the textarea, which would make
        `document.activeElement` the field rather than the canvas and hand the
        test to the *old* half of the guard - it would then pass with the fix
        reverted. Same technique tools-panel.spec.ts uses, for its own
        reasons.
    */
    await loadBlueprint(page, ONE_CHEST)
    await seedClipboard(page, FIVE_CHESTS)
    await focusCanvasByClicking(page)
    await openImportDialog(page)

    const typed = 'a string the user was part way through pasting in by hand'
    await importTextarea(page).evaluate((el: HTMLTextAreaElement, text: string) => {
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, typed)
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor')

    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(NOTHING_HAPPENS_MS)

    // Blueprint A is still the one on screen, and still the one in the model.
    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(
        ONE_CHEST_COUNT
    )
    expect(await loadedEntityCount(page)).toBe(ONE_CHEST_COUNT)

    // And the dialog the user was working in survived, with what they had
    // typed into it - `Editor.loadBlueprint` calls `Dialog.closeAll()`, so
    // losing the blueprint and losing the dialog are one event.
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    expect(await importTextarea(page).inputValue()).toBe(typed)
})

test('Ctrl+V still replaces the blueprint when no dialog is open', async ({ page }) => {
    /*
        The control for the test above. Without it, a "fix" that stopped the
        paste listener firing at all - or removed it - would pass everything
        else in this file. Replace is what Ctrl+V has always done on the bare
        canvas and this pins that it still does.
    */
    await loadBlueprint(page, ONE_CHEST)
    await seedClipboard(page, FIVE_CHESTS)
    await focusCanvasByClicking(page)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    await page.keyboard.press('ControlOrMeta+v')

    await expect
        .poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount()))
        .toBe(FIVE_CHESTS_COUNT)
    expect(await loadedEntityCount(page)).toBe(FIVE_CHESTS_COUNT)
})

test('Ctrl+C does not touch the clipboard while ImportDialog is open', async ({ page }) => {
    /*
        The milder twin, and the reason both listeners took the guard rather
        than only `paste`. The only Ctrl+C that reaches the listener with
        ImportDialog open is one pressed while the canvas holds the focus -
        clicking into the field would make it the `activeElement` and stop the
        listener anyway - so it is pressed by someone looking at an Import
        field, and what it does is overwrite the blueprint string they were
        about to paste into that field with the loaded blueprint's own.

        Asserted on the clipboard's *contents* rather than on a count of
        writes, because the contents are the thing the user loses. Measured
        first that the browser's own default copy of an empty canvas selection
        leaves the clipboard alone, so a surviving string means the listener
        returned early rather than the default action having quietly cleaned
        up after it.
    */
    await loadBlueprint(page, ONE_CHEST)
    await seedClipboard(page, FIVE_CHESTS)
    await focusCanvasByClicking(page)
    await openImportDialog(page)

    await page.keyboard.press('ControlOrMeta+c')
    await page.waitForTimeout(NOTHING_HAPPENS_MS)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIVE_CHESTS)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
})

test('Ctrl+C still copies the blueprint string when no dialog is open', async ({ page }) => {
    /*
        The control for the test above, and the same argument: a fix that
        broke the copy listener outright passes the gated test.

        Seeded with a sentinel that is not a blueprint string, so "the
        clipboard changed" and "the clipboard holds this blueprint" are two
        separate things and the assertion below is the second one.
    */
    const SENTINEL = 'not-a-blueprint-string'

    await loadBlueprint(page, ONE_CHEST)
    await seedClipboard(page, SENTINEL)
    await focusCanvasByClicking(page)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

    await page.keyboard.press('ControlOrMeta+c')

    // `exportString` encodes and then writes, both async, so this is polled
    // rather than read once.
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(SENTINEL)

    const written = await page.evaluate(() => navigator.clipboard.readText())
    expect(decodeBlueprintString(written).blueprint.entities).toHaveLength(ONE_CHEST_COUNT)
})

test('a clipboard shortcut pressed before startup finishes does nothing at all', async ({
    page,
}) => {
    /*
        The third condition in the guard, and the only thing that can see it -
        deleting `startupFinished &&` leaves all four tests above green.

        `Editor.openDialogCount` reads `G.UI`, which `Editor.init` assigns only
        after awaiting data.json, while these listeners are registered as the
        module runs. The canvas is reachable in that window: it carries
        `tabindex="1"` and one Tab press focuses it straight through the
        loading screen.

        Measured on the unfixed code, with the canvas focused during a held-back
        data.json load: Ctrl+C threw an uncaught "Cannot read properties of
        undefined (reading 'isEmpty')", and Ctrl+V raised a "Blueprint string
        could not be loaded" toast - `importReplace` gets as far as
        `Editor.loadBlueprint`, which has no `G.BPC` yet, and its own catch
        reports that as a bad blueprint string. Neither names the real problem,
        and the second blames the user's clipboard for it.

        So this is not only about not making that worse by reading `G.UI` a line
        earlier. A key press before the editor exists should do nothing, which
        is what is asserted: no page error, no toast, and the clipboard the user
        was about to paste from left alone.
    */
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await seedClipboard(page, FIVE_CHESTS)

    await page.route('**/data/data.json', async route => {
        await new Promise(resolve => setTimeout(resolve, STARTUP_DELAY_MS))
        await route.continue()
    })
    await page.goto('/')

    await page.keyboard.press('Tab')
    // Asserted rather than assumed: if the canvas ever stops being first in the
    // tab order this fails loudly instead of quietly testing an unfocused page,
    // where the original guard already returns early.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor')
    expect(await page.evaluate(() => '__fbe_test' in window)).toBe(false)

    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(NOTHING_HAPPENS_MS)

    expect(pageErrors).toEqual([])
    expect(await page.locator('.toasts-toast').count()).toBe(0)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIVE_CHESTS)
})
