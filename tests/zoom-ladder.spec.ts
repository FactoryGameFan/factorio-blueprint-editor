import { test, expect, Page } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import {
    NOTCHES_PER_DOUBLING,
    WHEEL_NOTCH_PX,
    ZOOM_MAX,
    ZOOM_MIN,
} from '../packages/editor/src/core/zoomLevels'

/*
    The zoom ladder in a browser (#206). Deliberately thin: the arithmetic is
    unit tested in packages/editor/src/core/zoomLevels.test.ts, which is pure and
    FD-free and so runs under `vp test` in CI, where Playwright does not run at
    all (#210). Duplicating the ladder here would move coverage from the half
    that runs to the half that does not.

    What is left is the part no unit test can see, which is the **wiring**: that
    a wheel event over the canvas reaches the zoom at all and moves the viewport
    by what the module says it should. Nothing under tests/ read a zoom level
    before this, so the whole path could have been deleted with the suite green.

    Three things this spec was shaped by, each of which cost a run:

      - **A wheel read races the wheel event.** `page.mouse.wheel` resolves once
        the event is dispatched, not once the page has handled it, so an
        immediately following `page.evaluate` can observe the scale from before
        the notch. Measured: five full notches read back as four, and a later
        read then jumped two rungs at once catching up. That looks exactly like
        dropped events, and the tempting fix - a timeout, or accepting "about
        one rung" - would have hidden it. `settled()` below syncs on a frame
        instead, which made three consecutive runs identical.
      - **The fitted scale is on no rung, and for a small blueprint it is the
        ceiling.** Two chests ten tiles apart fit at exactly 3, where zooming in
        is a no-op and half these assertions are vacuous. The fixture is 100
        tiles wide so the fit lands mid-ladder, at about 0.4, which also means
        every test here starts off-rung and so exercises the snap.
      - **The wheel carries a position between events**, so a test that scrolls
        twice is not testing the same thing twice. Each test gets a fresh page.

    Note the wheel is **continuous** as of 2026-08-11 and no longer lands on
    rungs - it travels along the same curve, one rung per `WHEEL_NOTCH_PX`. The
    ladder is still what the game stops on, and `BlueprintContainer.zoom()` still
    steps it; that is unit tested rather than driven from here, since no keybind
    reaches it yet.
*/

/*
    Imported rather than restated. These were three literals here with a comment
    saying they matched the module - a bound written down twice, which is the
    failure this repo keeps a note about. Nothing stops a spec importing editor
    source: the module is pure TypeScript with no pixi or FD in it, so it costs
    only the import.
*/
const NOTCH = WHEEL_NOTCH_PX

/** Which rung a scale sits on: n in 2^(n/7). Non-integral means off-ladder. */
const rungIndex = (scale: number): number => Math.log2(scale) * NOTCHES_PER_DOUBLING

/**
 * The scale once the page has actually handled the wheel events dispatched to
 * it. See the header - without the frame sync this reads one event behind.
 */
const settled = async (page: Page): Promise<number> => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    return page.evaluate(() => window.__fbe_test.viewportScale())
}

/** 100 tiles wide, so the fit lands mid-ladder rather than clamped at the ceiling. */
const wideBlueprint = encode({
    version: version(2, 0, 45),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 100.5, y: 0.5 } },
    ],
})

const openWithBlueprint = async (page: Page): Promise<number> => {
    await page.goto('/')
    await waitForEditor(page)
    await loadBlueprint(page, wideBlueprint)
    await page.mouse.move(400, 300)
    return settled(page)
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
})

test('one notch down moves exactly one rung out', async ({ page }) => {
    const before = await openWithBlueprint(page)
    await page.mouse.wheel(0, NOTCH)

    const after = await settled(page)
    expect(after).toBeLessThan(before)
    /* One rung of travel, measured from wherever the fit happened to leave it. */
    expect(rungIndex(after)).toBeCloseTo(rungIndex(before) - 1, 6)
})

test('one notch up moves exactly one rung in', async ({ page }) => {
    const before = await openWithBlueprint(page)
    await page.mouse.wheel(0, -NOTCH)

    const after = await settled(page)
    expect(after).toBeGreaterThan(before)
    expect(rungIndex(after)).toBeCloseTo(rungIndex(before) + 1, 6)
})

