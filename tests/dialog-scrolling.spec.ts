import { test, expect, type Page } from '@playwright/test'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { suppressOverlays } from './helpers/overlays'
import {
    centre,
    dragThumb,
    expectThumbAgrees,
    scrollAfterMovesWithNoButton,
    scrollOf,
    settle,
    thumbOf,
    trackPointAboveThumb,
    trackPointBelowThumb,
    wheelAt,
    wheelAtMode,
} from './helpers/dialog-scroll'

/*
    Issue #643, the two dialogs that share the book's scrolling code: the
    inventory and the bill of materials. The book's own cases are in
    book-dialog.spec.ts. What is checked is the same everywhere - the wheel
    moves by pixels from anywhere over the list including the thumb, the thumb
    drags, a click on the track pages - plus the one thing that differs: a
    click that lands on a slot closes the inventory, so "still open" is what
    says the thumb and the track took the pointer.

    The inventory under test is the icon picker Blueprint Info opens, not the
    one E opens. E's tabs scroll very little (the first holds 76px more than
    it shows and the rest nothing), which cannot tell a page from a jump to the
    end, or one tab's place from another's. The picker is 512px wide and has
    tabs that scroll by 114, 38, 532, 114 and 380px. The default inventory
    still gets its own check below, since its 404px layout is where the track
    once lay over the last column of slots.

    The bill of materials needs more than 80 lines to scroll at all, and a line
    is an item at one quality. The all-entities blueprint supplies them, cut to
    entities of 1 tile and placed at normal and uncommon quality: 56 kinds make
    112 lines, enough to scroll by 176px. What costs time is drawing the
    blueprint's own entities, and these are cheap ones. Cut to 3 tiles instead,
    the same scroll took 8 seconds of frames to settle, per test.
*/

const dialogCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.openDialogCount())

/** Clicks tab `index` of the open inventory and lets it draw. */
async function clickTab(page: Page, index: number): Promise<void> {
    const tabs = await page.evaluate(() => window.__fbe_test.topDialogInventoryTabs())
    if (tabs === undefined) throw new Error('the open dialog is not an inventory')
    await page.mouse.click(tabs[index].x, tabs[index].y)
    await settle(page)
}

/** How far each tab of the open inventory can scroll, left to right. Leaves the last tab shown. */
async function tabMaxScrolls(page: Page): Promise<number[]> {
    const tabs = await page.evaluate(() => window.__fbe_test.topDialogInventoryTabs())
    if (tabs === undefined) throw new Error('the open dialog is not an inventory')
    const maxes: number[] = []
    for (let i = 0; i < tabs.length; i++) {
        await clickTab(page, i)
        maxes.push((await scrollOf(page)).maxScroll)
    }
    return maxes
}

/** Opens the default inventory (E). Answers how many dialogs are then open. */
async function openInventory(page: Page): Promise<number> {
    await page.locator('#editor').focus()
    await page.keyboard.press('KeyE')
    await expect.poll(() => dialogCount(page)).toBe(1)
    await settle(page)
    return 1
}

/**
 * The picker's longest tab, found by looking at every tab the first time and
 * remembered for the rest of the file: stepping through all of them costs
 * about a second per test, and the tabs do not change between tests.
 */
let longestTab: number | undefined

/**
 * Opens the icon picker over Blueprint Info and shows its longest tab.
 * Blueprint Info is the dialog under it, so two are open.
 */
async function openIconPicker(page: Page): Promise<number> {
    await page.evaluate(() => window.__fbe_test.openBlueprintInfoEditor())
    await settle(page)
    const info = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    // The first icon slot, at dialog-local (12, 119) and 36 across, as in
    // blueprint-info-editor.spec.ts.
    await page.mouse.click(info.x + 12 + 18, info.y + 119 + 18)
    await expect.poll(() => dialogCount(page)).toBe(2)
    await settle(page)
    if (longestTab === undefined) {
        const maxes = await tabMaxScrolls(page)
        longestTab = maxes.indexOf(Math.max(...maxes))
    }
    await clickTab(page, longestTab)
    return 2
}

