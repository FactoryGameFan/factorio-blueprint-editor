import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Issue #342, both halves: the entity count drawn beside a sweeping marquee,
    and the bill of materials the `B` keybind opens. Real pointer and keyboard
    input throughout; the two hooks exist only because both are drawn on the
    canvas, where a spec cannot read text.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page
type Point = { x: number; y: number }

/*
    Three chests in a row over two belts, then two rails well off to the side
    so no sweep below reaches them, then tiles. The rails are there for the
    tally: a curved-rail-a is placed by 3 rail and a straight one by 1, so the
    bill has to read 4 rail rather than 2 pieces. The two hazard concrete
    variants both come from the one item.
*/
const SOURCE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 1.5, y: 0.5 } },
        { entity_number: 3, name: 'wooden-chest', position: { x: 2.5, y: 0.5 } },
        { entity_number: 4, name: 'transport-belt', position: { x: 0.5, y: 1.5 } },
        { entity_number: 5, name: 'transport-belt', position: { x: 1.5, y: 1.5 } },
        { entity_number: 6, name: 'curved-rail-a', position: { x: 14, y: 0 }, direction: 2 },
        { entity_number: 7, name: 'straight-rail', position: { x: 21, y: 1 }, direction: 0 },
    ],
    tiles: [
        { name: 'concrete', position: { x: 0, y: -4 } },
        { name: 'concrete', position: { x: 1, y: -4 } },
        { name: 'concrete', position: { x: 2, y: -4 } },
        { name: 'hazard-concrete-left', position: { x: 3, y: -4 } },
        { name: 'hazard-concrete-right', position: { x: 4, y: -4 } },
    ],
})

/*
    A count past a thousand and two qualities of one item. 1535 concrete is the
    number the shared icon formatter drew as "1k"; the dialog has to draw it
    exactly. The chests are two normal (one written out, one left implicit, as
    Factorio writes it) and one legendary, which is a separate line with a
    badge rather than a third chest.
*/
const LARGE_SOURCE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 1.5, y: 0.5 }, quality: 'normal' },
        {
            entity_number: 3,
            name: 'wooden-chest',
            position: { x: 2.5, y: 0.5 },
            quality: 'legendary',
        },
    ],
    tiles: Array.from({ length: 1535 }, (_, i) => ({
        name: 'concrete',
        position: { x: i % 40, y: 4 + Math.floor(i / 40) },
    })),
})

async function openEditor(page: Page, source = SOURCE): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    await expect(page.locator(CANVAS)).toBeVisible()
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
}

const screenOf = async (page: Page, n: number): Promise<Point> => {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        n
    )
    if (!at) throw new Error(`no entity ${n} in the loaded blueprint`)
    return at
}

const countText = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => (window as any).__fbe_test.marqueeCountText())

const tally = (page: Page): Promise<unknown> =>
    page.evaluate(() => (window as any).__fbe_test.billOfMaterialsTally())

const slots = (page: Page): Promise<unknown> =>
    page.evaluate(() => (window as any).__fbe_test.billOfMaterialsDrawn())

const dialogs = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.openDialogCount())

test('the marquee shows how many entities it covers, and follows the sweep', async ({ page }) => {
    await openEditor(page)
    expect(await countText(page)).toBeUndefined()

    const chest1 = await screenOf(page, 1)
    const chest2 = await screenOf(page, 2)
    const chest3 = await screenOf(page, 3)
    const belt2 = await screenOf(page, 5)

    await page.mouse.move(chest1.x, chest1.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    // The press tile alone already covers chest 1.
    await expect.poll(() => countText(page)).toBe('1 entity')

    await page.mouse.move(chest2.x, chest2.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('2 entities')

    // Down a row takes in both belts under chests 1 and 2.
    await page.mouse.move(belt2.x, belt2.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('4 entities')

    // And back up and along drops them again, which a count that only grew would not.
    await page.mouse.move(chest3.x, chest3.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('3 entities')

    await page.mouse.up()
    await page.keyboard.up('Alt')
    expect(await countText(page)).toBeUndefined()
    expect(
        await page.evaluate((): number[] => (window as any).__fbe_test.selectedEntityNumbers())
    ).toHaveLength(3)
})

test('the copy and delete sweeps show the count too', async ({ page }) => {
    await openEditor(page)
    const chest1 = await screenOf(page, 1)
    const chest2 = await screenOf(page, 2)
    const chest3 = await screenOf(page, 3)

    await page.mouse.move(chest1.x, chest1.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(chest3.x, chest3.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('3 entities')
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await countText(page)).toBeUndefined()

    // Last, because letting go deletes what it covers.
    await page.mouse.move(chest1.x, chest1.y)
    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(chest3.x, chest3.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('3 entities')
    await page.mouse.move(chest2.x, chest2.y, { steps: 4 })
    await expect.poll(() => countText(page)).toBe('2 entities')
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')
    expect(await countText(page)).toBeUndefined()
})

test('B opens a bill of materials counted per item, tiles apart, and closes it again', async ({
    page,
}) => {
    await openEditor(page)
    expect(await tally(page)).toBeUndefined()

    await page.locator(CANVAS).focus()
    await page.keyboard.press('KeyB')
    await expect.poll(() => dialogs(page)).toBe(1)
    expect(await tally(page)).toEqual({
        entities: [
            { name: 'rail', count: 4 },
            { name: 'wooden-chest', count: 3 },
            { name: 'transport-belt', count: 2 },
        ],
        tiles: [
            { name: 'concrete', count: 3 },
            { name: 'hazard-concrete', count: 2 },
        ],
    })

    await page.keyboard.press('KeyB')
    await expect.poll(() => dialogs(page)).toBe(0)
    expect(await tally(page)).toBeUndefined()
})

test('the bill of materials draws a count past a thousand exactly, and each quality on its own', async ({
    page,
}) => {
    await openEditor(page, LARGE_SOURCE)
    await page.locator(CANVAS).focus()
    await page.keyboard.press('KeyB')
    await expect.poll(() => dialogs(page)).toBe(1)

    expect(await tally(page)).toEqual({
        entities: [
            { name: 'wooden-chest', count: 2 },
            { name: 'wooden-chest', quality: 'legendary', count: 1 },
        ],
        tiles: [{ name: 'concrete', count: 1535 }],
    })
    // What was drawn, read off the slots themselves: "1535", where the shared
    // icon formatter drew "1k", and the badge on the legendary line alone.
    expect(await slots(page)).toEqual([
        { name: 'wooden-chest', amount: '2', badge: false },
        { name: 'wooden-chest', quality: 'legendary', amount: '1', badge: true },
        { name: 'concrete', amount: '1535', badge: false },
    ])
})
