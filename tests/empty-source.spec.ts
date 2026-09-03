import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    What the editor says when there is nothing to import - issue #298.

    `getBlueprintOrBookFromSource` guarded `undefined` and nothing else, so an
    empty string fell past the `DATA[0] === '0'` branch into
    `new URL('https://')` and threw `TypeError: Invalid URL`. `createBPImportError`
    does not recognise a bare TypeError, so it rendered through
    `createErrorMessage`, whose text ends "report this bug on github". Two live
    routes reach it, and the user is told to file a bug on both.

    The arithmetic is unit tested in packages/editor/src/core/bpString.test.ts,
    which is FD-free and runs in the cheap `checks` job. What needs a browser is
    everything below: which toast the website renders for the new error class,
    and - the reason this is not a message-only change - that the blueprint
    already on screen survives the attempt.

    ## Why the assertions are on the blueprint and not only on the toast

    Issue #298 proposed resolving an empty source to an empty `Blueprint`. That
    fixes the message and introduces something worse. `importReplace` pipes the
    resolved value into `loadBp` -> `Editor.loadBlueprint`, which assigns `G.bp`
    and destroys the old container, and `History` is per-`Blueprint`
    (Blueprint.ts:142) - so a stray Ctrl+V with an empty clipboard would clear
    the user's work with no warning and nothing to undo. That is the same
    mechanism issue #279 measured, recorded in clipboard-shortcuts.spec.ts's
    header. The second test here is what stands between this fix and that one:
    it fails against the resolving version and passes against the rejecting one,
    while both spell the toast identically.

    ## Toasts are asserted by text and class, never by count

    Startup raises up to three toasts on three different timers, one of which
    expires while a test is still running. `tests/toast-click-interception.spec.ts`
    records what keying an assertion on the total did to it. Nothing here counts
    them; each assertion names the toast it means.

    ## Mutation record (measured 2026-09-01)

    Five mutations, against these three tests and the four in
    packages/editor/src/core/bpString.test.ts. Test 2 looks like a control until
    the last row, which is the only thing that fails it - and it fails it hard.

      1. Delete the guard (the bug itself).
         unit 3 of 4 fail; browser 1 and 3 fail.
      2. `Promise.resolve(new Blueprint())` - issue #298's own proposal.
         unit 3 of 4 fail; browser 1 and 3 fail, 3 at "expected 1, received 0",
         which is the silent wipe.
      3. Guard `source` instead of `DATA`, i.e. before the whitespace strip.
         unit 1 of 4 fails, the whitespace one, and nothing else anywhere.
      4. Drop the `EmptyBlueprintStringError` arm from `createBPImportError`,
         so it falls to the catch-all. unit all 4 pass; browser 1 and 3 fail.
         This is the half no unit test can reach.
      5. `throw` instead of `return Promise.reject`. unit 3 of 4 fail; browser
         1 and 2 fail on a 2-minute timeout and 3 *passes*. The asymmetry is
         the point: startup calls `getBlueprintOrBookFromSource(bpSource)` and
         hangs `.catch` off the result, so a synchronous throw goes straight
         past it and `__fbe_test` never arrives - the editor does not start at
         all. The paste route reaches the same function through `.then`, which
         catches a sync throw, so it behaves identically either way.

    Rows 4 and 5 are why this spec exists next to the unit tests rather than
    instead of them, and row 2 is why the second assertion in test 3 is on the
    blueprint rather than on the toast.
*/

type Page = import('@playwright/test').Page

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const ONE_CHEST_COUNT = 1

const ONE_CHEST = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

/** The message the new error class carries, spelled once. */
const NOTHING_TO_IMPORT = 'There was nothing to import.'

/**
 * The half of the old message that made this worth fixing rather than
 * rewording. An empty clipboard is not a bug, and this asked for it to be filed.
 */
const BUG_REPORT_TEXT = 'report this bug on github'

