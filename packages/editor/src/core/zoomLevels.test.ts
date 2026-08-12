import { describe, expect, it } from 'vite-plus/test'
import {
    clampZoom,
    LINE_HEIGHT_PX,
    stepZoom,
    WHEEL_NOTCH_PX,
    WheelZoom,
    ZOOM_LEVELS,
    ZOOM_MAX,
    ZOOM_MIN,
    ZOOM_RATIO,
} from './zoomLevels'

/*
    The zoom ladder (#206). Pure and FD-free, so it runs under `vp test` in CI -
    the fast gate, seconds inside `checks`, rather than the browser suite, which
    also runs in CI now but costs five minutes and two dev servers to get there.
    When this was written it was the ladder's only gate at all, Playwright
    running nowhere but a laptop (#210).

    Every expectation about the ladder itself traces to
    tools/oracle/fixtures/zoom-limits.json, captured off the 2.0.77 client with a
    human at the wheel. The game's step is 2^(1/7) - seven notches per doubling -
    on a ladder anchored at exactly 1.0, and all 23 non-clamp values scrolled
    through are exact rungs to within 4.2e-10 in n.

    The two off-ladder cases below are the measured ones, and they are the only
    reason this file can tell the shipped rule from a wrong one that agrees
    everywhere else: three candidate rules agree on every value that is already a
    rung. See the fixture's `offLadderNotches`.
*/

/** 2^(n/7), the game's rung for n notches from the 1.0 baseline. */
const rung = (n: number): number => 2 ** (n / 7)

describe('the ladder', () => {
    it('is strictly ascending', () => {
        for (let i = 1; i < ZOOM_LEVELS.length; i++) {
            expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1])
        }
    })

    it('contains exactly 1.0, which is the baseline the game anchors on', () => {
        expect(ZOOM_LEVELS.filter(z => z === 1)).toHaveLength(1)
    })

    it('is every 2^(n/7) rung strictly inside the limits, and no others', () => {
        const expected = []
        for (let n = Math.ceil(Math.log2(ZOOM_MIN) * 7); n <= Math.log2(ZOOM_MAX) * 7; n++) {
            expected.push(rung(n))
        }
        expect(ZOOM_LEVELS).toEqual(expected)
    })

    it('stays inside the measured limits', () => {
        expect(ZOOM_LEVELS[0]).toBeGreaterThan(ZOOM_MIN)
        expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBeLessThan(ZOOM_MAX)
    })

    it('takes the ceiling from the game and the floor from its map editor', () => {
        // fixture: characterController.readbackClosest
        expect(ZOOM_MAX).toBe(3)
        // 30 of 367 corpus blueprints exceed the game's own 200-tile world-view
        // floor, so the editor takes the game's map editor floor instead.
        expect(ZOOM_MIN).toBe(0.1)
    })

    it('steps by 2^(1/7), seven notches to a doubling', () => {
        expect(ZOOM_RATIO).toBeCloseTo(1.104089514, 9)
        expect(ZOOM_RATIO ** 7).toBeCloseTo(2, 12)
    })
})

