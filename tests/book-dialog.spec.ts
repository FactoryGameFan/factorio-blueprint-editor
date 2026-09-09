import { test, expect, type Page } from '@playwright/test'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import {
    encodeBlueprint,
    encodeBlueprintBook,
    decodeBlueprintString,
    packVersion,
} from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

const version = packVersion(2, 0, 55)
const blueprint = (label: string, count = 1) => ({
    item: 'blueprint',
    label,
    version,
    icons: [],
    entities: Array.from({ length: count }, (_, i) => ({
        entity_number: i + 1,
        name: 'wooden-chest',
        position: { x: i + 0.5, y: 0.5 },
    })),
})
const book = (entries: Record<string, unknown>[]) => ({
    item: 'blueprint-book',
    version,
    active_index: 0,
    blueprints: entries.map((entry, index) => ({ ...entry, index })),
})
const openBook = async (page: Page) => {
    await page.mouse.click(212, 24)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    // Hit-testing needs the newly added Pixi viewport to have rendered.
    await page.screenshot()
    return page.evaluate(() => window.__fbe_test.topDialogBounds())
}
// Read actual rendered pixels, so a highlight hidden behind an opaque background fails.
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
    const png = await page.screenshot({
        clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
    })
    return page.evaluate(async data => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')
        if (!context) throw new Error('2D canvas unavailable')
        context.drawImage(image, 0, 0)
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
    }, png.toString('base64'))
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('book button is added, distinct from info, hidden for a bare blueprint; active row renders', async ({
    page,
}) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await loadBlueprint(page, encodeBlueprint(blueprint('Bare')))
    await page.mouse.click(212, 24)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
    await loadBlueprint(
        page,
        encodeBlueprintBook(
            book([{ blueprint: blueprint('First') }, { blueprint: blueprint('Second', 2) }])
        )
    )
    const bounds = await openBook(page)
    await page.mouse.move(350, 20)
    expect(await pixel(page, bounds.x + 250, bounds.y + 52)).toEqual([177, 105, 37])
    expect(await pixel(page, bounds.x + 250, bounds.y + 76)).toEqual([100, 100, 100])
    await page.keyboard.press('Escape')
    await page.mouse.click(170, 24)
    await expect(page.locator('input[style]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await loadBlueprint(page, encodeBlueprint(blueprint('Bare again')))
    await page.mouse.click(212, 24)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
    expect(errors).toEqual([])
})

test('nested rows skip planners and select the labelled flattened entry', async ({ page }) => {
    await loadBlueprint(
        page,
        encodeBlueprintBook(
            book([
                { blueprint: blueprint('First') },
                {
                    blueprint_book: book([
                        { blueprint: blueprint('Nested A', 2) },
                        { blueprint: blueprint('Nested B', 3) },
                    ]),
                },
                { upgrade_planner: { item: 'upgrade-planner', version, settings: {} } },
                { blueprint: blueprint('Last', 4) },
            ])
        )
    )
    const bounds = await openBook(page)
    await page.mouse.click(bounds.x + 300, bounds.y + 40 + 5 * 24 + 12)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(4)
    const exported = decodeBlueprintString(
        await page.evaluate(() => window.__fbe_test.encodeLoaded())
    )
    expect(exported.blueprint_book.active_index).toBe(3)
})

test('long book scrolls past one viewport, clicks the bottom right edge, and scrolls back', async ({
    page,
}) => {
    await loadBlueprint(
        page,
        encodeBlueprintBook(
            book(
                Array.from({ length: 30 }, (_, i) => ({
                    blueprint: blueprint(`Entry ${i}`, i + 1),
                }))
            )
        )
    )
    let bounds = await openBook(page)
    await page.mouse.move(bounds.x + 300, bounds.y + 345)
    for (let i = 0; i < 32; i++) {
        await page.mouse.wheel(0, 100)
        await page.waitForTimeout(20)
    }
    await page.mouse.click(bounds.x + 300, bounds.y + 348)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(30)
    bounds = await openBook(page)
    await page.mouse.move(bounds.x + 300, bounds.y + 345)
    for (let i = 0; i < 32; i++) {
        await page.mouse.wheel(0, 100)
        await page.waitForTimeout(20)
    }
    for (let i = 0; i < 32; i++) {
        await page.mouse.wheel(0, -100)
        await page.waitForTimeout(20)
    }
    await page.mouse.click(bounds.x + 300, bounds.y + 52)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)
})

test('blueprints hidden by the depth guard still count; null icons do not break opening', async ({
    page,
}) => {
    let deep = book([{ blueprint: blueprint('Hidden', 2) }])
    for (let i = 0; i < 10; i++) deep = book([{ blueprint_book: deep }])
    await loadBlueprint(
        page,
        encodeBlueprintBook(
            book([
                { blueprint: blueprint('First') },
                { blueprint_book: { ...deep, icons: [{ index: 1, signal: null }] } },
                { blueprint: blueprint('After deep', 3) },
            ])
        )
    )
    const bounds = await openBook(page)
    await page.mouse.move(bounds.x + 300, bounds.y + 340)
    await page.mouse.wheel(0, 100)
    // The last row must actually reach this point before clicking it.
    await page.mouse.move(bounds.x - 10, bounds.y)
    await expect.poll(() => pixel(page, bounds.x + 290, bounds.y + 348)).toEqual([100, 100, 100])
    await page.mouse.click(bounds.x + 300, bounds.y + 348)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(3)
})

test('book toggle preserves a dialog above it and closes only when topmost', async ({ page }) => {
    await loadBlueprint(page, encodeBlueprintBook(book([{ blueprint: blueprint('First') }])))
    await openBook(page)
    await page.mouse.click(170, 24)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(2)
    await page.mouse.click(212, 24)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(2)
    await page.mouse.click(170, 24)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    await page.mouse.click(212, 24)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
})
