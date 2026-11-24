import { test, expect, type Page } from '@playwright/test'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import {
    encodeBlueprint,
    encodeBlueprintBook,
    decodeBlueprintString,
    packVersion,
} from './helpers/encode-blueprint'
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

/*
    Issue #643: the scrollbar did nothing but sit there. The thumb had no
    handlers, so it could not be dragged, a wheel over it was swallowed, and a
    click beside it fell through to the row under it - which loads that entry
    and closes the dialog. And the wheel moved a whole row per event whatever
    its size, so a browser that splits one notch into several small events
    (Chrome and Edge on Windows) flew down the list.

    40 entries make 960px of rows in a 320px viewport: 640px of travel. The
    book starts on entry 0, which holds one entity, so the loaded entity count
    and the exported `active_index` both say whether a click selected a row.
*/
const LONG_BOOK = encodeBlueprintBook(
    book(Array.from({ length: 40 }, (_, i) => ({ blueprint: blueprint(`Entry ${i}`, i + 1) })))
)
const ROW = 24
const VIEWPORT = 320
const MAX_SCROLL = 40 * ROW - VIEWPORT

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y]

/** Still open, and still on entry 0: nothing was selected. */
async function expectUntouched(page: Page): Promise<void> {
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)
    const exported = decodeBlueprintString(
        await page.evaluate(() => window.__fbe_test.encodeLoaded())
    )
    expect(exported.blueprint_book.active_index).toBe(0)
}

async function openLongBook(page: Page) {
    await loadBlueprint(page, LONG_BOOK)
    const bounds = await openBook(page)
    await settle(page)
    return bounds
}