describe('stepZoom', () => {
    it('round-trips exactly: one notch in then out returns the starting value', () => {
        // Defect 1. The old flat step made this 1.1 x 0.9 = 0.99, losing 1% a
        // round trip with nothing to snap back to.
        //
        // The two rungs adjacent to a limit are excluded and get their own test
        // below: a step from them lands on the limit, which is not a rung, so
        // the way back is one rung further than it went. That is the game's
        // behaviour, measured, not an accident of this implementation.
        for (const z of ZOOM_LEVELS.slice(1, -1)) {
            expect(stepZoom(stepZoom(z, 1), -1)).toBe(z)
            expect(stepZoom(stepZoom(z, -1), 1)).toBe(z)
        }
    })

    it('moves one rung at a time from a rung', () => {
        expect(stepZoom(1, 1)).toBeCloseTo(rung(1), 12)
        expect(stepZoom(1, -1)).toBeCloseTo(rung(-1), 12)
        expect(stepZoom(2, 1)).toBeCloseTo(rung(8), 12)
    })

    /*
        The case the editor actually lives in: centerViewPort computes a
        continuous fit from a blueprint's bounds on every load, so a notch almost
        never starts on a rung. Measured in the game from 0.83, both directions.
    */
    it('snaps to the nearest rung and then steps, in (measured)', () => {
        expect(stepZoom(0.83, 1)).toBeCloseTo(0.905723664, 9)
    })

    it('snaps to the nearest rung and then steps, out (measured)', () => {
        // The rule that gets this wrong is "move to the next rung in the
        // direction of travel", which answers 0.820335 - and which agrees with
        // the correct rule on the inward case above. This assertion is the only
        // thing separating them.
        expect(stepZoom(0.83, -1)).toBeCloseTo(0.742997145, 9)
    })

    it('lands on the limit exactly rather than overshooting it', () => {
        // The game does this: a step that would pass a limit lands on the limit,
        // so the clamp value is reachable and is not itself a rung.
        expect(stepZoom(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], 1)).toBe(ZOOM_MAX)
        expect(stepZoom(ZOOM_LEVELS[0], -1)).toBe(ZOOM_MIN)
    })

    it('stays put at each limit instead of stepping past it', () => {
        // Defect 3: the ceiling was tested before the multiply, so from 2.99 a
        // tick still landed at 3.289, and there was no floor at all.
        expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
        expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
    })

    it('skips a rung coming off a limit, exactly as the game does', () => {
        /*
            Measured, and it is the one place the ladder is not symmetric. The
            limit sits between two rungs - 3 lies above 2^(11/7) = 2.971989 -
            so the nearest rung to it is the one just below, and stepping out
            from there lands two rungs below the limit.

            The fixture records the game doing precisely this: a human at 3.0
            scrolled one notch out and landed on 2.691800385, skipping
            2.971989. Reproducing it costs nothing, since the skipped rung is
            1% from the limit, and inventing a special case here would be
            departing from the game on the strength of a hunch.
        */
        expect(stepZoom(ZOOM_MAX, -1)).toBeCloseTo(rung(10), 12)
        expect(stepZoom(ZOOM_MAX, -1)).toBeCloseTo(2.691800385, 9)
        expect(stepZoom(ZOOM_MIN, 1)).toBeCloseTo(rung(-22), 12)
    })

    it('pulls a scale from outside the range back inside', () => {
        // A blueprint wider than the floor allows still fits exactly on load,
        // because the fit sets the scale directly - clampZoom is not applied to
        // it. So a notch from 0.04 has to answer something inside the range
        // rather than stepping the ladder down from 0.04.
        expect(stepZoom(0.04, 1)).toBeCloseTo(rung(-22), 12)
        expect(stepZoom(0.04, -1)).toBe(ZOOM_MIN)
        expect(stepZoom(50, -1)).toBeCloseTo(rung(10), 12)
        expect(stepZoom(50, 1)).toBe(ZOOM_MAX)
    })
})

describe('clampZoom', () => {
    it('leaves a value inside the range alone', () => {
        expect(clampZoom(1)).toBe(1)
        expect(clampZoom(0.83)).toBe(0.83)
    })

    it('bounds both ends', () => {
        expect(clampZoom(99)).toBe(ZOOM_MAX)
        expect(clampZoom(0.0001)).toBe(ZOOM_MIN)
    })
})