async function openBillOfMaterials(page: Page): Promise<number> {
    await loadBlueprint(page, buildAllEntitiesBlueprint([0], 1, ['normal', 'uncommon']).source)
    await page.locator('#editor').focus()
    await page.keyboard.press('KeyB')
    await expect.poll(() => dialogCount(page)).toBe(1)
    await settle(page)
    return 1
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y]

const dialogs = [
    // `pagesApart`: whether the content is long enough for a page, a jump to
    // the end and a clamp to differ. The bill of materials is not - 176px more
    // than its viewport shows, short of the 304px a page moves - so its paging
    // check settles for the clamp, and the book and the picker tell page from
    // jump.
    { name: 'inventory (icon picker)', open: openIconPicker, pagesApart: true },
    { name: 'bill of materials', open: openBillOfMaterials, pagesApart: false },
]

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

for (const { name, open, pagesApart } of dialogs) {
    test.describe(`scrolling the ${name} (#643)`, () => {
        test('it has something to scroll', async ({ page }) => {
            await open(page)
            const state = await scrollOf(page)
            // The tests below move up to 67px.
            expect(state.maxScroll).toBeGreaterThanOrEqual(70)
            expect(state.thumb).toBeDefined()
        })

        test('several small wheel events scroll by their pixels', async ({ page }) => {
            await open(page)
            const { viewport } = await scrollOf(page)
            const at = { x: viewport.x + 100, y: viewport.y + 100 }
            for (let i = 0; i < 5; i++) await wheelAt(page, at, 10)
            expect((await scrollOf(page)).scroll).toBe(50)
            await wheelAt(page, at, 1)
            expect((await scrollOf(page)).scroll).toBe(51)
            await wheelAtMode(page, at, 1, 1)
            expect((await scrollOf(page)).scroll).toBe(67)
            await wheelAt(page, at, -67)
            expect((await scrollOf(page)).scroll).toBe(0)
        })

        test('the wheel stops at both ends, with the thumb flush at the bottom', async ({
            page,
        }) => {
            await open(page)
            const { viewport } = await scrollOf(page)
            const at = { x: viewport.x + 100, y: viewport.y + 100 }
            await wheelAt(page, at, -500)
            expect((await scrollOf(page)).scroll).toBe(0)
            await wheelAt(page, at, 100_000)
            const state = await scrollOf(page)
            expect(state.scroll).toBe(state.maxScroll)
            const thumb = await thumbOf(page)
            expect(thumb.y + thumb.height).toBeCloseTo(state.track.y + state.track.height, 0)
        })

        test('a wheel over the thumb scrolls', async ({ page }) => {
            const baseline = await open(page)
            await wheelAt(page, centre(await thumbOf(page)), 40)
            expect((await scrollOf(page)).scroll).toBe(40)
            expect(await dialogCount(page)).toBe(baseline)
        })

        test('dragging the thumb scrolls and leaves the dialog open', async ({ page }) => {
            const baseline = await open(page)
            const before = await scrollOf(page)
            const travel = before.track.height - (await thumbOf(page)).height
            await dragThumb(page, travel / 2)
            expectThumbAgrees(await scrollOf(page), before.maxScroll / 2)
            expect(await dialogCount(page)).toBe(baseline)
            // Far past the end of the track, and off the window: the thumb stops at the bottom.
            await dragThumb(page, 1000)
            expect((await scrollOf(page)).scroll).toBe(before.maxScroll)
            // And far above it, off the window the other way, back at the top.
            await dragThumb(page, -1000, before.viewport.x + 100)
            expect((await scrollOf(page)).scroll).toBe(0)
            expect(await dialogCount(page)).toBe(baseline)
        })

        test('letting go over the slots ends the drag without choosing one', async ({ page }) => {
            const baseline = await open(page)
            const { viewport } = await scrollOf(page)
            // Ends inside the viewport, over the slots, and lets go there.
            await dragThumb(page, 100, viewport.x + 100)
            const after = (await scrollOf(page)).scroll
            expect(after).toBeGreaterThan(0)
            expect(await dialogCount(page)).toBe(baseline)
            await page.mouse.move(viewport.x + 100, viewport.y + 20, { steps: 4 })
            await settle(page)
            expect((await scrollOf(page)).scroll).toBe(after)
        })

        test('a drag whose release was never seen ends when moves arrive with no button held', async ({
            page,
        }) => {
            const baseline = await open(page)
            expect(await scrollAfterMovesWithNoButton(page, 200)).toBe(0)
            expect(await dialogCount(page)).toBe(baseline)
        })

        test('a click on the track pages by a viewport and leaves the dialog open', async ({
            page,
        }) => {
            const baseline = await open(page)
            const { viewport, maxScroll } = await scrollOf(page)
            if (pagesApart) {
                // More than a page and less than two, so a page, a jump to the end and a clamp all differ.
                expect(maxScroll).toBeGreaterThan(viewport.height)
                expect(maxScroll).toBeLessThan(2 * viewport.height)
            }
            await page.mouse.click(...xy(await trackPointBelowThumb(page)))
            await settle(page)
            expect((await scrollOf(page)).scroll).toBe(Math.min(viewport.height, maxScroll))
            await page.mouse.click(...xy(await trackPointBelowThumb(page)))
            await settle(page)
            expect((await scrollOf(page)).scroll).toBe(maxScroll)
            await page.mouse.click(...xy(await trackPointAboveThumb(page)))
            await settle(page)
            expect((await scrollOf(page)).scroll).toBe(Math.max(0, maxScroll - viewport.height))
            expect(await dialogCount(page)).toBe(baseline)
        })

        test('the track sits beside the slots, not over them', async ({ page }) => {
            await open(page)
            const { viewport, track } = await scrollOf(page)
            expect(track.x).toBeGreaterThanOrEqual(viewport.x + viewport.width)
        })
    })
}

