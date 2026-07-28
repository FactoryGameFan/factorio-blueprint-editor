import { describe, expect, it } from 'vite-plus/test'
import {
    isRailSignal,
    ISnapRail,
    RAIL_SEARCH_WINDOW,
    SNAP_MAX_DISTANCE,
    snapRailSignal,
} from './railSignalSnapping'
import { RAIL_SIGNAL_SPOTS } from './railSignalSpots'

/*
    The arithmetic behind signal snapping (#133 item 2). Pure and FD-free, so it
    runs under vitest rather than Playwright - which is worth having, because
    almost nothing else about placement can be tested this cheaply.

    Every expectation traces to tools/oracle/fixtures/rail-signal-spots.json.
    A straight-rail at direction 0 has exactly these four legal placements:

        (-1.5, -0.5) @ 0    (-1.5, 0.5) @ 0
        ( 1.5, -0.5) @ 8    ( 1.5, 0.5) @ 8

    i.e. one pair on each side of the track, facing opposite ways.
*/

const railAt = (name: string, direction: number, x: number, y: number): ISnapRail => ({
    name,
    direction,
    position: { x, y },
})

describe('isRailSignal', () => {
    it('covers both signal prototypes and nothing else', () => {
        expect(isRailSignal('rail-signal')).toBe(true)
        expect(isRailSignal('rail-chain-signal')).toBe(true)
        expect(isRailSignal('straight-rail')).toBe(false)
        expect(isRailSignal('gate')).toBe(false)
    })
})

describe('the generated table', () => {
    it('holds 152 placements across 38 orientations', () => {
        let spots = 0
        let orientations = 0
        for (const byDirection of Object.values(RAIL_SIGNAL_SPOTS)) {
            for (const list of Object.values(byDirection)) {
                orientations++
                spots += list.length
            }
        }
        expect({ spots, orientations }).toEqual({ spots: 152, orientations: 38 })
    })

    it("orders every rail's spots around a ring, which is what R steps through", () => {
        /*
            The generator sorts by angle around the rail's position so a press of
            R moves to a spatially adjacent spot. It used to sort by dir then dx
            then dy, which grouped the two left-hand spots of a straight rail
            together and made a step from (1.5, 0.5) land on the *diagonal*
            opposite - measured in a browser, where it reads as teleporting.

            Asserted as the invariant rather than as a pinned list, since a
            recapture can legitimately add spots. Angles must not decrease.
        */
        for (const [rail, byDirection] of Object.entries(RAIL_SIGNAL_SPOTS)) {
            for (const [dir, spots] of Object.entries(byDirection)) {
                const angles = spots.map(s => Math.atan2(s.dy, s.dx))
                const sorted = [...angles].sort((a, b) => a - b)
                expect(angles, `${rail} at ${dir} is not in ring order`).toEqual(sorted)
            }
        }
    })

    it("walks a straight rail's rectangle rather than crossing it diagonally", () => {
        // The concrete case the ring order exists for
        expect(RAIL_SIGNAL_SPOTS['straight-rail'][0]).toEqual([
            { dx: -1.5, dy: -0.5, dir: 0 },
            { dx: 1.5, dy: -0.5, dir: 8 },
            { dx: 1.5, dy: 0.5, dir: 8 },
            { dx: -1.5, dy: 0.5, dir: 0 },
        ])
    })

    it('gives every spot exactly one direction, and no elevated rail any', () => {
        for (const [rail, byDirection] of Object.entries(RAIL_SIGNAL_SPOTS)) {
            expect(rail.startsWith('elevated-')).toBe(false)
            for (const list of Object.values(byDirection)) {
                for (const spot of list) {
                    expect(Number.isInteger(spot.dir)).toBe(true)
                    // Half-tile offsets throughout: a signal sits at a tile centre
                    expect(Math.abs(spot.dx % 1)).toBe(0.5)
                    expect(Math.abs(spot.dy % 1)).toBe(0.5)
                }
            }
        }
    })
})

describe('RAIL_SEARCH_WINDOW', () => {
    /*
        The caller searches a square window for rails and then this module
        rejects them on distance, so the window is a second limit sitting over
        the real one. A window too narrow does not look wrong: it finds nothing,
        the snap quietly does not happen, and it also makes the real limit
        untestable through the browser, because the narrower number is the one in
        charge. It was a hardcoded 9 in the caller and did exactly that.

        Hence this, which is the invariant rather than a pinned number: every
        spot in the table has to be reachable from a rail sitting on the window's
        own edge.
    */
    it('is wide enough for every spot in the table at the full snap distance', () => {
        let worst = 0
        for (const byDirection of Object.values(RAIL_SIGNAL_SPOTS)) {
            for (const spots of Object.values(byDirection)) {
                for (const spot of spots) {
                    worst = Math.max(worst, Math.abs(spot.dx), Math.abs(spot.dy))
                }
            }
        }
        expect(worst).toBe(3.5) // legacy-curved-rail, the furthest-reaching one
        expect(RAIL_SEARCH_WINDOW / 2).toBeGreaterThanOrEqual(SNAP_MAX_DISTANCE + worst)
    })
})

