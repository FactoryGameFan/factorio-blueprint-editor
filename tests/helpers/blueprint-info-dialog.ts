import { ALIGNMENT_X, ALIGNMENT_Y } from '../../packages/editor/src/UI/BlueprintInfoEditor'

type Page = import('@playwright/test').Page

/*
    Opening BlueprintInfoEditor, for the two specs that drive it -
    tests/blueprint-info-editor.spec.ts and tests/blueprint-grid-position.spec.ts.
    Both used to carry their own copy of this, and the copies were identical,
    which is how the wait below came to be missing from both at once.
*/

/**
 * Opens the dialog and waits for its DOM fields to actually be where the
 * dialog is, handing back BlueprintAlignment's own origin in client
 * coordinates - the point every field click in either spec is computed from.
 *
 * The wait is load-bearing, not defensive. `TextInput` appends its `<input>`
 * to document.body on `added` and positions it from `worldTransform` in its
 * own render step, so for the first frame after the dialog opens the field
 * exists at full size in the top-left corner: measured immediately after
 * `openBlueprintInfoEditor()`, the Name field's rect is `0,0 336x19`, and
 * `472,200` once a frame has run. A click computed from `topDialogBounds()`
 * therefore lands on the canvas rather than the field, and it fails silently
 * - the keystrokes that follow reach the app's own keybinds instead, so the
 * spec sees an edit that simply never happened. That is the same
 * render-order trap ExportDialog's `select()` hit in the #242 review, and
 * the same fix: wait for the frame rather than assume it.
 */
export async function openBlueprintInfo(page: Page): Promise<{ x: number; y: number }> {
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())

    await page.waitForFunction(d => {
        // The dialog's own fields are the styled ones - TextInput sets
        // several inline styles on every instance, and the site's own
        // settings inputs carry none.
        const field = [...document.querySelectorAll('input')].find(el => el.style.cssText !== '')
        if (!field) return false
        const rect = field.getBoundingClientRect()
        return rect.x >= d.x && rect.y >= d.y
    }, dialog)

    return { x: dialog.x + ALIGNMENT_X, y: dialog.y + ALIGNMENT_Y }
}

/** Ticks the "Snap to grid" checkbox at BlueprintAlignment's own (0, 0). */
export async function enableSnapToGrid(page: Page, align: { x: number; y: number }): Promise<void> {
    await page.mouse.click(align.x + 8, align.y + 8)
}
