import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Rail signal snapping (issue #133 item 2), the wiring the unit tests cannot
    reach. The arithmetic lives in
    packages/editor/src/core/railSignalSnapping.test.ts, which is pure and FD-free
    and covers the table, the nearest-spot choice and the rotation cycle. What is
    left for a browser is that PaintEntityContainer actually calls it: that
    moveAtCursor snaps, that R steps around the rail instead of turning the
    signal on the spot, and that a signal away from any rail is still left alone.

    Why snapping rather than an exact placement rule, which is what #133 asked
    for: a signal is legal at 4 positions per rail and at **none** on bare
    ground, so refusing everything else without helping the user reach the
    survivors would have made signals close to unplaceable - measured in the
    costing comment on that issue. Snapping is the half that makes the exact
    answer usable.

    Reaching a paint container needs real pointer and keyboard input, which is
    #44's machinery. Pipette (Q) over an existing signal is the only route: no
    inventory click can be scripted as cheaply, and the item route ends in the
    same PaintEntityContainer either way.

    suppressOverlays before goto, per #119 and #130 - every spec that dispatches
    pointer input has to, and the failure is silent.
*/

type Page = import('@playwright/test').Page

/*
    A straight rail at direction 0 with a signal beside it. The signal starts on
    one of the rail's legal positions, which matters - it has to be an
    arrangement the game would accept, or this is asserting against a layout that
    could not exist.

    Every expectation below is written as an **offset from the rail**, never as
    an absolute position, because loading re-centres a blueprint: the rail
    encoded at (1, 1) is somewhere else in the model by the time the editor has
    it. A first draft hardcoded the encoded coordinates and failed four tests
    with a snap that was in fact correct. The four legal offsets, from the
    measured table, are

        (-1.5, -0.5) @ 0   (-1.5, 0.5) @ 0   (1.5, -0.5) @ 8   (1.5, 0.5) @ 8

    i.e. a pair each side of the track, facing opposite ways.
*/
const RAIL_AND_SIGNAL = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'straight-rail', position: { x: 1, y: 1 }, direction: 0 },
        { entity_number: 2, name: 'rail-signal', position: { x: 2.5, y: 1.5 }, direction: 8 },
    ],
})

interface PaintState {
    x: number
    y: number
    direction: number | undefined
}

const paintState = (page: Page): Promise<PaintState | undefined> =>
    page.evaluate(() => (window as any).__fbe_test.paintContainerState())

/** The four legal signal placements around this spec's rail, as offsets from it */
const LEGAL_OFFSETS = [
    { dx: -1.5, dy: -0.5, direction: 0 },
    { dx: -1.5, dy: 0.5, direction: 0 },
    { dx: 1.5, dy: -0.5, direction: 8 },
    { dx: 1.5, dy: 0.5, direction: 8 },
]

/** Where the entity sits in the model, which is not where the blueprint put it */
const modelPositionOf = async (
    page: Page,
    entityNumber: number
): Promise<{ x: number; y: number }> => {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/** The paint container's position expressed as an offset from the rail */
const offsetFromRail = (
    state: PaintState | undefined,
    rail: { x: number; y: number }
): { dx: number; dy: number; direction: number | undefined } => ({
    dx: (state?.x ?? NaN) - rail.x,
    dy: (state?.y ?? NaN) - rail.y,
    direction: state?.direction,
})

const screenOf = async (page: Page, entityNumber: number): Promise<{ x: number; y: number }> => {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/**
 * Loads the blueprint and leaves a rail signal on the cursor.
 *
 * Hover the signal to reach EDIT, then Q to pipette it, which is the documented
 * route into PAINT with a PaintEntityContainer - see editor-mode-input.spec.ts.
 */
async function pipetteTheSignal(page: Page): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, RAIL_AND_SIGNAL)

    const signal = await screenOf(page, 2)
    await page.mouse.move(signal.x, signal.y)
    await expect
        .poll(() => page.evaluate(() => (window as any).__fbe_test.hoveredEntityNumber()))
        .toBe(2)

    await page.keyboard.press('q')
    await expect
        .poll(() => page.evaluate(() => (window as any).__fbe_test.editorMode()))
        .toBe('PAINT')
}

/** Moves the pointer to a world position, in tiles, via the rail's known screen anchor. */
async function moveToTile(
    page: Page,
    railScreen: { x: number; y: number },
    dx: number,
    dy: number,
    zoom: number
): Promise<void> {
    await page.mouse.move(railScreen.x + dx * zoom, railScreen.y + dy * zoom)
}

/*
    The canvas zoom, needed to turn tile offsets into pointer moves. Derived from
    two entities a known distance apart rather than hardcoded, since the editor
    picks a zoom from the blueprint's bounds and a literal here would silently
    rot - the rail is at (1,1) and the signal at (2.5,1.5), so they are 1.5 tiles
    apart in x.
*/
async function zoomOf(page: Page): Promise<number> {
    const rail = await screenOf(page, 1)
    const signal = await screenOf(page, 2)
    return (signal.x - rail.x) / 1.5
}