test.describe('scrolling a long book (#643)', () => {
    test('several small wheel events scroll by their pixels, not a row each', async ({ page }) => {
        const bounds = await openLongBook(page)
        const at = { x: bounds.x + 150, y: bounds.y + 200 }
        expect((await scrollOf(page)).scroll).toBe(0)
        // One 100px notch split into five, as Chrome and Edge do on Windows.
        for (let i = 0; i < 5; i++) await wheelAt(page, at, 20)
        expect((await scrollOf(page)).scroll).toBe(100)
        // A one-pixel event is one pixel, not a row.
        await wheelAt(page, at, 1)
        expect((await scrollOf(page)).scroll).toBe(101)
        // And back up by the same amount.
        await wheelAt(page, at, -101)
        expect((await scrollOf(page)).scroll).toBe(0)
    })

    test('the wheel reads deltaMode: lines are 16px and pages 100px', async ({ page }) => {
        const bounds = await openLongBook(page)
        const at = { x: bounds.x + 150, y: bounds.y + 200 }
        await wheelAtMode(page, at, 3, 1)
        expect((await scrollOf(page)).scroll).toBe(48)
        await wheelAtMode(page, at, 1, 2)
        expect((await scrollOf(page)).scroll).toBe(148)
    })

    test('the wheel stops at both ends', async ({ page }) => {
        const bounds = await openLongBook(page)
        const at = { x: bounds.x + 150, y: bounds.y + 200 }
        await wheelAt(page, at, -500)
        expect((await scrollOf(page)).scroll).toBe(0)
        await wheelAt(page, at, 5000)
        const state = await scrollOf(page)
        expect(state.scroll).toBe(MAX_SCROLL)
        expect(state.maxScroll).toBe(MAX_SCROLL)
        // The thumb ends flush with the bottom of the track.
        const thumb = await thumbOf(page)
        expect(thumb.y + thumb.height).toBeCloseTo(state.track.y + state.track.height, 0)
    })

    test('a wheel over the thumb scrolls the book', async ({ page }) => {
        await openLongBook(page)
        await wheelAt(page, centre(await thumbOf(page)), 100)
        expect((await scrollOf(page)).scroll).toBe(100)
        // The thumb has moved, and a wheel over its new spot still works.
        await wheelAt(page, centre(await thumbOf(page)), 100)
        expect((await scrollOf(page)).scroll).toBe(200)
        await expectUntouched(page)
    })

    test('dragging the thumb scrolls, and neither selects a row nor closes the dialog', async ({
        page,
    }) => {
        await openLongBook(page)
        const before = await scrollOf(page)
        const travel = before.track.height - (await thumbOf(page)).height
        await dragThumb(page, travel / 2)
        expectThumbAgrees(await scrollOf(page), MAX_SCROLL / 2)
        await expectUntouched(page)

        // Far past the end of the track (and off the window) the thumb stops at the bottom.
        await dragThumb(page, 600)
        expect((await scrollOf(page)).scroll).toBe(MAX_SCROLL)
        await expectUntouched(page)

        // And back to the top. The pointer ends well above the window.
        await dragThumb(page, -600, before.viewport.x + 100)
        expect((await scrollOf(page)).scroll).toBe(0)
        await expectUntouched(page)
    })

    test('letting go over the rows ends the drag without selecting one', async ({ page }) => {
        await openLongBook(page)
        const { viewport } = await scrollOf(page)
        // The pointer ends inside the viewport, well left of the track, and the button comes up there.
        const grab = centre(await thumbOf(page))
        const endY = grab.y + 100
        expect(endY).toBeLessThan(viewport.y + viewport.height)
        await dragThumb(page, 100, viewport.x + 100)
        expect((await scrollOf(page)).scroll).toBeGreaterThan(0)
        await expectUntouched(page)
        // The drag is over: moving back over the rows does not scroll.
        const after = (await scrollOf(page)).scroll
        await page.mouse.move(viewport.x + 100, viewport.y + 20, { steps: 4 })
        await settle(page)
        expect((await scrollOf(page)).scroll).toBe(after)
    })

    test('a drag whose release was never seen ends when moves arrive with no button held', async ({
        page,
    }) => {
        await openLongBook(page)
        expect(await scrollAfterMovesWithNoButton(page, 200)).toBe(0)
        await expectUntouched(page)
    })

    test('Escape in the middle of a thumb drag closes the dialog and throws nothing', async ({
        page,
    }) => {
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await openLongBook(page)
        const grab = centre(await thumbOf(page))
        await page.mouse.move(grab.x, grab.y)
        await page.mouse.down()
        await page.mouse.move(grab.x, grab.y + 50, { steps: 4 })
        await page.keyboard.press('Escape')
        await expect.poll(() => page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
        // The drag's moves and its release arrive after the dialog is gone.
        await page.mouse.move(grab.x, grab.y + 120, { steps: 4 })
        await page.mouse.up()
        await settle(page)
        expect(errors).toEqual([])
    })

    test('thumb position follows the scroll at the top, middle and bottom', async ({ page }) => {
        const bounds = await openLongBook(page)
        const at = { x: bounds.x + 150, y: bounds.y + 200 }
        const top = await scrollOf(page)
        expect((await thumbOf(page)).y).toBe(top.viewport.y)
        expectThumbAgrees(top, 0)
        await wheelAt(page, at, MAX_SCROLL / 2)
        expectThumbAgrees(await scrollOf(page), MAX_SCROLL / 2)
        await wheelAt(page, at, MAX_SCROLL)
        const bottom = await scrollOf(page)
        expectThumbAgrees(bottom, MAX_SCROLL)
        const bottomThumb = await thumbOf(page)
        expect(bottomThumb.y + bottomThumb.height).toBeCloseTo(
            bottom.viewport.y + bottom.viewport.height,
            0
        )
    })

    test('a click on the track pages up or down by a viewport and selects nothing', async ({
        page,
    }) => {
        await openLongBook(page)
        await page.mouse.click(...xy(await trackPointBelowThumb(page)))
        await settle(page)
        expect((await scrollOf(page)).scroll).toBe(VIEWPORT)
        await expectUntouched(page)

        await page.mouse.click(...xy(await trackPointBelowThumb(page)))
        await settle(page)
        expect((await scrollOf(page)).scroll).toBe(MAX_SCROLL)
        await expectUntouched(page)

        await page.mouse.click(...xy(await trackPointAboveThumb(page)))
        await settle(page)
        expect((await scrollOf(page)).scroll).toBe(MAX_SCROLL - VIEWPORT)
        await page.mouse.click(...xy(await trackPointAboveThumb(page)))
        await settle(page)
        expect((await scrollOf(page)).scroll).toBe(0)
        await expectUntouched(page)
    })

    test('rows end where the track begins, and a row still takes a click at its right edge', async ({
        page,
    }) => {
        await openLongBook(page)
        const { viewport, track } = await scrollOf(page)
        expect(track.x).toBeGreaterThanOrEqual(viewport.x + viewport.width)
        // The last pixel column of row 2 (entry 2 holds 3 entities).
        await page.mouse.click(viewport.x + viewport.width - 1, viewport.y + 2 * ROW + 12)
        await expect
            .poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount()))
            .toBe(3)
    })
})