describe('snapRailSignal', () => {
    const rail = railAt('straight-rail', 0, 0, 0)

    it('snaps to the nearest legal placement and takes its direction', () => {
        // Just right of the rail and slightly down, so (1.5, 0.5) @ 8 is nearest
        expect(snapRailSignal({ x: 1.4, y: 0.6 }, [rail])).toMatchObject({
            x: 1.5,
            y: 0.5,
            direction: 8,
        })

        // The mirror case, which must come back with the *other* direction - a
        // snap that ignored the table's dir would pass the first and fail this
        expect(snapRailSignal({ x: -1.4, y: -0.6 }, [rail])).toMatchObject({
            x: -1.5,
            y: -0.5,
            direction: 0,
        })
    })

    it('leaves the signal alone when nothing is near enough', () => {
        expect(snapRailSignal({ x: 40, y: 40 }, [rail])).toBeUndefined()
        // And with no rails at all, which is the bare-ground case the game refuses
        expect(snapRailSignal({ x: 0, y: 0 }, [])).toBeUndefined()
    })

    it('respects maxDistance', () => {
        const far = { x: 3.4, y: 0.5 }
        expect(snapRailSignal(far, [rail], 0, 4)).toBeDefined()
        expect(snapRailSignal(far, [rail], 0, 1)).toBeUndefined()
    })

    it('still snaps while the pointer is over a rail, which bounds the default below', () => {
        /*
            SNAP_MAX_DISTANCE is the worst-case gap between pointer and signal,
            so it wants to be small - but not so small that pointing at a rail
            stops snapping. These are the two measured floors it has to clear.
            A curve is the binding one at 2.12 tiles.
        */
        expect(snapRailSignal({ x: 0, y: 0 }, [railAt('straight-rail', 0, 0, 0)])).toBeDefined()
        expect(snapRailSignal({ x: 0, y: 0 }, [railAt('curved-rail-a', 0, 0, 0)])).toBeDefined()
        expect(SNAP_MAX_DISTANCE).toBeLessThan(4) // the value that measured as a yank
    })

    it('ignores rails it has no table for, rather than guessing', () => {
        const elevated = railAt('elevated-straight-rail', 0, 0, 0)
        expect(snapRailSignal({ x: 1.4, y: 0.6 }, [elevated])).toBeUndefined()
        expect(
            snapRailSignal({ x: 1.4, y: 0.6 }, [railAt('wooden-chest', 0, 0, 0)])
        ).toBeUndefined()
    })

    it('cycles through that rail as rotation advances, and wraps', () => {
        const cursor = { x: 1.4, y: 0.6 }
        const seen = [0, 1, 2, 3].map(r => snapRailSignal(cursor, [rail], r))
        // Four distinct legal placements, all of them from the table
        expect(new Set(seen.map(s => `${s?.x},${s?.y},${s?.direction}`)).size).toBe(4)
        for (const s of seen) {
            expect(RAIL_SIGNAL_SPOTS['straight-rail'][0]).toContainEqual({
                dx: s?.x,
                dy: s?.y,
                dir: s?.direction,
            })
        }
        // And it wraps rather than running off the end
        expect(snapRailSignal(cursor, [rail], 4)).toEqual(seen[0])
        // Counter-clockwise walks the counter negative, which must not go out of range
        expect(snapRailSignal(cursor, [rail], -1)).toEqual(seen[3])
    })

    it('picks the rail with the nearest spot, not the nearest rail', () => {
        /*
            The distinction a "nearest rail" implementation gets wrong. Every
            curved-rail-a spot sits at least 2.1 tiles from the rail's own
            position, so a curved rail can be much closer to the cursor than a
            straight one while the straight one owns the nearer legal placement.

            Positions here are chosen to make that arithmetic hold, not to be a
            layout the game would produce - this is the selection rule under
            test, not the geometry.
        */
        const straight = railAt('straight-rail', 0, 6, 0)
        const curved = railAt('curved-rail-a', 0, 7, 1)
        const cursor = { x: 7.5, y: 0.5 }

        // The curved rail is nearer the cursor than the straight one...
        const dCurved = Math.hypot(curved.position.x - cursor.x, curved.position.y - cursor.y)
        const dStraight = Math.hypot(straight.position.x - cursor.x, straight.position.y - cursor.y)
        expect(dCurved).toBeLessThan(dStraight)

        // ...but the straight rail owns the spot the cursor is sitting on
        expect(snapRailSignal(cursor, [curved, straight])).toMatchObject({
            x: 7.5,
            y: 0.5,
            direction: 8,
        })
    })
})

describe('the target key', () => {
    /*
        The key rides along on the same answer as the position on purpose - it
        used to come from a second function with its own distance scan, and
        breaking one of the two limits left the other silently in charge, so the
        editor behaved identically and only these tests noticed.
    */
    const targetAt = (x: number, y: number, rails: ISnapRail[]): string | undefined =>
        snapRailSignal({ x, y }, rails)?.target

    it('changes when the rail being snapped to changes, and not otherwise', () => {
        const a = railAt('straight-rail', 0, 0, 0)
        const b = railAt('straight-rail', 0, 10, 0)

        const near = targetAt(1.4, 0.6, [a, b])
        const alsoNear = targetAt(-1.4, -0.6, [a, b])
        const other = targetAt(11.4, 0.6, [a, b])

        // Two different spots on the same rail are the same target
        expect(near).toBe(alsoNear)
        expect(other).not.toBe(near)
        expect(targetAt(40, 40, [a, b])).toBeUndefined()
    })

    it('does not move as the rotation steps around the chosen rail', () => {
        const rail = railAt('straight-rail', 0, 0, 0)
        const cursor = { x: 1.4, y: 0.6 }
        const targets = [0, 1, 2, 3].map(r => snapRailSignal(cursor, [rail], r)?.target)
        expect(new Set(targets).size).toBe(1)
    })
})
