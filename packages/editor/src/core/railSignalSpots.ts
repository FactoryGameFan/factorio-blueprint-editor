/*
    Where a rail signal may legally sit, relative to a rail.

    GENERATED - do not edit by hand. Produced by
    tools/oracle/generate-rail-signal-spots.mjs from
    tools/oracle/fixtures/rail-signal-spots.json, which measured it against
    Factorio Version: 2.1.12 (build 87038, mac-arm64, steam).

    152 legal placements across 38 rail orientations: 4 per rail,
    5 on curved-rail-b, and only 2 on a legacy-straight-rail at a diagonal. Each
    spot is legal at exactly **one** direction, which is why snapping sets the
    signal's direction as well as its position.

    Offsets are from the rail's own position and are half-tile values, since a
    signal sits at a tile centre while a rail is anchored on a tile corner.

    The four elevated-* rail types are deliberately absent: placing one needs a
    rail support, so the probe could not sweep signals around them, and an absent
    rail simply gets no snapping rather than the wrong snapping.

    rail-signal and rail-chain-signal share this table - they agreed on every one
    of the 38 orientations measured, and the generator re-checks that
    before emitting.
*/

/** A legal signal placement, as an offset from the rail and the one direction it is legal at */
export interface IRailSignalSpot {
    readonly dx: number
    readonly dy: number
    readonly dir: number
}

/** Keyed by rail prototype name, then by the rail's direction */
export const RAIL_SIGNAL_SPOTS: Readonly<
    Record<string, Readonly<Record<number, readonly IRailSignalSpot[]>>>
