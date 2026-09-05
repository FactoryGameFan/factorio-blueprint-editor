import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    The persistent selection: Alt+Left-drag sweeps a rectangle whose entities
    stay selected after release; a plain Left-drag that starts on one of them
    moves the whole group; Shift+F / Shift+G mirror it in place; Escape clears
    it. Design and the reasons for each binding:
    docs/superpowers/specs/2026-09-05-persistent-selection-design.md.

    Everything below is real pointer and keyboard input, in the idiom of
    tests/editor-mode-input.spec.ts. Three things only a hook can see, and each
    is why its hook exists: the selection itself (`selectedEntityNumbers` - it
    is not a mode, so `editorMode` reads NONE the moment the drag is released),
    the blocked tint a drag shows over an occupied destination
    (`selectionHighlightBlocked`), and whether a move or mirror was *one* undo
    step (`historyRevision` - the entities end up in the same place whether it
    took one transaction or two).

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page
type Point = { x: number; y: number }

const modeOf = (page: Page): Promise<string> =>
    page.evaluate(() => (window as any).__fbe_test.editorMode())
const selected = async (page: Page): Promise<number[]> =>
    (await page.evaluate((): number[] => (window as any).__fbe_test.selectedEntityNumbers())).sort(
        (a, b) => a - b
    )
const revision = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.historyRevision())
const dialogs = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.openDialogCount())

const positionOf = async (page: Page, n: number): Promise<Point> => {
    const at = await page.evaluate((n: number) => (window as any).__fbe_test.entityPosition(n), n)
    if (!at) throw new Error(`no entity ${n} in the loaded blueprint`)
    return at
}

const screenOf = async (page: Page, n: number): Promise<Point> => {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        n
    )
    if (!at) throw new Error(`no entity ${n} in the loaded blueprint`)
    return at
}

const blocked = (page: Page, n: number): Promise<boolean> =>
    page.evaluate((n: number) => (window as any).__fbe_test.selectionHighlightBlocked(n), n)

const infoVisible = (page: Page): Promise<boolean> =>
    page.evaluate(() => (window as any).__fbe_test.infoOverlayVisible())

/** One tile, in client pixels at the current zoom. */
const tilePx = async (page: Page): Promise<number> =>
    32 * (await page.evaluate((): number => (window as any).__fbe_test.viewportScale()))

/*
    Three 1x1 chests in a row at the origin, as tests/editor-mode-input.spec.ts
    uses: compact, so initBP centres them at a comfortable zoom with empty
    canvas all around, and numbered by the spec so it can say "chest 2".
    Storage chests rather than wooden ones because two cases below assert that
    a click opens the chest's editor, and a wooden chest has none
    (tests/chest-editor.spec.ts, "a chest with no editor opens nothing").
*/
const THREE_CHESTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'storage-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'storage-chest', position: { x: 1.5, y: 0.5 } },
        { entity_number: 3, name: 'storage-chest', position: { x: 2.5, y: 0.5 } },
    ],
})

async function openEditorWithChests(page: Page): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    await expect(page.locator(CANVAS)).toBeVisible()
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, THREE_CHESTS)
}

/** Alt+Left-drags from one chest to another and releases, then lets go of Alt. */
async function altSelect(page: Page, from: number, to: number): Promise<void> {
    const a = await screenOf(page, from)
    const b = await screenOf(page, to)
    await page.mouse.move(a.x, a.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    expect(await modeOf(page)).toBe('SELECT')
    await page.mouse.move(b.x, b.y)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    // EDIT rather than NONE when the release leaves the pointer on a chest -
    // exitSelectMode re-hovers whatever is under it, as every mode exit does.
    expect(await modeOf(page)).not.toBe('SELECT')
}

/** A plain Left-drag starting on `chest`, by whole tiles, released at the end. */
async function dragChest(page: Page, chest: number, tiles: Point): Promise<void> {
    const at = await screenOf(page, chest)
    const px = await tilePx(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    expect(await modeOf(page)).toBe('MOVE')
    await page.mouse.move(at.x + tiles.x * px, at.y + tiles.y * px, { steps: 4 })
    expect(await modeOf(page)).toBe('MOVE')
    await page.mouse.up()
    expect(await modeOf(page)).not.toBe('MOVE')
}

test('Alt and a left drag sweep a selection that outlives the release', async ({ page }) => {
    await openEditorWithChests(page)
    expect(await selected(page)).toEqual([])

    await altSelect(page, 1, 2)
    expect(await selected(page)).toEqual([1, 2])

    // A new sweep replaces the last one rather than adding to it.
    await altSelect(page, 3, 3)
    expect(await selected(page)).toEqual([3])
})

test('dragging a selected chest moves the whole selection in one undo step', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const before = [await positionOf(page, 1), await positionOf(page, 2), await positionOf(page, 3)]
    const rev = await revision(page)

    await dragChest(page, 1, { x: 0, y: 3 })

    expect(await positionOf(page, 1)).toEqual({ x: before[0].x, y: before[0].y + 3 })
    expect(await positionOf(page, 2)).toEqual({ x: before[1].x, y: before[1].y + 3 })
    // the chest that was not selected stays put
    expect(await positionOf(page, 3)).toEqual(before[2])
    expect(await revision(page)).toBe(rev + 1)
    // still selected afterwards, and still both of them
    expect(await selected(page)).toEqual([1, 2])
})

test('a left drag on empty space still pans, with a selection active', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const chest = await screenOf(page, 2)
    const empty = { x: chest.x, y: chest.y + 240 }
    await page.mouse.move(empty.x, empty.y)
    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.down()
    expect(await modeOf(page)).toBe('PAN')
    await page.mouse.move(empty.x + 64, empty.y + 32)
    await page.mouse.up()
    expect(await modeOf(page)).toBe('NONE')
    expect(await selected(page)).toEqual([1, 2])
})