test('the default inventory: its track sits beside the last column, and a click on it chooses nothing', async ({
    page,
}) => {
    const baseline = await openInventory(page)
    const { viewport, track, maxScroll } = await scrollOf(page)
    expect(track.x).toBeGreaterThanOrEqual(viewport.x + viewport.width)
    expect(maxScroll).toBeGreaterThan(0)
    // Below the thumb, level with the last column of slots: once a slot.
    await page.mouse.click(...xy(await trackPointBelowThumb(page)))
    await settle(page)
    expect((await scrollOf(page)).scroll).toBe(maxScroll)
    expect(await dialogCount(page)).toBe(baseline)
})

test('each inventory tab keeps its own place, and a tab that fits has no scrollbar', async ({
    page,
}) => {
    await openIconPicker(page)
    const maxes = await tabMaxScrolls(page)
    const scrollable = maxes.flatMap((max, i) => (max >= 100 ? [i] : []))
    const fits = maxes.indexOf(0)
    expect(scrollable.length).toBeGreaterThanOrEqual(2)
    expect(fits).toBeGreaterThanOrEqual(0)
    const [a, b] = scrollable

    await clickTab(page, a)
    const at = (state: { viewport: { x: number; y: number } }) => ({
        x: state.viewport.x + 100,
        y: state.viewport.y + 100,
    })
    await wheelAt(page, at(await scrollOf(page)), 60)
    expect((await scrollOf(page)).scroll).toBe(60)

    // Another tab that scrolls starts at the top, and keeps its own place.
    await clickTab(page, b)
    expect((await scrollOf(page)).scroll).toBe(0)
    await wheelAt(page, at(await scrollOf(page)), 90)
    expect((await scrollOf(page)).scroll).toBe(90)

    // A tab that fits shows no scrollbar at all.
    await clickTab(page, fits)
    const flat = await scrollOf(page)
    expect(flat.maxScroll).toBe(0)
    expect(flat.scroll).toBe(0)
    expect(flat.thumb).toBeUndefined()

    // Back to each: the place it was left, and the thumb agrees with it.
    await clickTab(page, a)
    expectThumbAgrees(await scrollOf(page), 60)
    await clickTab(page, b)
    expectThumbAgrees(await scrollOf(page), 90)
})
