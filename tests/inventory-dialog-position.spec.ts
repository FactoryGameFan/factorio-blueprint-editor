import { test, expect } from '@playwright/test'
import { suppressOverlays } from './helpers/overlays'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Where a dialog sits on a viewport too short to centre it comfortably
    (issue #347).

    Three defects, all in `setPosition`. `Dialog` centred on the screen with no
    clamp, so a dialog taller than the viewport put its top above the canvas
    and nothing can drag it back. It centred on the whole screen, though the
    inventory bar and the shortcut bar are drawn over dialogs along the bottom
    edge, so a dialog that fitted above them could still end up under them.
    And `InventoryDialog`'s override, which centres on 520 to take in the 78px
    recipe panel below its 442px body, never got to at open: `Panel`'s
    constructor calls `setPosition` before the subclass has assigned
    `m_ShowRecipePanel`, so the open position centred on 442 and pushed the
    recipe panel 39px lower than it needed to be.

    Read through `topDialogBounds`, the hook chest-editor.spec.ts locates dialog
    controls with. Its `height` is the dialog's own 442 for the inventory - the
    recipe panel is a child drawn below that - hence the constant here. The
    bars' top is read from the bars themselves, `quickbarBounds` and
    `shortcutBarBounds`, rather than written down, so a change to their size
    moves the expected values with it.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

interface Bounds {
    x: number
    y: number
    width: number
    height: number
}

/** InventoryDialog's full height with its recipe panel: 442 + 78. */
const INVENTORY_HEIGHT = 520

const topDialog = (page: Page): Promise<Bounds> =>
    page.evaluate(() => window.__fbe_test.topDialogBounds())

/** The higher of the two bars' top edges: where the space a dialog can use ends. */
const barsTop = (page: Page): Promise<number> =>
    page.evaluate(() =>
        Math.min(window.__fbe_test.quickbarBounds().y, window.__fbe_test.shortcutBarBounds().y)
    )

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

test('the inventory opens above the bottom bars when all of it fits there', async ({ page }) => {
    /*
        At 640 the bars' top is at 545, which leaves room for the 520px dialog
        with 12px above it and 13px between the recipe panel and the bars.
        Centred on the whole screen, as the first version of this fix did, the
        top is at 60 and the recipe panel's bottom at 580, 35px under the bars.
        Centred on 442 instead, as the open position was, it is 39px lower
        still.
    */
    await load(page, 640)
    await openInventory(page)

    const top = await barsTop(page)
    const dialog = await topDialog(page)
    expect(top).toBeGreaterThanOrEqual(INVENTORY_HEIGHT)
    expect(dialog.y).toBe(Math.floor((top - INVENTORY_HEIGHT) / 2))
    expect(dialog.y + INVENTORY_HEIGHT).toBeLessThanOrEqual(top)
})

test('the inventory keeps its top on screen when the viewport shrinks below it', async ({
    page,
}) => {
    /*
        Opened on a viewport it fits, then shrunk below it, so it is the
        resize path, which did use 520: centred on the whole screen, the top
        went to 225 - 260 = -35, cutting off the title and half the group tabs.
        At 450 the dialog does not fit above the bars, so its bottom still runs
        under them and off the screen; only the top is kept.

        Polled, and on a value the stale layout cannot give: `setViewportSize`
        resolves before pixi has handled the resize (shortcut-bar.spec.ts has
        the measurement), and before the resize lands the dialog sits where
        the 720 layout put it, not at 0.
    */
    await load(page, 720)
    await openInventory(page)
    const top = await barsTop(page)
    const open = await topDialog(page)
    expect(open.y).toBe(Math.floor((top - INVENTORY_HEIGHT) / 2))
    expect(open.y).toBeGreaterThan(0)
    expect(open.y + INVENTORY_HEIGHT).toBeLessThanOrEqual(top)

    await page.setViewportSize({ width: 1280, height: 450 })
    await expect.poll(async () => (await topDialog(page)).y).toBe(0)
})

test('any dialog centres above the bottom bars, and keeps its top on screen when it cannot fit', async ({
    page,
}) => {
    /*
        The centring and the clamp are in `Dialog`, so every dialog without
        its own `setPosition` gets them - which is all of them but the
        inventory. The import dialog stands in for the rest: centred above the
        bars at 720, then shrunk to half its own height.
    */
    await load(page, 720)
    await page.evaluate(() => window.__fbe_test.openImportDialog())
    const top = await barsTop(page)
    const open = await topDialog(page)
    expect(open.y).toBe(Math.floor((top - open.height) / 2))
    expect(open.y).toBeGreaterThan(0)
    expect(open.y + open.height).toBeLessThanOrEqual(top)

    await page.setViewportSize({ width: 1280, height: Math.floor(open.height / 2) })
    await expect.poll(async () => (await topDialog(page)).y).toBe(0)
})