describe('WheelZoom', () => {
    /*
        Continuous zoom along the same curve the ladder steps through, decided
        2026-08-11 after driving it. The measurement behind that: in the capture
        the game moved 11 rungs in 11 ticks - one per tick, the whole top of the
        range in 183ms - where an accumulator needing 100px per rung makes those
        same 11 rungs cost 1100px of finger travel. Slow discrete steps are what
        "chunky" describes, and the fix is to stop quantising rather than to
        quantise faster.

        A notched mouse is unaffected: one 100px notch is still exactly one rung,
        so it still walks the game's ladder. Everything below a notch, which is
        every event a trackpad or a smooth-scrolling mouse sends, now moves
        proportionally instead of waiting to cross a threshold.
    */
    it('turns one mouse notch into exactly one rung', () => {
        const z = new WheelZoom(1)
        expect(z.feed(-WHEEL_NOTCH_PX, 0, 1)).toBeCloseTo(rung(1), 12)
    })

    it('signs it the way a wheel does: pushing away zooms out', () => {
        const z = new WheelZoom(1)
        expect(z.feed(WHEEL_NOTCH_PX, 0, 1)).toBeCloseTo(rung(-1), 12)
    })

    it('moves a fraction of a rung for a fraction of a notch', () => {
        // The whole point: no threshold to cross, so nothing waits.
        const z = new WheelZoom(1)
        expect(z.feed(-WHEEL_NOTCH_PX / 10, 0, 1)).toBeCloseTo(rung(0.1), 12)
    })

    it('accumulates small events into the same place one big one reaches', () => {
        const small = new WheelZoom(1)
        let last = 1
        for (let i = 0; i < 10; i++) last = small.feed(-WHEEL_NOTCH_PX / 10, 0, last)

        const big = new WheelZoom(1)
        expect(last).toBeCloseTo(big.feed(-WHEEL_NOTCH_PX, 0, 1), 12)
    })

    it('is exactly reversible, to the last bit', () => {
        /*
            Defect 1, and the reason the position is kept in rungs rather than
            recomputed from the scale: adding then subtracting the same number
            returns the identical float, where multiplying and then dividing a
            scale by 2^(1/7) does not.
        */
        const z = new WheelZoom(0.83)
        const out = z.feed(37, 0, 0.83)
        expect(z.feed(-37, 0, out)).toBe(0.83)
    })

    it('normalises line units to the same answer as pixels', () => {
        const z = new WheelZoom(1)
        expect(z.feed(-WHEEL_NOTCH_PX / LINE_HEIGHT_PX, 1, 1)).toBeCloseTo(rung(1), 12)
    })

    it('normalises page units to the same answer as pixels', () => {
        const z = new WheelZoom(1)
        expect(z.feed(-1, 2, 1)).toBeCloseTo(rung(1), 12)
    })

    it('stops exactly at each limit', () => {
        const z = new WheelZoom(1)
        expect(z.feed(WHEEL_NOTCH_PX * 100, 0, 1)).toBe(ZOOM_MIN)
        const y = new WheelZoom(1)
        expect(y.feed(-WHEEL_NOTCH_PX * 100, 0, 1)).toBe(ZOOM_MAX)
    })

    it('does not bank travel past a limit', () => {
        /*
            The position is clamped, not just the scale it produces. Without
            that, scrolling hard against the floor banks a huge negative
            position that has to be unwound before zooming in does anything -
            the view sits still through several notches, which reads as the
            wheel having died.
        */
        const z = new WheelZoom(1)
        let scale = z.feed(WHEEL_NOTCH_PX * 100, 0, 1)
        expect(scale).toBe(ZOOM_MIN)
        scale = z.feed(-WHEEL_NOTCH_PX, 0, scale)
        expect(scale).toBeCloseTo(ZOOM_MIN * ZOOM_RATIO, 12)
    })

    it('re-derives when something else moved the view', () => {
        /*
            Loading a blueprint re-fits the viewport, and mobile pinch writes the
            scale directly. Neither goes through here, so the caller's scale is
            the authority and a disagreement means the position is stale.
        */
        const z = new WheelZoom(1)
        z.feed(-WHEEL_NOTCH_PX, 0, 1)
        // ...a blueprint load then puts the viewport somewhere else entirely.
        expect(z.feed(-WHEEL_NOTCH_PX, 0, 0.5)).toBeCloseTo(0.5 * ZOOM_RATIO, 12)
    })
})