test('one notch each way is exactly reversible', async ({ page }) => {
    /*
        Defect 1, end to end. The old flat step made this x1.1 then x0.9 = 0.99,
        losing 1% every round trip - and because the loss was proportional it
        never converged, it drifted.

        Exact to the last bit rather than merely close, which is the reason the
        wheel keeps its position in rungs and adds to it: multiplying a scale by
        2^(1/7) and then dividing does not return the identical float.
    */
    const start = await openWithBlueprint(page)

    await page.mouse.wheel(0, -NOTCH)
    await page.mouse.wheel(0, NOTCH)
    expect(await settled(page)).toBe(start)
})

test('small deltas move proportionally instead of waiting for a threshold', async ({ page }) => {
    /*
        The change that came out of driving it (2026-08-11). A tenth of a notch
        moves a tenth of a rung; it does not sit still banking travel until a
        threshold trips, which is what made a trackpad or a smooth-scrolling
        mouse hold still and then lurch.

        The measured reason to prefer this over a finer ladder: in the #206
        capture the game moved 11 rungs in 11 ticks, where a 100px-per-rung
        accumulator makes those same 11 rungs cost 1100px of finger travel. The
        gap is cadence, so smaller steps would trade chunky for sluggish.
    */
    const before = await openWithBlueprint(page)
    await page.mouse.wheel(0, NOTCH / 10)

    expect(rungIndex(await settled(page))).toBeCloseTo(rungIndex(before) - 0.1, 6)
})

test('ten small deltas reach the same place as one whole notch', async ({ page }) => {
    /*
        The control on the test above: proportional-per-event has to sum to the
        same travel, or a trackpad and a mouse would disagree about how far a
        given amount of scrolling gets you.
    */
    const before = await openWithBlueprint(page)
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, NOTCH / 10)

    expect(rungIndex(await settled(page))).toBeCloseTo(rungIndex(before) - 1, 6)
})

test('scrolling out repeatedly stops at the floor', async ({ page }) => {
    /*
        Defect 3, the half that did not exist at all: there was no floor
        anywhere. Because the step is multiplicative the old code approached 0
        asymptotically rather than going negative, so it degraded into an
        unusable speck instead of failing outright - which is why this was never
        filed as a crash.
    */
    await openWithBlueprint(page)
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, NOTCH)

    expect(await settled(page)).toBeCloseTo(ZOOM_MIN, 10)
})

test('scrolling in repeatedly stops at the ceiling, exactly', async ({ page }) => {
    /*
        The other half of defect 3. The ceiling existed but the guard tested it
        *before* applying the step, so from 2.99 a tick still landed at 3.289 -
        soft by a whole step. Asserting the exact value is what catches that;
        `toBeLessThanOrEqual(3)` would not have.
    */
    await openWithBlueprint(page)
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -NOTCH)

    expect(await settled(page)).toBeCloseTo(ZOOM_MAX, 10)
})

test('loading a blueprint still fits it exactly, on no rung', async ({ page }) => {
    /*
        The guard. The continuous scale stays the source of truth precisely so
        this keeps working: storing a ladder index instead would snap the fit and
        leave every blueprint slightly over- or under-filled.

        Asserted through the chests' own separation rather than a hardcoded
        number, because the fit depends on the viewport size. 100 tiles apart at
        32 px per tile per unit scale is 3200 * scale on screen, whatever the
        scale turns out to be - the same arithmetic rail-signal-snapping.spec.ts
        relies on when it derives a zoom from two entities.
    */
    const scale = await openWithBlueprint(page)
    const { a, b } = await page.evaluate(() => ({
        a: window.__fbe_test.entityScreenPosition(1),
        b: window.__fbe_test.entityScreenPosition(2),
    }))

    /* Both must be on screen, or the separation is measured against nothing. */
    if (!a || !b) throw new Error('both chests must have a screen position')

    expect(Math.abs(b.x - a.x)).toBeCloseTo(100 * 32 * scale, 6)
    expect(scale).toBeGreaterThan(ZOOM_MIN)
    expect(scale).toBeLessThan(ZOOM_MAX)
    /* Off-ladder, which is why stepZoom has to snap at all. */
    expect(Math.abs(rungIndex(scale) - Math.round(rungIndex(scale)))).toBeGreaterThan(0.01)
})
