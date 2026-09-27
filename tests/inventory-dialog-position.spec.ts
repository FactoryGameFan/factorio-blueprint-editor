import { test, expect } from '@playwright/test'
import { suppressOverlays } from './helpers/overlays'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Where a dialog sits on a viewport too short to centre it comfortably
    (issue #347).

    Two defects, both in `setPosition`. `Dialog` centred on the screen with no
    clamp, so a dialog taller than the viewport put its top above the canvas
    and nothing can drag it back. And `InventoryDialog`'s override, which
    centres on 520 to take in the 78px recipe panel below its 442px body, never
    got to at open: `Panel`'s constructor calls `setPosition` before the
    subclass has assigned `m_ShowRecipePanel`, so the open position centred on
    442 and pushed the recipe panel 39px lower than it needed to be.

    Read through `topDialogBounds`, the hook chest-editor.spec.ts locates dialog
    controls with. Its `height` is the dialog's own 442 for the inventory - the
    recipe panel is a child drawn below that - hence the constant here.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/** InventoryDialog's full height with its recipe panel: 442 + 78. */
const INVENTORY_HEIGHT = 520

const topDialog = (page: Page): Promise<{ x: number; y: number; height: number }> =>
    page.evaluate(() => window.__fbe_test.topDialogBounds())

/** E with nothing open opens the inventory, recipe panel included - Editor.ts's `inventory` action. */
async function openInventory(page: Page): Promise<void> {
    await page.keyboard.press('KeyE')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
}

/** Sized before the page loads, so the editor starts on that viewport and no resize can race the first read. */
async function load(page: Page, height: number): Promise<void> {
    await page.setViewportSize({ width: 1280, height })
    await suppressOverlays(page)
    await waitForEditor(page)
}

test('the inventory opens with its recipe panel on screen when all of it fits', async ({
    page,
}) => {
    /*
        560 fits the 520px dialog with 20px each side. Centred on 442 instead,
        as the open position was, the top landed at 59 and the recipe panel's
        bottom at 579, 19px off the bottom of a viewport it fits in.
    */
    await load(page, 560)
    await openInventory(page)

    expect((await topDialog(page)).y).toBe((560 - INVENTORY_HEIGHT) / 2)
})

test('the inventory keeps its top on screen when the viewport shrinks below it', async ({
    page,
}) => {
    /*
        Opened on a viewport it fits, then shrunk below it, so it is the
        resize path, which did use 520: centred, the top went to
        225 - 260 = -35, cutting off the title and half the group tabs.

        Polled, and on a value the stale layout cannot give: `setViewportSize`
        resolves before pixi has handled the resize (shortcut-bar.spec.ts has
        the measurement), and before the resize lands the dialog sits at
        (720 - 520) / 2 = 100, not 0.
    */
    await load(page, 720)
    await openInventory(page)
    expect((await topDialog(page)).y).toBe((720 - INVENTORY_HEIGHT) / 2)

    await page.setViewportSize({ width: 1280, height: 450 })
    await expect.poll(async () => (await topDialog(page)).y).toBe(0)
})

test('any dialog taller than the viewport keeps its top on screen', async ({ page }) => {
    /*
        The clamp is in `Dialog`, so every dialog without its own
        `setPosition` gets it - which is all of them but the inventory. The
        import dialog stands in for the rest, shrunk to half its own height.
    */
    await load(page, 720)
    await page.evaluate(() => window.__fbe_test.openImportDialog())
    const open = await topDialog(page)
    expect(open.y).toBeGreaterThan(0)

    await page.setViewportSize({ width: 1280, height: Math.floor(open.height / 2) })
    await expect.poll(async () => (await topDialog(page)).y).toBe(0)
})