test('a signal on the cursor snaps to a legal position beside the rail', async ({ page }) => {
    await pipetteTheSignal(page)

    const railScreen = await screenOf(page, 1)
    const rail = await modelPositionOf(page, 1)
    const zoom = await zoomOf(page)

    /*
        Aim at the rail's own centre, which is a position the game refuses
        outright - #134 measured a signal on a straight rail as accepted at 0 of
        its 16 directions. Snapping has to move it out to one of the four legal
        spots rather than leave it under the pointer.
    */
    await moveToTile(page, railScreen, 0, 0, zoom)

    const state = await paintState(page)
    expect(state, 'the paint container should exist').toBeDefined()

    const got = offsetFromRail(state, rail)
    expect(
        LEGAL_OFFSETS,
        `snapped to offset ${got.dx},${got.dy} facing ${got.direction}, which is not legal`
    ).toContainEqual(got)
})

test('the snapped position takes the direction the table says, not the one it had', async ({
    page,
}) => {
    await pipetteTheSignal(page)

    const railScreen = await screenOf(page, 1)
    const rail = await modelPositionOf(page, 1)
    const zoom = await zoomOf(page)

    /*
        Left of the rail, where both legal spots face 0. The pipetted signal came
        off an entity facing 8, so a snap that moved the position and left the
        facing alone would still read 8 here - which the game refuses.
    */
    await moveToTile(page, railScreen, -1.5, 0.5, zoom)
    const left = offsetFromRail(await paintState(page), rail)
    expect(left.direction, 'a spot on the left of the rail faces 0').toBe(0)
    expect(left.dx).toBe(-1.5)

    /*
        And the mirror, which must come back with the other direction. A snap
        that hardcoded one facing passes the assertion above and fails this.
    */
    await moveToTile(page, railScreen, 1.5, 0.5, zoom)
    const right = offsetFromRail(await paintState(page), rail)
    expect(right.direction, 'a spot on the right of the rail faces 8').toBe(8)
    expect(right.dx).toBe(1.5)
})

test('R steps around the rail instead of turning the signal on the spot', async ({ page }) => {
    await pipetteTheSignal(page)

    const railScreen = await screenOf(page, 1)
    const rail = await modelPositionOf(page, 1)
    const zoom = await zoomOf(page)
    await moveToTile(page, railScreen, 1.5, 0.5, zoom)

    const seen = [offsetFromRail(await paintState(page), rail)]
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('r')
        seen.push(offsetFromRail(await paintState(page), rail))
    }

    /*
        Four presses, four distinct legal placements. This is the assertion that
        catches the tempting implementation: cycling `this.direction` through the
        16 rotations a signal has would hold the position still and produce
        facings the table never lists, so the set would collapse to one position.
    */
    const key = (o: { dx: number; dy: number; direction: number | undefined }): string =>
        `${o.dx},${o.dy},${o.direction}`
    const keys = new Set(seen.map(key))
    expect(keys.size, `R produced ${[...keys].join(' | ')}`).toBe(4)
    for (const k of keys) {
        expect(LEGAL_OFFSETS.map(key), `${k} is not a legal placement`).toContain(k)
    }

    // A fourth press wraps rather than running out of spots.
    await page.keyboard.press('r')
    expect(key(offsetFromRail(await paintState(page), rail))).toBe(key(seen[0]))
})

test('a signal away from any rail is left where the cursor is', async ({ page }) => {
    await pipetteTheSignal(page)

    const railScreen = await screenOf(page, 1)
    const rail = await modelPositionOf(page, 1)
    const zoom = await zoomOf(page)

    /*
        The control, and the reason snapping is assistance rather than
        enforcement. Placing a signal in open ground is something the editor has
        always allowed, and #133 records why making that exact would be a bad
        trade - so beyond the snap radius the ordinary tile snapping applies and
        the signal sits under the pointer.

        It guards the other direction too: a snap with no distance limit would
        drag the signal back to the rail from anywhere on the canvas. Six tiles
        is chosen to sit **inside** PaintEntityContainer's search window and
        outside snapRailSignal's distance limit, so the rail is found and then
        rejected on distance. Aim further out and the window rejects it first,
        which passes for the wrong reason - that is exactly what happened while
        the window was 9 tiles wide, and it left a limit-removing mutation
        invisible to this suite.

        Sideways rather than diagonally, and only six tiles, because the room is
        not symmetric. Measured at the config's 1280x720 with the editor's
        96px-per-tile zoom, the rail sits at x 592 and y 360, which leaves about
        7 tiles of travel horizontally and only 3.7 vertically - less than the
        snap radius. A first draft moved 6 tiles diagonally, went off the bottom
        of the canvas, and the paint container was *hidden* rather than moved -
        so it reported its last snapped position and the test failed for a reason
        that had nothing to do with snapping. Hence the visibility assertion
        below: off-canvas must not pass as "left alone".
    */
    await moveToTile(page, railScreen, 6, 0, zoom)

    expect(
        await page.evaluate(() => (window as any).__fbe_test.paintContainerVisible()),
        'the pointer must still be on the canvas, or this proves nothing'
    ).toBe(true)

    const got = offsetFromRail(await paintState(page), rail)
    expect(Math.abs(got.dx - 6), `x should follow the cursor, offset was ${got.dx}`).toBeLessThan(
        1.5
    )
    expect(Math.abs(got.dy), `y should follow the cursor, offset was ${got.dy}`).toBeLessThan(1.5)
})
