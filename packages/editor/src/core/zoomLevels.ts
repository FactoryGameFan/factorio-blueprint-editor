/*
    The zoom ladder (#206), measured off the game rather than chosen.

    Source: tools/oracle/fixtures/zoom-limits.json, captured against the 2.0.77
    client with a human at the wheel over four sessions. Design and the reasoning
    behind each decision: docs/superpowers/specs/2026-08-10-zoom-levels-design.md.

    Pure - no pixi, no FD, no globals - so `zoomLevels.test.ts` runs under
    `vp test` in CI, following railSignalSnapping.ts and throughput.ts. When this
    was written that was the only gate the ladder had, Playwright running nowhere
    but a laptop (#210); the browser suite runs in CI now, but the split still
    earns its keep - `vp test` answers in seconds where the browser job takes
    three and a half minutes and two dev servers on each of four runners to say
    the same thing about arithmetic - measured at 213s for its slowest shard.
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
 * How much wheel travel makes one rung. `WheelEvent.deltaY` is 100 per notch for
 * a notched mouse in Chrome, so one notch is exactly one rung and a notched
 * mouse walks the game's ladder.
 *
 * This is the one number in the file that is feel rather than measurement, and
 * no passing test can see whether it is right - it was driven before shipping.
 */
export const WHEEL_NOTCH_PX = 100

/** `deltaMode` 1 is lines; browsers vary, and this is the common approximation. */
export const LINE_HEIGHT_PX = 16

/** `deltaMode` 2 is pages, which is one screenful of scrolling. */
export const PAGE_HEIGHT_PX = 100

/** Where a scale sits on the ladder, in rungs. Fractional between two rungs. */
export const rungPositionOf = (scale: number): number => Math.log2(scale) * NOTCHES_PER_DOUBLING

/** The scale at a rung position, which need not be a whole number. */
export const scaleAtRungPosition = (position: number): number =>
    2 ** (position / NOTCHES_PER_DOUBLING)

const MIN_POSITION = rungPositionOf(ZOOM_MIN)
const MAX_POSITION = rungPositionOf(ZOOM_MAX)

/**
 * Continuous zoom along the ladder's own curve, moved by wheel events.
 *
 * The ladder describes where the game *stops*; this describes how we travel,
 * and the two agree wherever it matters - `WHEEL_NOTCH_PX` of travel is exactly
 * one rung, so a notched mouse lands on the same values the game does. What it
 * drops is the quantisation between notches, which a trackpad or a
 * smooth-scrolling mouse would otherwise feel as the view holding still and then
 * lurching.
 *
 * Measured reason to prefer this to a finer ladder: in the #206 capture the game
 * moved 11 rungs in 11 ticks - the whole top of its range in 183ms - where an
 * accumulator needing 100px per rung makes those same 11 rungs cost 1100px of
 * finger travel. The gap is a cadence one, so making the steps smaller would
 * trade chunkiness for sluggishness rather than fixing either.
 *
 * The position is held **in rungs** rather than derived from the scale each
 * time, because adding and then subtracting the same number returns the
 * identical float while multiplying and dividing a scale by `2^(1/7)` does not.
 * That is what keeps zoom exactly reversible (defect 1) without a ladder to snap
 * back to.
 */
export class WheelZoom {
    private position: number

    public constructor(scale: number) {
        this.position = this.clampPosition(rungPositionOf(scale))
    }

    private clampPosition(position: number): number {
        /*
            Clamping the position, not merely the scale it produces. Without
            this, scrolling hard against a limit banks travel that has to be
            unwound before the view moves again - several notches of nothing,
            which reads as the wheel having died rather than as a limit.
        */
        return Math.min(MAX_POSITION, Math.max(MIN_POSITION, position))
    }

    /**
     * @param currentScale the viewport's scale, which is the authority. A
     * blueprint load re-fits it and mobile pinch writes it directly, neither
     * through here, so a disagreement means this position is stale.
     * @returns the new scale.
     */
    public feed(deltaY: number, deltaMode: number, currentScale: number): number {
        if (!near(scaleAtRungPosition(this.position), currentScale)) {
            this.position = this.clampPosition(rungPositionOf(currentScale))
        }

        const px =
            deltaMode === 1
                ? deltaY * LINE_HEIGHT_PX
                : deltaMode === 2
                  ? deltaY * PAGE_HEIGHT_PX
                  : deltaY

        /* deltaY is positive scrolling down, which zooms out. */
        this.position = this.clampPosition(this.position - px / WHEEL_NOTCH_PX)
        return scaleAtRungPosition(this.position)
    }
}

/** Two scales that are the same to within float noise from a log/exp round trip. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
