import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    Alt mode marks every underground belt and pipe to ground that has no
    partner (#344). The game draws nothing for one, so the look - the
    `not_allowed` cursor box - is ours; what this pins is which undergrounds
    get it and that it follows alt mode and edits.

    The marker count cannot come from a sprite tally, because the marker is not
    part of any entity's sprites or info overlay, so the spec reads it through
    `markedUnpairedUndergrounds`, the entity numbers of the markers on screen.

    Deleting half of a pair is the case that needs the neighbour refresh: the
    edit is to entity 2, and the marker that has to appear is entity 3's. Undo
    re-creates entity 2 and has to take it away again.
*/

const EAST = 4
const WEST = 12

const UNDERGROUNDS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        // on its own
        {
            entity_number: 1,
            name: 'underground-belt',
            position: { x: 0.5, y: 0.5 },
            direction: EAST,
            type: 'input',
        },
        // a pair, three tiles apart
        {
            entity_number: 2,
            name: 'underground-belt',
            position: { x: 0.5, y: 3.5 },
            direction: EAST,
            type: 'input',
        },
        {
            entity_number: 3,
            name: 'underground-belt',
            position: { x: 4.5, y: 3.5 },
            direction: EAST,
            type: 'output',
        },
        // a pair of pipes to ground, whose undergrounds run towards each other
        { entity_number: 4, name: 'pipe-to-ground', position: { x: 4.5, y: 6.5 }, direction: EAST },
        { entity_number: 5, name: 'pipe-to-ground', position: { x: 0.5, y: 6.5 }, direction: WEST },
    ],
})

type Page = import('@playwright/test').Page

const marked = (page: Page): Promise<number[]> =>
    page.evaluate(() => window.__fbe_test.markedUnpairedUndergrounds())

test('alt mode marks the undergrounds with no partner, and follows edits', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, UNDERGROUNDS)

    // alt mode starts on
    expect(await page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(true)
    expect(await marked(page)).toEqual([1])

    // the toggle applies on Alt's key-up, hence the polls
    await page.keyboard.press('AltLeft')
    await expect.poll(() => page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(false)
    expect(await marked(page)).toEqual([])
    await page.keyboard.press('AltLeft')
    await expect.poll(() => marked(page)).toEqual([1])

    // Delete the input of the pair by hovering it and right-clicking, which
    // leaves the output on its own.
    const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(2))
    if (!at) throw new Error('entity 2 is not on screen')
    await page.mouse.move(at.x, at.y)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.hoveredEntityNumber())).toBe(2)
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await expect
        .poll(() => page.evaluate(() => window.__fbe_test.entityPosition(2)))
        .toBeUndefined()
    expect(await marked(page)).toEqual([1, 3])

    // and undo pairs it again
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityPosition(2))).toBeDefined()
    expect(await marked(page)).toEqual([1])

    expect(pageErrors).toEqual([])
})

/*
    A group move or mirror relocates its members one at a time, and the grid
    lookup behind pairing, `PositionGrid.getOpposingEntity`, only reads a cell
    that holds a single entity. So partway through, a member can land on a
    tile another member has not left yet, and an underground checked at that
    moment sees no partner past the shared tile. This row is the smallest case
    that does it: A is an input at x 0.5, B its output at 2.5, and T a plain
    belt at 3.5 right behind B. Shifted one tile east, B lands on T before T
    moves on, and A, re-checked because B left its old tile, looks east through
    B's old tile and then the shared one, and finds nothing.

    Moved or mirrored as a whole the row is still a pair either way round, so
    nothing may be marked once the operation is over, and the same after undo
    and redo.
*/
const PAIR_AND_BELT = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'underground-belt',
            position: { x: 0.5, y: 0.5 },
            direction: EAST,
            type: 'input',
        },
        {
            entity_number: 2,
            name: 'underground-belt',
            position: { x: 2.5, y: 0.5 },
            direction: EAST,
            type: 'output',
        },
        { entity_number: 3, name: 'transport-belt', position: { x: 3.5, y: 0.5 }, direction: EAST },
    ],
})

type Point = { x: number; y: number }

const screenOf = async (page: Page, n: number): Promise<Point> => {
    const at = await page.evaluate((n: number) => window.__fbe_test.entityScreenPosition(n), n)
    if (!at) throw new Error(`entity ${n} is not on screen`)
    return at
}

