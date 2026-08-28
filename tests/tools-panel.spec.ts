import * as fs from 'fs'
import { test, expect } from '@playwright/test'
import { waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import {
    discoverBlueprintFiles,
    readBlueprintString,
    BlueprintFile,
} from './helpers/blueprint-files'
import { importTextarea } from './helpers/dialog-textareas'
import { PADDING, REPLACE_Y } from '../packages/editor/src/UI/ImportDialog'
import {
    ROW_BUTTON_WIDTH,
    ROW_BUTTON_HEIGHT,
} from '../packages/editor/src/UI/controls/DescribedButton'

/*
    ToolsPanel (#221 review, then #242). Three things the review asked to be
    pinned down, none of which any other spec touches: ImportDialog's
    textarea used to truncate a pasted blueprint string, the panel used to
    run off the right edge of a narrow viewport, and Replace's own click
    coordinates used to be a third hand-written copy of ImportDialog's
    layout as bare literals - quick-actions.spec.ts held a second - so a
    change to `GROUP_GAP` there could silently desync this file's click from
    the button it means to hit, a spec that fails by hitting nothing rather
    than by a clear assertion. Both `PADDING`/`REPLACE_Y` and
    `ROW_BUTTON_WIDTH`/`ROW_BUTTON_HEIGHT` are imported from the source files
    that declare them instead.
*/

/*
    The corpus's largest file rather than a hardcoded name - what matters is
    that it's bigger than the 2**20 (1 MiB) cap ImportDialog's textarea used
    to carry, and picking the largest measured one directly means this stays
    true even if the corpus changes. Read once at module scope, not per test:
    it's the input to one test only, but the file is ~2.4 MB and there is no
    reason to pay that read twice.

    Maps to {file, size} once and reduces over that, rather than the first
    version's `fs.statSync(largest.filePath)` inside the reducer, which
    re-stat'd the running maximum on every iteration - 2n syscalls for n
    files instead of n. And an explicit empty-corpus check up front, rather
    than handing `reduce` an empty array with no initial value: that throws
    `Reduce of empty array with no initial value` at module scope, which
    fails the whole spec file with a message naming neither the corpus nor
    this spec (#242 review).
*/
function largestBlueprintFile(): BlueprintFile {
    const files = discoverBlueprintFiles()
    if (files.length === 0) {
        throw new Error(
            'tools-panel.spec.ts: discoverBlueprintFiles() found no test-blueprints/ corpus - ' +
                'this spec needs one to pick its largest file from.'
        )
    }
    const sized = files.map(f => ({ file: f, size: fs.statSync(f.filePath).size }))
    return sized.reduce((largest, f) => (f.size > largest.size ? f : largest)).file
}

const LARGEST_BLUEPRINT_FILE = largestBlueprintFile()
const LARGEST_BLUEPRINT_STRING = readBlueprintString(LARGEST_BLUEPRINT_FILE.filePath)

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test("ImportDialog's textarea has no length cap and a large blueprint pastes without truncation", async ({
    page,
}) => {
    // Sanity on the fixture itself: the whole point is a string past the old
    // 2**20 (1 MiB) cap, so a corpus that shrank under that would silently
    // stop testing anything.
    expect(Buffer.byteLength(LARGEST_BLUEPRINT_STRING)).toBeGreaterThan(2 ** 20)

    await page.evaluate(() => window.__fbe_test.openImportDialog())

    const textarea = importTextarea(page)
    await expect(textarea).toHaveAttribute('placeholder', /.+/)
    expect(await textarea.getAttribute('maxlength')).toBeNull()

    /*
        Sets .value and dispatches 'input' directly rather than
        page.keyboard.type - typing 2.4 million characters one at a time
        would make this spec itself the slow thing, and a real OS paste is a
        single value assignment plus one input event, not a keystroke per
        character. What's under test is the field's capacity, not the typing
        path - tests/blueprint-grid-position.spec.ts already covers commit
        timing (blur vs. keystroke) for BlueprintAlignment's own fields.
    */
    await textarea.evaluate((el: HTMLTextAreaElement, text: string) => {
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, LARGEST_BLUEPRINT_STRING)

    const fieldLength = await textarea.evaluate((el: HTMLTextAreaElement) => el.value.length)
    expect(fieldLength).toBe(LARGEST_BLUEPRINT_STRING.length)
})

test('typing job control: a large paste actually loads through Replace, not just fills the field', async ({
    page,
}) => {
    // The field holding the full string proves nothing about the *button* it
    // feeds - Replace reads the same field's .text through TextInput, a
    // different code path (see ImportDialog.ts), and only this proves the
    // blueprint the user pasted is the one they get back rather than
    // whatever a truncated read produced.
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await page.evaluate(() => window.__fbe_test.openImportDialog())
    await importTextarea(page).evaluate((el: HTMLTextAreaElement, text: string) => {
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, LARGEST_BLUEPRINT_STRING)

    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(
        dialog.x + PADDING + ROW_BUTTON_WIDTH / 2,
        dialog.y + REPLACE_Y + ROW_BUTTON_HEIGHT / 2
    )

    /*
        Replace now closes the dialog only once the async import actually
        succeeds (#242 review), not synchronously on click - so this waits
        for the count to drop rather than asserting it immediately, the same
        shape tests/paste-cross-type-settings.spec.ts uses for a hover that
        settles asynchronously.
    */
    await page.waitForFunction(() => window.__fbe_test.openDialogCount() === 0)
    expect(pageErrors).toEqual([])
    // Not asserting the exact string back - loading re-centres positions, so
    // encodeLoaded() would not match byte-for-byte even on a perfect load.
    // A named entity from this specific file surviving the round trip is
    // what a truncated or corrupt read would not produce.
    const out = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    expect(out.length).toBeGreaterThan(2 ** 20)
})

test('ToolsPanel stays on screen at a narrow viewport width', async ({ page }) => {
    /*
        Below ~866px (see ToolsPanel.ts's setPosition doc comment) the
        unclamped position runs the panel off the right edge entirely. 800px
        is inside that range and still a real desktop width, not an extreme
        this project's UI otherwise ignores - mobile gets a different,
        editing-free UI and is out of scope here.

        Polled rather than read once: `setViewportSize` resolves once the
        browser itself has resized, not once pixi has handled the `resize`
        event, updated `G.app.screen.width` and re-run `setPosition` - a
        single read straight after raced that and intermittently saw the
        *previous* viewport's layout (measured 3 of 6 runs).

        The poll asserts the *joint* condition, and that is the whole of it:
        `x >= 0` alone is already true before the resize lands, since the
        stale 1280px layout puts the panel at `max(0, min(861, 1068))` =
        861, so polling for that half resolves on its first check and adds
        no wait whatsoever - leaving the right-edge assertion after it
        exposed to exactly the race the poll was added for. The sibling
        150px test below works only because its target (`x === 0`) is false
        in that same stale state. So the half that can actually tell the two
        viewports apart has to be the half inside the poll (#242 review).
    */
    await page.setViewportSize({ width: 800, height: 720 })

    await expect
        .poll(() =>
            page.evaluate(() => {
                const b = window.__fbe_test.toolsPanelBounds()
                return b.x >= 0 && b.x + b.width <= 800
            })
        )
        .toBe(true)
})

test('ToolsPanel does not run off the left edge below its own width (#242 review)', async ({
    page,
}) => {
    /*
        `setPosition`'s `Math.min` alone only ever clamps the *right* edge -
        below ~212px (the panel's own width, `24 + 38*5 - 2` for its 5
        columns) `screen.width - this.width` goes negative, and nothing
        stopped that from reaching `position.set`, pushing the panel off the
        *left* edge instead of merely overlapping the quickbar the way the
        800px case above does. 150px is inside that range.

        Same `setViewportSize`/resize race as the test above (measured 2 of
        5 runs here) - polled for the same reason.
    */
    await page.setViewportSize({ width: 150, height: 720 })

    await expect.poll(() => page.evaluate(() => window.__fbe_test.toolsPanelBounds().x)).toBe(0)
})