test('a press on a chest that is not selected opens its editor, as it always did', async ({
    page,
}) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const chest = await screenOf(page, 3)
    await page.mouse.move(chest.x, chest.y)
    expect(await modeOf(page)).toBe('EDIT')
    await page.mouse.down()
    await page.mouse.up()
    expect(await dialogs(page)).toBe(1)
    expect(await selected(page)).toEqual([1, 2])
})

test('a click on a selected chest, without dragging, opens its editor too', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const chest = await screenOf(page, 1)
    await page.mouse.move(chest.x, chest.y)
    await page.mouse.down()
    expect(await modeOf(page)).toBe('MOVE')
    await page.mouse.up()
    expect(await dialogs(page)).toBe(1)
    expect(await positionOf(page, 1)).toEqual(await positionOf(page, 1))
})

test('Escape mid-drag puts everything back and writes nothing', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const before = [await positionOf(page, 1), await positionOf(page, 2)]
    const rev = await revision(page)

    const at = await screenOf(page, 1)
    const px = await tilePx(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x, at.y + 3 * px, { steps: 4 })
    expect(await modeOf(page)).toBe('MOVE')

    await page.keyboard.press('Escape')
    expect(await modeOf(page)).not.toBe('MOVE')
    await page.mouse.up()

    expect(await positionOf(page, 1)).toEqual(before[0])
    expect(await positionOf(page, 2)).toEqual(before[1])
    expect(await revision(page)).toBe(rev)
    expect(await selected(page)).toEqual([1, 2])
})

test('a drag onto an occupied tile shows blocked and does not commit', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 1)

    const before = await positionOf(page, 1)
    const rev = await revision(page)

    const at = await screenOf(page, 1)
    const px = await tilePx(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    // one tile right is chest 2, which is not part of the selection
    await page.mouse.move(at.x + px, at.y, { steps: 2 })
    expect(await modeOf(page)).toBe('MOVE')
    expect(await blocked(page, 1)).toBe(true)

    await page.mouse.up()
    expect(await positionOf(page, 1)).toEqual(before)
    expect(await revision(page)).toBe(rev)
    expect(await blocked(page, 1)).toBe(false)
})

test('Shift+F mirrors the selection in place, in one undo step', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    const one = await positionOf(page, 1)
    const two = await positionOf(page, 2)
    const rev = await revision(page)

    // pointer off the chests so nothing is hovered or carried
    await page.mouse.move(one.x, one.y + 240)
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyF')
    await page.keyboard.up('Shift')

    // about the pair's own centre, so the two swap x and keep y
    expect(await positionOf(page, 1)).toEqual(two)
    expect(await positionOf(page, 2)).toEqual(one)
    expect(await revision(page)).toBe(rev + 1)
})

test('Escape with nothing in progress clears the selection', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)
    expect(await selected(page)).toEqual([1, 2])

    await page.keyboard.press('Escape')
    expect(await selected(page)).toEqual([])
})

test('Q clears the selection too, not just Escape', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)
    expect(await selected(page)).toEqual([1, 2])

    // empty space, so Q's EDIT-mode pipette branch does not also fire
    const chest = await screenOf(page, 1)
    await page.mouse.move(chest.x, chest.y + 240)
    await page.keyboard.press('KeyQ')
    expect(await selected(page)).toEqual([])
})

test('a tap of Alt toggles the info overlay; held to Alt-drag a selection it does not', async ({
    page,
}) => {
    await openEditorWithChests(page)
    const initial = await infoVisible(page)

    await page.keyboard.down('Alt')
    await page.keyboard.up('Alt')
    expect(await infoVisible(page)).toBe(!initial)

    // back to the starting state before the real assertion
    await page.keyboard.down('Alt')
    await page.keyboard.up('Alt')
    expect(await infoVisible(page)).toBe(initial)

    await altSelect(page, 1, 2)
    expect(await infoVisible(page)).toBe(initial)
    expect(await selected(page)).toEqual([1, 2])
})

test('deleting a selected chest by other means drops it from the selection', async ({ page }) => {
    await openEditorWithChests(page)
    await altSelect(page, 1, 2)

    // the existing Ctrl+Right-drag delete, over chest 2 alone
    const chest = await screenOf(page, 2)
    await page.mouse.move(chest.x, chest.y)
    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    expect(await modeOf(page)).toBe('DELETE')
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')

    expect(await selected(page)).toEqual([1])
})
