import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    First coverage of `QuickActions` (packages/editor/src/common/globals.ts) -
    the bridge ToolsPanel's quick-action buttons and ImportDialog/ExportDialog
    use to reach website-level clipboard/file logic (PR #221 review). Nothing
    under tests/ named ImportDialog, importReplace/importAppend, or
    exportString/exportImage before this.

    Two of its six members stay out of reach here on purpose: Paste and both
    export actions read `navigator.clipboard`/write through `FileSaver` once a
    blueprint is loaded, and a headless run has no OS clipboard to assert
    against and no safe way to let a real file-save attempt run. What IS safe
    and is covered:

    - importReplace/importAppend, driven through ImportDialog's real Replace/
      Append buttons with an explicit textarea value - the same route
      ImportDialog itself uses to bypass `navigator.clipboard` for a
      hand-edited or typed string.
    - The empty-blueprint guard exportString/exportImage/encodeCurrent all
      share, which is safe to call in any state: false/undefined with no
      clipboard or file attempt, never exercised past that guard here.
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

// ImportDialog's own layout - packages/editor/src/UI/ImportDialog.ts.
const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const ROW_Y = FIELD_Y + FIELD_HEIGHT + PADDING
const ROW_HEIGHT = 38
const GROUP_GAP = 14
const REPLACE_Y = ROW_Y + ROW_HEIGHT + GROUP_GAP
const APPEND_Y = REPLACE_Y + ROW_HEIGHT
// DescribedButton.ts: ROW_BUTTON_WIDTH x ROW_BUTTON_HEIGHT, at the row's own (x, y).
const BUTTON_CENTRE_X = PADDING + 40
const BUTTON_CENTRE_Y = 14

async function openImportDialog(page: Page): Promise<void> {
    await page.evaluate(() => window.__fbe_test.openImportDialog())
}

/** Fills ImportDialog's textarea - the one TextInput on the page with `multiline`. */
async function fillImportField(page: Page, source: string): Promise<void> {
    await page.locator('textarea').fill(source)
}

async function clickImportRow(page: Page, rowY: number): Promise<void> {
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(dialog.x + BUTTON_CENTRE_X, dialog.y + rowY + BUTTON_CENTRE_Y)
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

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)

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

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('PAINT')
    expect(await page.evaluate(() => window.__fbe_test.paintContainerVisible())).toBe(true)
})
