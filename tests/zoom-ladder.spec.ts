import { test, expect, Page } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    The zoom ladder in a browser (#206). Deliberately thin: the arithmetic is
    unit tested in packages/editor/src/core/zoomLevels.test.ts, which is pure and
    FD-free and so runs under `vp test` in CI, where Playwright does not run at
    all (#210). Duplicating the ladder here would move coverage from the half
    that runs to the half that does not.

    What is left is the part no unit test can see, which is the **wiring**: that
    a wheel event over the canvas reaches the accumulator and lands the viewport
    on a rung. Nothing under tests/ read a zoom level before this, so the whole
    path could have been deleted with the suite green.

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
      - **The accumulator carries a remainder between events**, so a test that
        scrolls twice is not testing the same thing twice. Each test gets a
        fresh page.
*/

/** One mouse notch in Chrome. Matches WHEEL_NOTCH_PX in zoomLevels.ts. */
const NOTCH = 100

/** Which rung a scale sits on: n in 2^(n/7). Non-integral means off-ladder. */
const rungIndex = (scale: number): number => Math.log2(scale) * 7

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

test('a wheel notch down lands one rung below the nearest', async ({ page }) => {
    const before = await openWithBlueprint(page)
    await page.mouse.wheel(0, NOTCH)

    const after = await settled(page)
    expect(after).toBeLessThan(before)
    /* On a rung, not merely smaller - that is the whole point of a ladder. */
    expect(rungIndex(after)).toBeCloseTo(Math.round(rungIndex(before)) - 1, 6)
})

test('a wheel notch up lands one rung above the nearest', async ({ page }) => {
    const before = await openWithBlueprint(page)
    await page.mouse.wheel(0, -NOTCH)

    const after = await settled(page)
    expect(after).toBeGreaterThan(before)
    expect(rungIndex(after)).toBeCloseTo(Math.round(rungIndex(before)) + 1, 6)
})

test('one notch each way is exactly reversible once on the ladder', async ({ page }) => {
    /*
        Defect 1, end to end. The old flat step made this x1.1 then x0.9 = 0.99,
        losing 1% every round trip - and because the loss was proportional it
        never converged, it drifted.

        The return is to the rung below the one the first notch reached, not to
        the fitted scale it started from: that value was on no rung and is gone
        the moment the first notch snaps. Asserting a return to it would be
        asserting the snap never happened.
    */
    await openWithBlueprint(page)

    await page.mouse.wheel(0, -NOTCH)
    const zoomedIn = await settled(page)
    await page.mouse.wheel(0, NOTCH)
    const back = await settled(page)
    expect(rungIndex(back)).toBeCloseTo(Math.round(rungIndex(zoomedIn)) - 1, 6)

    /* And from a rung it is exact both ways, forever. */
    await page.mouse.wheel(0, -NOTCH)
    expect(await settled(page)).toBeCloseTo(zoomedIn, 10)
    await page.mouse.wheel(0, NOTCH)
    expect(await settled(page)).toBeCloseTo(back, 10)
})

test('a burst of small trackpad deltas is one notch, not one each', async ({ page }) => {
    /*
        Defect 2. The old handler read only Math.sign(e.deltaY), so these ten
        events would have been ten rungs - a jump of 2^(10/7), nearly a
        tripling, off one flick of a trackpad.
    */
    const before = await openWithBlueprint(page)
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, NOTCH / 10)

    expect(rungIndex(await settled(page))).toBeCloseTo(Math.round(rungIndex(before)) - 1, 6)
})

test('a partial burst moves nothing at all', async ({ page }) => {
    /*
        The other half of the accumulator, and the one that fails if the
        threshold is dropped: nine tenths of a notch is not a notch. Without
        this, an implementation that stepped on every event would still pass the
        test above by arriving at the same place through ten steps.
    */
    const before = await openWithBlueprint(page)
    for (let i = 0; i < 9; i++) await page.mouse.wheel(0, NOTCH / 10)

    expect(await settled(page)).toBe(before)
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

    expect(await settled(page)).toBeCloseTo(0.1, 10)
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

    expect(await settled(page)).toBeCloseTo(3, 10)
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
    expect(scale).toBeGreaterThan(0.1)
    expect(scale).toBeLessThan(3)
    /* Off-ladder, which is why stepZoom has to snap at all. */
    expect(Math.abs(rungIndex(scale) - Math.round(rungIndex(scale)))).toBeGreaterThan(0.01)
})