/*
    Issue #651: a big book opened with 16 warning toasts, one per icon that
    could not be drawn, and its row labels printed rich-text tags as typed
    (`[item=stone-furnace] 15/s`).

    Planet and quality icons have no data to draw from at all (#652), so the
    names below fail to draw on purpose: they stand in for what that book held.
*/
const withIcon = (label: string, name: string, type = 'item') => ({
    ...blueprint(label),
    icons: [{ index: 1, signal: { type, name } }],
})

/**
 * Every warning toast the page shows from now on, as its class and text. Only
 * warnings: the welcome tip is an info toast that arrives whenever it likes.
 * A second call replaces the first recording.
 */
async function recordToasts(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __toasts: string[]; __toastWatch?: MutationObserver }
        w.__toastWatch?.disconnect()
        w.__toasts = []
        w.__toastWatch = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        !(node instanceof HTMLElement) ||
                        !node.classList.contains('toasts-warning')
                    )
                        continue
                    w.__toasts.push(`toasts-warning | ${node.textContent?.trim()}`)
                }
            }
        })
        w.__toastWatch.observe(document.body, { childList: true, subtree: true })
    })
}
const toastsSoFar = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)

test.describe('icons the book dialog cannot draw (#651)', () => {
    test('are named in one warning, however many rows use them', async ({ page }) => {
        await loadBlueprint(
            page,
            encodeBlueprintBook(
                book([
                    { blueprint: withIcon('A', 'nauvis', 'space-location') },
                    { blueprint: withIcon('B', 'nauvis', 'space-location') },
                    { blueprint: withIcon('C', 'vulcanus', 'space-location') },
                    { blueprint: withIcon('D', 'vulcanus', 'space-location') },
                    { blueprint: withIcon('E', 'legendary', 'quality') },
                    { blueprint: withIcon('F', 'iron-plate') },
                ])
            )
        )
        await recordToasts(page)
        await openBook(page)
        await settle(page)
        expect(await toastsSoFar(page)).toEqual([
            'toasts-warning | 3 icons could not be drawn: nauvis, vulcanus, legendary',
        ])
    })

    test('say "icon" for one, cap the list at eight names, and stay quiet when all draw', async ({
        page,
    }) => {
        const names = Array.from({ length: 10 }, (_, i) => `no-such-icon-${i}`)
        const open = async (entries: Record<string, unknown>[]) => {
            await loadBlueprint(page, encodeBlueprintBook(book(entries)))
            await recordToasts(page)
            await openBook(page)
            await settle(page)
            const toasts = await toastsSoFar(page)
            await page.keyboard.press('Escape')
            return toasts
        }
        expect(await open([{ blueprint: withIcon('Only', 'nauvis', 'space-location') }])).toEqual([
            'toasts-warning | 1 icon could not be drawn: nauvis',
        ])
        expect(await open(names.map(name => ({ blueprint: withIcon(name, name) })))).toEqual([
            `toasts-warning | 10 icons could not be drawn: ${names.slice(0, 8).join(', ')}, and 2 more`,
        ])
        expect(await open([{ blueprint: withIcon('Fine', 'iron-plate') }])).toEqual([])
    })

    test('a nested book header counts too, and reopening warns again', async ({ page }) => {
        await loadBlueprint(
            page,
            encodeBlueprintBook(
                book([
                    {
                        blueprint_book: {
                            ...book([{ blueprint: withIcon('Inside', 'gleba', 'space-location') }]),
                            icons: [
                                { index: 1, signal: { type: 'space-location', name: 'aquilo' } },
                            ],
                        },
                    },
                ])
            )
        )
        await recordToasts(page)
        await openBook(page)
        await settle(page)
        await page.keyboard.press('Escape')
        await openBook(page)
        await settle(page)
        expect(await toastsSoFar(page)).toEqual([
            'toasts-warning | 2 icons could not be drawn: aquilo, gleba',
            'toasts-warning | 2 icons could not be drawn: aquilo, gleba',
        ])
    })
})