const positionOf = async (page: Page, n: number): Promise<Point> => {
    const at = await page.evaluate((n: number) => window.__fbe_test.entityPosition(n), n)
    if (!at) throw new Error(`no entity ${n} in the loaded blueprint`)
    return at
}

/** Alt+Left-drags from the first entity to the last, selecting the whole row. */
async function selectRow(page: Page): Promise<void> {
    const a = await screenOf(page, 1)
    const b = await screenOf(page, 3)
    await page.mouse.move(a.x, a.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(b.x, b.y)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    const selected = await page.evaluate(() => window.__fbe_test.selectedEntityNumbers())
    expect(selected.sort((a, b) => a - b)).toEqual([1, 2, 3])
}

async function openRow(page: Page): Promise<void> {
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, PAIR_AND_BELT)
    expect(await page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(true)
    expect(await marked(page)).toEqual([])
}

test('a group move leaves a pair that moved together unmarked, through undo and redo', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await openRow(page)
    await selectRow(page)

    const before = await positionOf(page, 1)
    const rev = await page.evaluate(() => window.__fbe_test.historyRevision())
    const at = await screenOf(page, 1)
    const px = 32 * (await page.evaluate(() => window.__fbe_test.viewportScale()))
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + px, at.y, { steps: 4 })
    await page.mouse.up()

    expect(await positionOf(page, 1)).toEqual({ x: before.x + 1, y: before.y })
    expect(await page.evaluate(() => window.__fbe_test.historyRevision())).toBe(rev + 1)
    expect(await marked(page)).toEqual([])

    // pointer off the row, so the undo and redo keys reach nothing hovered
    await page.mouse.move(at.x, at.y + 240)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(() => positionOf(page, 1)).toEqual(before)
    expect(await marked(page)).toEqual([])

    await page.keyboard.press('Control+KeyY')
    await expect.poll(() => positionOf(page, 1)).toEqual({ x: before.x + 1, y: before.y })
    expect(await marked(page)).toEqual([])

    expect(pageErrors).toEqual([])
})

test('a group mirror leaves a pair that flipped together unmarked, and so does undo', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await openRow(page)
    await selectRow(page)

    const before = await positionOf(page, 1)
    const at = await screenOf(page, 1)
    await page.mouse.move(at.x, at.y + 240)
    await page.keyboard.press('Shift+KeyF')

    // mirrored about the row's own centre, so the input lands where the belt was
    await expect.poll(() => positionOf(page, 1)).toEqual({ x: before.x + 3, y: before.y })
    expect(await marked(page)).toEqual([])

    await page.keyboard.press('Control+KeyZ')
    await expect.poll(() => positionOf(page, 1)).toEqual(before)
    expect(await marked(page)).toEqual([])

    expect(pageErrors).toEqual([])
})

/*
    A belt carrying no `type` - never written by the game, only by hand - is an
    input: Factorio 2.0.77 reads it back as one, builds it as one, pairs it with
    an output downstream of it, and leaves it alone behind an input
    (tools/oracle/fixtures/underground-type.json). #547 read it as an output, so
    it marked both belts of the first blueprint and neither of the second. Each
    blueprint is one of the probe's cases, east-facing and 4 tiles apart.
*/
const untypedPair = (upstream: 'input' | undefined, downstream: 'output' | undefined): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            {
                entity_number: 1,
                name: 'underground-belt',
                position: { x: 0.5, y: 0.5 },
                direction: EAST,
                ...(upstream && { type: upstream }),
            },
            {
                entity_number: 2,
                name: 'underground-belt',
                position: { x: 4.5, y: 0.5 },
                direction: EAST,
                ...(downstream && { type: downstream }),
            },
        ],
    })

test('a belt with no type upstream of an output is paired with it, as the game pairs it', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, untypedPair(undefined, 'output'))

    expect(await page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(true)
    expect(await marked(page)).toEqual([])

    expect(pageErrors).toEqual([])
})

test('a belt with no type downstream of an input is a second input, and both are marked', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, untypedPair('input', undefined))

    expect(await page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(true)
    expect(await marked(page)).toEqual([1, 2])

    expect(pageErrors).toEqual([])
})