> = {
    'curved-rail-a': {
        0: [
            { dx: -1.5, dy: -1.5, dir: 15 },
            { dx: 0.5, dy: -2.5, dir: 7 },
            { dx: 1.5, dy: 1.5, dir: 8 },
            { dx: -1.5, dy: 1.5, dir: 0 },
        ],
        2: [
            { dx: -0.5, dy: -2.5, dir: 1 },
            { dx: 1.5, dy: -1.5, dir: 9 },
            { dx: 1.5, dy: 1.5, dir: 8 },
            { dx: -1.5, dy: 1.5, dir: 0 },
        ],
        4: [
            { dx: -1.5, dy: -1.5, dir: 4 },
            { dx: 1.5, dy: -1.5, dir: 3 },
            { dx: 2.5, dy: 0.5, dir: 11 },
            { dx: -1.5, dy: 1.5, dir: 12 },
        ],
        6: [
            { dx: -1.5, dy: -1.5, dir: 4 },
            { dx: 2.5, dy: -0.5, dir: 5 },
            { dx: 1.5, dy: 1.5, dir: 13 },
            { dx: -1.5, dy: 1.5, dir: 12 },
        ],
        8: [
            { dx: -1.5, dy: -1.5, dir: 0 },
            { dx: 1.5, dy: -1.5, dir: 8 },
            { dx: 1.5, dy: 1.5, dir: 7 },
            { dx: -0.5, dy: 2.5, dir: 15 },
        ],
        10: [
            { dx: -1.5, dy: -1.5, dir: 0 },
            { dx: 1.5, dy: -1.5, dir: 8 },
            { dx: 0.5, dy: 2.5, dir: 9 },
            { dx: -1.5, dy: 1.5, dir: 1 },
        ],
        12: [
            { dx: -2.5, dy: -0.5, dir: 3 },
            { dx: 1.5, dy: -1.5, dir: 4 },
            { dx: 1.5, dy: 1.5, dir: 12 },
            { dx: -1.5, dy: 1.5, dir: 11 },
        ],
        14: [
            { dx: -1.5, dy: -1.5, dir: 5 },
            { dx: 1.5, dy: -1.5, dir: 4 },
            { dx: 1.5, dy: 1.5, dir: 12 },
            { dx: -2.5, dy: 0.5, dir: 13 },
        ],
    },
    'curved-rail-b': {
        0: [
            { dx: -2.5, dy: -0.5, dir: 14 },
            { dx: -0.5, dy: -2.5, dir: 6 },
            { dx: 0.5, dy: -0.5, dir: 7 },
            { dx: 1.5, dy: 0.5, dir: 7 },
            { dx: -0.5, dy: 1.5, dir: 15 },
        ],
        2: [
            { dx: -0.5, dy: -0.5, dir: 1 },
            { dx: 0.5, dy: -2.5, dir: 2 },
            { dx: 2.5, dy: -0.5, dir: 10 },
            { dx: 0.5, dy: 1.5, dir: 9 },
            { dx: -1.5, dy: 0.5, dir: 1 },
        ],
        4: [
            { dx: -1.5, dy: -0.5, dir: 3 },
            { dx: 0.5, dy: -2.5, dir: 2 },
            { dx: 2.5, dy: -0.5, dir: 10 },
            { dx: 0.5, dy: 0.5, dir: 11 },
            { dx: -0.5, dy: 1.5, dir: 11 },
        ],
        6: [
            { dx: -0.5, dy: -1.5, dir: 5 },
            { dx: 0.5, dy: -0.5, dir: 5 },
            { dx: 2.5, dy: 0.5, dir: 6 },
            { dx: 0.5, dy: 2.5, dir: 14 },
            { dx: -1.5, dy: 0.5, dir: 13 },
        ],
        8: [
            { dx: -1.5, dy: -0.5, dir: 15 },
            { dx: 0.5, dy: -1.5, dir: 7 },
            { dx: 2.5, dy: 0.5, dir: 6 },
            { dx: 0.5, dy: 2.5, dir: 14 },
            { dx: -0.5, dy: 0.5, dir: 15 },
        ],
        10: [
            { dx: -0.5, dy: -1.5, dir: 1 },
            { dx: 1.5, dy: -0.5, dir: 9 },
            { dx: 0.5, dy: 0.5, dir: 9 },
            { dx: -0.5, dy: 2.5, dir: 10 },
            { dx: -2.5, dy: 0.5, dir: 2 },
        ],
        12: [
            { dx: -0.5, dy: -0.5, dir: 3 },
            { dx: 0.5, dy: -1.5, dir: 3 },
            { dx: 1.5, dy: 0.5, dir: 11 },
            { dx: -0.5, dy: 2.5, dir: 10 },
            { dx: -2.5, dy: 0.5, dir: 2 },
        ],
        14: [
            { dx: -2.5, dy: -0.5, dir: 14 },
            { dx: -0.5, dy: -2.5, dir: 6 },
            { dx: 1.5, dy: -0.5, dir: 5 },
            { dx: 0.5, dy: 1.5, dir: 13 },
            { dx: -0.5, dy: 0.5, dir: 13 },
        ],
    },
    'half-diagonal-rail': {
        0: [
            { dx: -1.5, dy: -0.5, dir: 15 },
            { dx: 0.5, dy: -1.5, dir: 7 },
            { dx: 1.5, dy: 0.5, dir: 7 },
            { dx: -0.5, dy: 1.5, dir: 15 },
        ],
        2: [
            { dx: -0.5, dy: -1.5, dir: 1 },
            { dx: 1.5, dy: -0.5, dir: 9 },
            { dx: 0.5, dy: 1.5, dir: 9 },
            { dx: -1.5, dy: 0.5, dir: 1 },
        ],
        4: [
            { dx: -1.5, dy: -0.5, dir: 3 },
            { dx: 0.5, dy: -1.5, dir: 3 },
            { dx: 1.5, dy: 0.5, dir: 11 },
            { dx: -0.5, dy: 1.5, dir: 11 },
        ],
        6: [
            { dx: -0.5, dy: -1.5, dir: 5 },
            { dx: 1.5, dy: -0.5, dir: 5 },
            { dx: 0.5, dy: 1.5, dir: 13 },
            { dx: -1.5, dy: 0.5, dir: 13 },
        ],
    },
    'legacy-curved-rail': {
        0: [
            { dx: -2.5, dy: -1.5, dir: 14 },
            { dx: -0.5, dy: -3.5, dir: 6 },
            { dx: 2.5, dy: 3.5, dir: 8 },
            { dx: -0.5, dy: 3.5, dir: 0 },
        ],
        2: [
            { dx: 0.5, dy: -3.5, dir: 2 },
            { dx: 2.5, dy: -1.5, dir: 10 },
            { dx: 0.5, dy: 3.5, dir: 8 },
            { dx: -2.5, dy: 3.5, dir: 0 },
        ],
        4: [
            { dx: -3.5, dy: -0.5, dir: 4 },
            { dx: 1.5, dy: -2.5, dir: 2 },
            { dx: 3.5, dy: -0.5, dir: 10 },
            { dx: -3.5, dy: 2.5, dir: 12 },
        ],
        6: [
            { dx: -3.5, dy: -2.5, dir: 4 },
            { dx: 3.5, dy: 0.5, dir: 6 },
            { dx: 1.5, dy: 2.5, dir: 14 },
            { dx: -3.5, dy: 0.5, dir: 12 },
        ],
        8: [
            { dx: -2.5, dy: -3.5, dir: 0 },
            { dx: 0.5, dy: -3.5, dir: 8 },
            { dx: 2.5, dy: 1.5, dir: 6 },
            { dx: 0.5, dy: 3.5, dir: 14 },
        ],
        10: [
            { dx: -0.5, dy: -3.5, dir: 0 },
            { dx: 2.5, dy: -3.5, dir: 8 },
            { dx: -0.5, dy: 3.5, dir: 10 },
            { dx: -2.5, dy: 1.5, dir: 2 },
        ],
        12: [
            { dx: 3.5, dy: -2.5, dir: 4 },
            { dx: 3.5, dy: 0.5, dir: 12 },
            { dx: -1.5, dy: 2.5, dir: 10 },
            { dx: -3.5, dy: 0.5, dir: 2 },
        ],
        14: [
            { dx: -3.5, dy: -0.5, dir: 14 },
            { dx: -1.5, dy: -2.5, dir: 6 },
            { dx: 3.5, dy: -0.5, dir: 4 },
            { dx: 3.5, dy: 2.5, dir: 12 },
        ],
    },
    'legacy-straight-rail': {
        0: [
            { dx: -1.5, dy: -0.5, dir: 0 },
            { dx: 1.5, dy: -0.5, dir: 8 },
            { dx: 1.5, dy: 0.5, dir: 8 },
            { dx: -1.5, dy: 0.5, dir: 0 },
        ],
        2: [
            { dx: 1.5, dy: -1.5, dir: 6 },
            { dx: -0.5, dy: 0.5, dir: 14 },
        ],
        4: [
            { dx: -0.5, dy: -1.5, dir: 4 },
            { dx: 0.5, dy: -1.5, dir: 4 },
            { dx: 0.5, dy: 1.5, dir: 12 },
            { dx: -0.5, dy: 1.5, dir: 12 },
        ],
        6: [
            { dx: -0.5, dy: -0.5, dir: 2 },
            { dx: 1.5, dy: 1.5, dir: 10 },
        ],
        10: [
            { dx: 0.5, dy: -0.5, dir: 6 },
            { dx: -1.5, dy: 1.5, dir: 14 },
        ],
        14: [
            { dx: -1.5, dy: -1.5, dir: 2 },
            { dx: 0.5, dy: 0.5, dir: 10 },
        ],
    },
    'straight-rail': {
        0: [
            { dx: -1.5, dy: -0.5, dir: 0 },
            { dx: 1.5, dy: -0.5, dir: 8 },
            { dx: 1.5, dy: 0.5, dir: 8 },
            { dx: -1.5, dy: 0.5, dir: 0 },
        ],
        2: [
            { dx: -1.5, dy: -0.5, dir: 2 },
            { dx: -0.5, dy: -1.5, dir: 2 },
            { dx: 1.5, dy: 0.5, dir: 10 },
            { dx: 0.5, dy: 1.5, dir: 10 },
        ],
        4: [
            { dx: -0.5, dy: -1.5, dir: 4 },
            { dx: 0.5, dy: -1.5, dir: 4 },
            { dx: 0.5, dy: 1.5, dir: 12 },
            { dx: -0.5, dy: 1.5, dir: 12 },
        ],
        6: [
            { dx: 0.5, dy: -1.5, dir: 6 },
            { dx: 1.5, dy: -0.5, dir: 6 },
            { dx: -0.5, dy: 1.5, dir: 14 },
            { dx: -1.5, dy: 0.5, dir: 14 },
        ],
    },
}