/*
    Long enough that an import which was going to happen has happened. Both
    tests assert a negative - no error toast, no change to the blueprint - and a
    negative has no event to wait for, so the wait is bounded rather than
    conditional. Same shape and same length as clipboard-shortcuts.spec.ts's.
*/
const NOTHING_HAPPENS_MS = 1500

/** Every toast currently on screen, as `type: text` pairs. */
async function toasts(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll('.toasts-toast')).map(el => {
            const type =
                Array.from(el.classList)
                    .find(c => c.startsWith('toasts-') && c !== 'toasts-toast')
                    ?.replace('toasts-', '') ?? 'unknown'
            return `${type}: ${el.querySelector('.toasts-text')?.textContent ?? ''}`
        })
    )
}

/**
 * How many entities the loaded blueprint actually serializes to.
 *
 * The `undefined` arm is what makes a failure here readable, and it is the
 * answer for exactly one state: `encodeCurrent` guards an empty blueprint and
 * resolves `undefined` rather than encoding it. That is the state the wipe this
 * spec exists to catch leaves behind, so without the arm the interesting
 * mutation dies inside `decodeBlueprintString` with `Cannot read properties of
 * undefined (reading 'slice')` - a stack in a helper, naming neither the paste
 * nor the blueprint. Measured. With it, the same mutation reads "expected 1,
 * received 0".
 */
async function loadedEntityCount(page: Page): Promise<number> {
    const out = await page.evaluate(() => window.__fbe_test.encodeCurrentResult())
    if (out === undefined) return 0
    return decodeBlueprintString(out).blueprint.entities.length
}

test('an empty ?source= says what happened instead of asking for a bug report', async ({
    page,
}) => {
    await suppressOverlays(page)
    await page.goto('/?source=')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    const shown = await toasts(page)
    expect(shown.join('\n')).toContain(NOTHING_TO_IMPORT)
    expect(shown.join('\n')).not.toContain(BUG_REPORT_TEXT)
    expect(shown.filter(t => t.startsWith('error:'))).toEqual([])
})

/*
    And the editor still comes up. The startup chain catches the rejection and
    then loads an empty blueprint, so a `?source=` with nothing in it has to end
    somewhere a user can work rather than on the loading screen - which is what
    the `__fbe_test` hook arriving already means, per its own doc comment.
*/
test('an empty ?source= still opens a usable empty editor', async ({ page }) => {
    await suppressOverlays(page)
    await page.goto('/?source=')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    expect(await page.evaluate(() => window.__fbe_test.encodeCurrentResult())).toBeUndefined()
    expect(
        await page.evaluate(() => document.getElementById('loadingScreen')?.className)
    ).not.toContain('active')
})

test('a paste from an empty clipboard leaves the loaded blueprint alone', async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, ONE_CHEST)
    expect(await loadedEntityCount(page)).toBe(ONE_CHEST_COUNT)

    await page.evaluate(() => navigator.clipboard.writeText(''))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('')

    /*
        The click is load-bearing, not decoration: `clipboardShortcutsBelongToCanvas`
        requires the canvas to hold the focus, and measured in
        clipboard-shortcuts.spec.ts, `document.activeElement` right after a load
        is `<body>`. Without it the listener returns early and this test would
        pass against any version of the code at all.

        (150, 120) is empty canvas, away from the centred chest, the quickbar
        and ToolsPanel - the same point and the same reasoning as that spec.
    */
    await page.mouse.click(150, 120)
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor')

    // ControlOrMeta, not Control: the browser and the OS handle this chord, so
    // it is Cmd+V on macOS. See tests/spec-modifier-keys.test.ts.
    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(NOTHING_HAPPENS_MS)

    expect(await loadedEntityCount(page)).toBe(ONE_CHEST_COUNT)

    const shown = await toasts(page)
    expect(shown.join('\n')).toContain(NOTHING_TO_IMPORT)
    expect(shown.join('\n')).not.toContain(BUG_REPORT_TEXT)
})
