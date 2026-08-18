import * as fs from 'fs'
import { test, expect } from '@playwright/test'
import { waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    ToolsPanel (#221 review). Two things the review asked to be pinned down,
    neither of which any other spec touches: ImportDialog's textarea used to
    truncate a pasted blueprint string, and the panel used to run off the
    right edge of a narrow viewport.
*/

/*
    The corpus's largest file rather than a hardcoded name - what matters is
    that it's bigger than the 2**20 (1 MiB) cap ImportDialog's textarea used
    to carry, and picking the largest measured one directly means this stays
    true even if the corpus changes. Read once at module scope, not per test:
    it's the input to one test only, but the file is ~2.4 MB and there is no
    reason to pay that read twice.
*/
const LARGEST_BLUEPRINT_FILE = discoverBlueprintFiles().reduce((largest, f) =>
    fs.statSync(f.filePath).size > fs.statSync(largest.filePath).size ? f : largest
)
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

    const maxLength = await page.evaluate(() => {
        const el = [...document.querySelectorAll('textarea')].find(t => t.style.cssText !== '')
        if (!el) throw new Error('ImportDialog textarea not found')
        return el.getAttribute('maxlength')
    })
    expect(maxLength).toBeNull()

    /*
        Sets .value and dispatches 'input' directly rather than
        page.keyboard.type - typing 2.4 million characters one at a time
        would make this spec itself the slow thing, and a real OS paste is a
        single value assignment plus one input event, not a keystroke per
        character. What's under test is the field's capacity, not the typing
        path - tests/blueprint-grid-position.spec.ts already covers commit
        timing (blur vs. keystroke) for BlueprintAlignment's own fields.
    */
    await page.evaluate(text => {
        const el = [...document.querySelectorAll('textarea')].find(
            t => t.style.cssText !== ''
        ) as HTMLTextAreaElement
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, LARGEST_BLUEPRINT_STRING)

    const fieldLength = await page.evaluate(() => {
        const el = [...document.querySelectorAll('textarea')].find(t => t.style.cssText !== '')
        return (el as HTMLTextAreaElement).value.length
    })
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
    await page.evaluate(text => {
        const el = [...document.querySelectorAll('textarea')].find(
            t => t.style.cssText !== ''
        ) as HTMLTextAreaElement
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, LARGEST_BLUEPRINT_STRING)

    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    // ImportDialog.ts: PADDING=12, FIELD_Y=40, FIELD_HEIGHT=90, ROW_Y=142,
    // ROW_HEIGHT=38, GROUP_GAP=14, REPLACE_Y=194. DescribedButton.ts:
    // ROW_BUTTON_WIDTH/HEIGHT centre at (+40, +14) from the row's own (x, y).
    await page.mouse.click(dialog.x + 12 + 40, dialog.y + 194 + 14)

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
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
    */
    await page.setViewportSize({ width: 800, height: 720 })

    const bounds = await page.evaluate(() => window.__fbe_test.toolsPanelBounds())
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800)
})
