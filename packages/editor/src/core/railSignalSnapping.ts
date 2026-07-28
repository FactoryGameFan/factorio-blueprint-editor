import { IPoint } from '../types'
import { IRailSignalSpot, RAIL_SIGNAL_SPOTS } from './railSignalSpots'

/*
    Snapping a rail signal to the positions the game will actually accept
    (issue #133 item 2).

    Deliberately pure and FD-free, so it is unit tested rather than driven
    through a browser - the caller hands over the rails it found and gets back a
    position and a direction. That matters here more than usual, because the
    thing being modelled is a 152-entry table and the interesting cases are
    arithmetic rather than input handling.

    Why snap at all: a signal is legal at exactly 4 positions per rail (5 on
    curved-rail-b, 2 on a legacy-straight-rail at a diagonal), each at one fixed
    direction, and it is legal **nowhere** that is not next to a rail - measured,
    the game accepts 0 of 2704 placements on bare ground. The editor has always
    let a signal go down anywhere, so a hand-placed one is usually a signal
    Factorio will silently refuse to build. Snapping is what makes the exact
    answer usable; refusing without it would just make signals unplaceable, which
    is why #133's original "make the arm exact" was rescoped to this.
*/

/** The two prototypes this applies to. Both share one spot table - measured, they agree everywhere. */
export const isRailSignal = (name: string): boolean =>
    name === 'rail-signal' || name === 'rail-chain-signal'

/** A rail as this module needs to see it, which is all three fields and nothing else */
export interface ISnapRail {
    readonly name: string
    readonly direction: number
    readonly position: IPoint
}

export interface ISnappedSignal {
    readonly x: number
    readonly y: number
    readonly direction: number
    /** Opaque identifier for the rail chosen, so the caller can tell when it changed */
    readonly target: string
}

/** Every legal placement around one rail, in absolute coordinates */
const spotsFor = (rail: ISnapRail): { spot: IRailSignalSpot; x: number; y: number }[] => {
    const byDirection = RAIL_SIGNAL_SPOTS[rail.name]
    if (byDirection === undefined) return []
    const spots = byDirection[rail.direction]
    if (spots === undefined) return []
    return spots.map(spot => ({
        spot,
        x: rail.position.x + spot.dx,
        y: rail.position.y + spot.dy,
    }))
}

const distanceSquared = (ax: number, ay: number, bx: number, by: number): number =>
    (ax - bx) * (ax - bx) + (ay - by) * (ay - by)

/**
 * How far from the cursor a legal placement may be and still be snapped to, in
 * tiles.
 *
 * This number **is** the worst-case distance between the pointer and the signal,
 * since it is measured cursor-to-spot - a snap radius and a yank radius are the
 * same quantity seen from either end. It was 4, which measured in a browser as
 * the signal sitting up to 3.8 tiles from the pointer on a straight rail and 4.0
 * on a curve, roughly 390px at the editor's 96px-per-tile: far enough that it
 * reads as the signal being stuck rather than as help.
 *
 * 2.5 is bounded below by measurement rather than chosen freely. To snap while
 * the pointer is over a rail's own centre it has to exceed that rail's nearest
 * spot: 1.58 tiles for a `straight-rail`, 2.12 for a `curved-rail-a`. Below 2.12
 * a curve stops responding until the pointer is out near its legal spots, which
 * is the opposite of the problem being fixed.
 */
export const SNAP_MAX_DISTANCE = 2.5

/** The furthest a spot sits from its rail's position on either axis */
const maxAxisReach = (): number => {
    let max = 0
    for (const byDirection of Object.values(RAIL_SIGNAL_SPOTS)) {
        for (const spots of Object.values(byDirection)) {
            for (const spot of spots) {
                max = Math.max(max, Math.abs(spot.dx), Math.abs(spot.dy))
            }
        }
    }
    return max
}

/**
 * How wide a window a caller must search for rails, in tiles, centred on the
 * cursor. A rail this far out can still own the nearest legal placement:
 * legacy-curved-rail's spots reach 3.5 tiles from its own position on either
 * axis, so at a 4-tile snap limit a rail 7.5 tiles away is still a candidate.
 *
 * Derived rather than written down, and that is the point. It was a literal 9 in
 * the caller, which is a **second** distance limit narrower than this one - the
 * same two-numbers-that-must-agree mistake `snapRailSignal` merged its two scans
 * to remove. It silently dropped every rail 4.5 to 7.5 tiles out, and because
 * the narrower limit was the one in charge, deleting the real limit entirely
 * changed nothing a browser could see. Derived, they cannot drift.
 *
 * Rounded up to a whole tile with one to spare, since the grid search rounds the
 * window's edges to tile boundaries.
 */
export const RAIL_SEARCH_WINDOW = 2 * Math.ceil(SNAP_MAX_DISTANCE + maxAxisReach()) + 2

/**
 * Where a signal held at `cursor` should sit, or undefined to leave it alone.
 *
 * Picks the rail with the nearest legal placement rather than the nearest rail,
 * which is not the same thing: every curved-rail-a spot sits at least 2.1 tiles
 * from the rail's own position, so the nearest rail can easily be the one whose
 * legal spots are furthest from the cursor.
 *
 * `rotation` cycles within the chosen rail's spots, so the R key steps around
 * that rail - to the other side of the track, and around a curve - instead of
 * turning the signal on the spot, which would only ever produce an illegal
 * facing. The caller owns the counter and resets it when `target` changes.
 *
 * `target` identifies the rail that was chosen. It is an opaque key for exactly
 * that comparison - compare it, do not parse it.
 *
 * One scan answers both, on purpose. An earlier version had the caller ask a
 * separate function which rail it would snap to and then ask for the position,
 * each with its own copy of the distance test; mutation-checking found that
 * breaking one of the two limits left the other one silently in charge, so the
 * behaviour did not change and only the unit tests noticed. Two scans that must
 * agree are one scan.
 *
 * Answers undefined when nothing is close enough, which leaves ordinary tile
 * snapping in charge. `maxDistance` is in tiles; a caller that overrides it owes
 * itself a correspondingly wider search than `RAIL_SEARCH_WINDOW`.
 */
export const snapRailSignal = (
    cursor: IPoint,
    rails: readonly ISnapRail[],
    rotation = 0,
    maxDistance = SNAP_MAX_DISTANCE
): ISnappedSignal | undefined => {
    let best: { rail: ISnapRail; index: number; d2: number } | undefined
    const limit = maxDistance * maxDistance

    for (const rail of rails) {
        const candidates = spotsFor(rail)
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i]
            const d2 = distanceSquared(cursor.x, cursor.y, c.x, c.y)
            if (d2 > limit) continue
            if (best === undefined || d2 < best.d2) best = { rail, index: i, d2 }
        }
    }

    if (best === undefined) return undefined

    const candidates = spotsFor(best.rail)
    // Positive modulo: rotating counter-clockwise walks the counter negative.
    const i =
        (((best.index + rotation) % candidates.length) + candidates.length) % candidates.length
    const chosen = candidates[i]
    return {
        x: chosen.x,
        y: chosen.y,
        direction: chosen.spot.dir,
        target: `${best.rail.name}|${best.rail.direction}|${best.rail.position.x}|${best.rail.position.y}`,
    }
}