test.describe('rich-text tags in book row labels (#651)', () => {
    const LABELS = [
        '[item=stone-furnace] 15/s',
        'Mix [fluid=water] and [virtual-signal=signal-fuel]',
        '[planet=nauvis] Nauvis',
        '[entity=character] [item=no-such-item] kept',
        '[color=red]Red[/color] plain',
        'Plain label',
    ]

    test('draw as icons in the label, and unresolved tags are kept as typed', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await loadBlueprint(
            page,
            encodeBlueprintBook(book(LABELS.map(label => ({ blueprint: blueprint(label) }))))
        )
        await recordToasts(page)
        await openBook(page)
        await settle(page)
        expect(await page.evaluate(() => window.__fbe_test.bookRowRuns())).toEqual([
            ['icon:stone-furnace', ' 15/s'],
            ['Mix ', 'icon:water', ' and ', 'icon:signal-fuel'],
            ['[planet=nauvis] Nauvis'],
            ['[entity=character]', ' ', '[item=no-such-item]', ' kept'],
            ['[color=red]Red[/color] plain'],
            ['Plain label'],
        ])
        // Nothing here is the editor's fault, so nothing is warned about.
        expect(await toastsSoFar(page)).toEqual([])
        expect(errors).toEqual([])
    })

    test('a nested book header and the planner rows use the same label', async ({ page }) => {
        await loadBlueprint(
            page,
            encodeBlueprintBook(
                book([
                    {
                        blueprint_book: {
                            ...book([{ blueprint: blueprint('[item=iron-plate] Inner') }]),
                            label: '[item=copper-plate] Header',
                        },
                    },
                    { upgrade_planner: { item: 'upgrade-planner', version, settings: {} } },
                ])
            )
        )
        await openBook(page)
        await settle(page)
        expect(await page.evaluate(() => window.__fbe_test.bookRowRuns())).toEqual([
            ['icon:copper-plate', ' Header'],
            ['icon:iron-plate', ' Inner'],
            ['Upgrade planner'],
        ])
    })

    test('a long tagged label keeps its row 24px tall, and the row still selects', async ({
        page,
    }) => {
        const long = `${'[item=iron-plate] '.repeat(6)}${'a very long label '.repeat(8)}`
        await loadBlueprint(
            page,
            encodeBlueprintBook(
                book([
                    { blueprint: blueprint('First') },
                    { blueprint: blueprint(long, 2) },
                    { blueprint: blueprint('Third', 3) },
                ])
            )
        )
        const bounds = await openBook(page)
        await settle(page)
        // Three rows of 24px fit the 320px viewport: nothing scrolls, so no row grew.
        expect((await scrollOf(page)).maxScroll).toBe(0)
        // The far end of the row is clipped, not wrapped: click the row's right edge.
        await page.mouse.click(bounds.x + 300, bounds.y + 40 + 1 * 24 + 12)
        await expect
            .poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount()))
            .toBe(2)
    })
})
