/*
    The zoom ladder (#206), measured off the game rather than chosen.

    Source: tools/oracle/fixtures/zoom-limits.json, captured against the 2.0.77
    client with a human at the wheel over four sessions. Design and the reasoning
    behind each decision: docs/superpowers/specs/2026-08-10-zoom-levels-design.md.

    Pure - no pixi, no FD, no globals - so `zoomLevels.test.ts` runs under
    `vp test` in CI, following railSignalSnapping.ts and throughput.ts. That
    matters more here than usual: nothing under `tests/` reads a zoom level, and
    Playwright does not run in CI at all (#210).
*/

/**
 * The game's per-notch step: seven notches to a doubling.
 *
 * Measured, not chosen. All 23 non-clamp values a human scrolled through are
 * exact `2^(n/7)` rungs off a baseline of 1.0, worst deviation in `n` of
 * 4.2e-10. The design had left this ratio to "a driving session, since it is
 * pure feel" and guessed 1.33, which is three real notches wide.
 */
export const ZOOM_RATIO = 2 ** (1 / 7)

/** Notches per doubling, which is what makes the ratio a whole-numbered thing. */
export const NOTCHES_PER_DOUBLING = 7

/**
 * The closest the editor will zoom in, taken straight from the game: the
 * character controller's `zoom_limits.closest` is `3`, which is also what
 * `BlueprintContainer` already passed as `maxZoom`. So the ceiling was never
 * wrong - only its softness was, since the old guard tested before multiplying.
 */
export const ZOOM_MAX = 3

/**
 * The furthest out, and the one number here the game could not supply directly.
 *
 * Factorio's world-view floor is a rule rather than a value - at most 200 tiles
 * across the window, capped at 500 - which is 0.3 on a 16:9 display. Adopting it
 * is not open to us: 30 of the 367 corpus blueprints are wider than 200 tiles
 * and the widest is 397, needing 0.151 to fit at 1920px, so the game's own floor
 * would make 8% of real blueprints impossible to view whole. That limit exists
 * to stop a player seeing ungenerated chunks, which an editor does not do.
 *
 * 0.1 is the game's **map editor** floor - its number for the editing context -
 * and it fits the widest corpus blueprint with room to spare.
 */
export const ZOOM_MIN = 0.1

/**
 * Every rung strictly inside the limits, ascending.
 *
 * Computed from the closed form rather than committed as a literal array. The
 * design specified a literal, on the grounds that "the ladder a test asserts is
 * the ladder that ships" - but that was written while the ratio was still going
 * to be a taste decision. It is a measured closed form, so a literal would be a
 * transcription of a formula, and a transcription can drift from it silently in
 * a way 35 hand-copied digits make hard to review. Contrast railSignalSpots.ts,
 * which is generated precisely because its 152 placements have no formula.
 *
 * The limits themselves are deliberately **not** rungs: `ZOOM_MIN` is 0.1 while
 * the lowest rung is 0.102542, and `ZOOM_MAX` is 3 against a highest rung of
 * 2.971989. That is the game's own behaviour - a step that would overshoot a
 * limit lands on the limit exactly - so both are reachable without being levels
 * the ladder passes through on the way.
 */
export const ZOOM_LEVELS: readonly number[] = (() => {
    const levels: number[] = []
    const lowest = Math.ceil(Math.log2(ZOOM_MIN) * NOTCHES_PER_DOUBLING)
    const highest = Math.floor(Math.log2(ZOOM_MAX) * NOTCHES_PER_DOUBLING)
    for (let n = lowest; n <= highest; n++) levels.push(2 ** (n / NOTCHES_PER_DOUBLING))
    return levels
})()

/** Bound a continuous scale to the range. Mobile pinch gets this and nothing else. */
export const clampZoom = (scale: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))

/**
 * One notch: `direction` 1 zooms in, -1 out.
 *
 * The scale stays continuous and is the source of truth, so this has to cope
 * with a starting value on no rung - which is the normal case, not an edge one,
 * because `centerViewPort` computes a continuous fit from a blueprint's bounds
 * on every load.
 *
 * It snaps to the **nearest** rung and then moves one index, which is measured
 * rather than reasoned. Two other rules survive most probes: multiplying from
 * where you are, and moving to the next rung in the direction of travel. From
 * 0.83 a notch in gives 0.905724 under both this rule and the directional one,
 * so only a notch **out** separates them - the game answers 0.742997, which is
 * nearest-then-step. See the fixture's `offLadderNotches`.
 */
export const stepZoom = (scale: number, direction: 1 | -1): number => {
    const clamped = clampZoom(scale)
    const nearest = Math.round(Math.log2(clamped) * NOTCHES_PER_DOUBLING)
    const stepped = 2 ** ((nearest + direction) / NOTCHES_PER_DOUBLING)
    /*
        Landing on the limit rather than short of it. Without this a step from
        the top rung would answer the top rung again, so the last 1% of the
        range would be unreachable by scrolling - and the editor would sit one
        rung inside a ceiling it is supposed to have.
    */
    return clampZoom(stepped)
}

/**
 * A wheel notch in CSS pixels. `WheelEvent.deltaY` is 100 per notch for a mouse
 * in Chrome, and a trackpad emits a burst of much smaller values.
 *
 * This is the one number in the file that is feel rather than measurement: it
 * decides how far a gesture has to travel per rung, and no passing test can see
 * whether it is right. Drive it and print numbers before believing it.
 */
export const WHEEL_NOTCH_PX = 100

/** `deltaMode` 1 is lines; browsers vary, and this is the common approximation. */
export const LINE_HEIGHT_PX = 16

/** `deltaMode` 2 is pages, which is one screenful of scrolling. */
export const PAGE_HEIGHT_PX = 100

/**
 * Accumulates wheel deltas and reports whole rungs.
 *
 * Defect 2 of the design: the old handler read only `Math.sign(e.deltaY)`, so a
 * trackpad emitting a burst of small pixel deltas and a mouse emitting one notch
 * produced the same fixed jump. That is the likeliest single cause of the
 * original "does not feel like the game" complaint, and a discrete ladder makes
 * it more visible than continuous zoom did.
 */
export class WheelAccumulator {
    private pending = 0

    /**
     * @returns a signed rung count - positive to zoom in, negative out, 0 when
     * the threshold has not been crossed yet. Usually -1, 0 or 1.
     */
    public feed(deltaY: number, deltaMode: number): number {
        const px =
            deltaMode === 1
                ? deltaY * LINE_HEIGHT_PX
                : deltaMode === 2
                  ? deltaY * PAGE_HEIGHT_PX
                  : deltaY

        /*
            A reversal drops what was pending. Carrying it across would let a
            nudge one way and then the other fire a rung early, which reads as
            the view jumping while it settles rather than as a step.
        */
        if (px !== 0 && Math.sign(px) !== Math.sign(this.pending)) this.pending = 0
        this.pending += px

        const rungs = Math.trunc(this.pending / WHEEL_NOTCH_PX)
        this.pending -= rungs * WHEEL_NOTCH_PX
        /*
            deltaY is positive scrolling down, which zooms out - hence the
            negation, and hence the explicit zero: negating +0 gives -0, which
            `Object.is` and so `toBe(0)` treat as a different value from the 0
            this documents itself as returning.
        */
        return rungs === 0 ? 0 : -rungs
    }
}
