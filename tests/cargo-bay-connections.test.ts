import * as fs from 'fs'
import * as path from 'path'
import { describe, test, expect } from 'vite-plus/test'
import {
    cargoBayBridges,
    cargoBayCellPieces,
    cargoBayCrossings,
    cargoBayNeighboursFromMask,
    type CargoBayBox,
    type CargoBayPiece,
} from '../packages/editor/src/core/cargoBayConnections'

/*
    Checks our connection rule against Factorio's own, rather than against the
    reasoning that produced it.

    tests/__fixtures__/cargo-bay-connection-masks.json is the `tileset_mapping`
    table out of Factorio 2.1.14's
    base/graphics/entity/cargo-hubs/connections/connections.lua, with the tileset
    indices resolved to the key names its own comments give them. 2.1 replaced
    the 12 named keys our 2.0 data still uses with that table, so it is the same
    rule written down explicitly - and it is the closest thing to an authoritative
    answer short of running the game, which cannot render anyway.

    This is a fixed point, not a snapshot. A diff means the extracted table
    changed, and the change is what wants reviewing.
*/
const EXPECTED: Record<string, string[]> = JSON.parse(
    fs.readFileSync(
        path.resolve(process.cwd(), 'tests/__fixtures__/cargo-bay-connection-masks.json'),
        'utf8'
    )
)

/*
    The two masks where we knowingly differ. Both set a diagonal neighbour while
    setting neither of its orthogonals - a bay touching another only at a corner
    - and the game draws a wall where the rule draws an outer corner.

    They are listed rather than accommodated because bending the rule to fit them
    would need a special case that nothing else in the table justifies, and
    because a cargo bay cannot reach either mask: bays sit on the same 2-tile
    grid as the cells, so a cell with a diagonal neighbour and no orthogonal one
    would need a bay placed off-grid.
*/
const KNOWN_DIFFERENCES: Record<number, { game: string[]; ours: string[] }> = {
    180: {
        game: ['bottom_left_inner_corner', 'right_wall'],
        ours: ['bottom_left_inner_corner', 'top_right_outer_corner'],
    },
    181: {
        game: ['bottom_left_inner_corner', 'right_wall'],
        ours: ['bottom_left_inner_corner', 'top_right_outer_corner'],
    },
}

const piecesFor = (mask: number): string[] =>
    [...cargoBayCellPieces(cargoBayNeighboursFromMask(mask))].sort()

describe('cargo bay connection pieces', () => {
    test('the fixture is the table the game ships, not a trimmed copy', () => {
        expect(Object.keys(EXPECTED)).toHaveLength(175)
    })

    test('agrees with the game on every mask it maps, bar two known cases', () => {
        const disagreements: { mask: number; game: string[]; ours: string[] }[] = []
        for (const [key, game] of Object.entries(EXPECTED)) {
            const mask = Number(key)
            const ours = piecesFor(mask)
            if (JSON.stringify(ours) !== JSON.stringify([...game].sort())) {
                disagreements.push({ mask, game: [...game].sort(), ours })
            }
        }
        expect(
            disagreements.map(d => d.mask),
            `disagreed on ${disagreements.length} masks: ${JSON.stringify(disagreements)}`
        ).toEqual(Object.keys(KNOWN_DIFFERENCES).map(Number))
    })

    test('the two known differences still differ in exactly the way recorded', () => {
        for (const [key, recorded] of Object.entries(KNOWN_DIFFERENCES)) {
            const mask = Number(key)
            expect(EXPECTED[key], `mask ${mask} moved in the fixture`).toEqual(recorded.game)
            expect(piecesFor(mask), `mask ${mask} changed for us`).toEqual(recorded.ours)
        }
    })

    /*
        The shapes that actually occur, spelled out so a regression names the
        case rather than a mask number. A bay is 2x2 cells, so a lone bay is four
        corner cells and no walls at all - walls only appear once bays join.
    */
    test('a cell with nothing around it is all four outer corners', () => {
        const none = {
            N: false,
            E: false,
            S: false,
            W: false,
            NW: false,
            NE: false,
            SE: false,
            SW: false,
        }
        expect(piecesFor(0)).toEqual([
            'bottom_left_outer_corner',
            'bottom_right_outer_corner',
            'top_left_outer_corner',
            'top_right_outer_corner',
        ])
        expect([...cargoBayCellPieces(none)].sort()).toEqual(piecesFor(0))
    })

    test('a fully surrounded cell draws nothing', () => {
        expect(piecesFor(255)).toEqual([])
        expect(EXPECTED['255']).toBeUndefined()
    })

    test('a corner cell of a lone bay draws one outer corner and no walls', () => {
        // top-left cell of a 2x2-cell bay: neighbours to the E, SE and S only
        const mask = (1 << 3) | (1 << 4) | (1 << 5) // E, SE, S
        expect(mask).toBe(56)
        expect(piecesFor(mask)).toEqual(['top_left_outer_corner'])
        expect(EXPECTED['56']).toEqual(['top_left_outer_corner'])
    })

    test('a cell with neighbours on both sides but not above draws a wall', () => {
        // W, SW, S, SE, E present; N and NW absent
        const mask = (1 << 7) | (1 << 6) | (1 << 5) | (1 << 4) | (1 << 3)
        expect(mask).toBe(248)
        expect(piecesFor(mask)).toEqual(['top_wall'])
        expect(EXPECTED['248']).toEqual(['top_wall'])
    })

    test('an outer corner replaces the two walls meeting in it', () => {
        // N and E present, nothing else: exposed on S and W
        const mask = (1 << 1) | (1 << 3)
        expect(mask).toBe(10)
        expect(piecesFor(mask)).toEqual(['bottom_left_outer_corner', 'top_right_inner_corner'])
        expect(piecesFor(mask)).not.toContain('bottom_wall')
        expect(piecesFor(mask)).not.toContain('left_wall')
    })

    test('opposite exposed sides do give two walls, since no corner applies', () => {
        // N and S present, E and W exposed
        const mask = (1 << 1) | (1 << 5)
        expect(mask).toBe(34)
        expect(piecesFor(mask)).toEqual(['left_wall', 'right_wall'])
    })

    test('a missing diagonal between two present sides is an inner corner', () => {
        const mask = 254 // everything but NW
        expect(piecesFor(mask)).toEqual(['top_left_inner_corner'])
        expect(EXPECTED['254']).toEqual(['top_left_inner_corner'])
    })
})

/*
    The bridge half of the rule, pinned against Factorio 2.0.77 itself.

    These cannot be checked against `tileset_mapping` the way the cell pieces
    above are: the five bridge keys sit outside that table in both 2.0 and 2.1,
    because a bridge is anchored on the shared edge BETWEEN two entities and no
    cell mask can select one. Issue #362 read that silence as "unreachable" and
    was wrong. The answers here come from rendering the arrangements in the game
    and scoring every candidate over the pixels it would itself cover
    (`tools/oracle/probe-cargo-bay-render.mjs`): at each seam exactly one of the
    eight candidates beats drawing nothing, and the other seven make it worse.

    Measured gain of the winner, in mean absolute RGB error over its own pixels,
    against the runner-up:

      side by side, 4-tile edge   bridge_horizontal_wide   +7.8   next -1.6
      stacked, 4-tile edge        bridge_vertical_wide    +10.4   next -3.9
      side by side, 2-tile edge   bridge_horizontal_narrow +1.4   next -1.9
      stacked, 2-tile edge        bridge_vertical_narrow  +11.7   next -4.8
      four bays meeting           bridge_crossing         +20.6   next +2.1
      pad and two bays meeting    bridge_crossing          +7.5   next -2.3
*/
const bay = (x: number, y: number): CargoBayBox => ({ x, y, size: 4 })
const pad = (x: number, y: number): CargoBayBox => ({ x, y, size: 8 })

/** Tile ownership for a set of footprints, as `cargoBayCrossings` wants it. */
const ownerFor = (boxes: readonly CargoBayBox[]) => {
    const map = new Map<string, number>()
    boxes.forEach((b, i) => {
        const h = b.size / 2
        for (let y = b.y - h; y < b.y + h; y += 1) {
            for (let x = b.x - h; x < b.x + h; x += 1) map.set(`${x},${y}`, i)
        }
    })
    return (x: number, y: number): number | undefined =>
        map.get(`${Math.floor(x)},${Math.floor(y)}`)
}

const crossingsOf = (boxes: readonly CargoBayBox[]): CargoBayPiece[] => {
    const owner = ownerFor(boxes)
    return boxes.flatMap((b, i) => [...cargoBayCrossings(b, i, owner)])
}

describe('cargo bay bridges', () => {
    test('two bays side by side take one wide bridge, on the shared edge', () => {
        expect(cargoBayBridges(bay(0, 0), [bay(4, 0)])).toEqual([
            { key: 'bridge_horizontal_wide', x: 2, y: 0 },
        ])
    })

    test('only the west bay of a pair draws it, so the seam is drawn once', () => {
        expect(cargoBayBridges(bay(4, 0), [bay(0, 0)])).toEqual([])
    })

    test('two stacked bays take a vertical bridge, drawn by the north one', () => {
        expect(cargoBayBridges(bay(0, 0), [bay(0, 4)])).toEqual([
            { key: 'bridge_vertical_wide', x: 0, y: 2 },
        ])
        expect(cargoBayBridges(bay(0, 4), [bay(0, 0)])).toEqual([])
    })

    test('a 2-tile shared edge takes the narrow bridge instead', () => {
        // a bay declares no build_grid_size, so it snaps to whole tiles and may
        // sit half a side out of step with its neighbour, sharing 2 tiles not 4
        expect(cargoBayBridges(bay(0, 0), [bay(4, 2)])).toEqual([
            { key: 'bridge_horizontal_narrow', x: 2, y: 1 },
        ])
        expect(cargoBayBridges(bay(0, 0), [bay(2, 4)])).toEqual([
            { key: 'bridge_vertical_narrow', x: 1, y: 2 },
        ])
    })

    test('a gap is not a seam, and nothing bridges one', () => {
        // the `gap2` capture is the control: two bays 2 tiles apart draw no
        // join at all in game, so "bridge" does not mean what the word suggests
        expect(cargoBayBridges(bay(0, 0), [bay(6, 0)])).toEqual([])
        expect(cargoBayBridges(bay(0, 0), [bay(0, 8)])).toEqual([])
    })

    test('touching only at a corner is not a shared edge', () => {
        expect(cargoBayBridges(bay(0, 0), [bay(4, 4)])).toEqual([])
    })

    test("a bay on a landing pad's side takes a bridge on its own 4 tiles", () => {
        // the pad is 8x8, so its side carries two independent 4-tile contacts,
        // and each bay gets its own bridge at its own midpoint
        expect(cargoBayBridges(pad(0, 0), [bay(6, -2), bay(6, 2)])).toEqual([
            { key: 'bridge_horizontal_wide', x: 4, y: -2 },
            { key: 'bridge_horizontal_wide', x: 4, y: 2 },
        ])
    })

    test('a longer shared edge is split into 4-tile spans', () => {
        /*
            Two 8x8 entities against each other. Not reachable in game - a force
            may have only one landing pad per surface and a hub only exists on a
            platform - but a hand-written blueprint can hold two, so the rule has
            to answer. It is the generalisation of the measured 4-tile unit, not
            a measurement of its own.
        */
        expect(cargoBayBridges(pad(0, 0), [pad(8, 0)])).toEqual([
            { key: 'bridge_horizontal_wide', x: 4, y: -2 },
            { key: 'bridge_horizontal_wide', x: 4, y: 2 },
        ])
        // 6 tiles of overlap: one full span and a 2-tile remainder
        expect(cargoBayBridges(pad(0, 0), [pad(8, 2)])).toEqual([
            { key: 'bridge_horizontal_wide', x: 4, y: 0 },
            { key: 'bridge_horizontal_narrow', x: 4, y: 3 },
        ])
    })
})

describe('cargo bay crossings', () => {
    test('four bays meeting take one crossing, at the point they meet', () => {
        const boxes = [bay(0, 0), bay(4, 0), bay(0, 4), bay(4, 4)]
        expect(crossingsOf(boxes)).toEqual([{ key: 'bridge_crossing', x: 2, y: 2 }])
    })

    test('the midpoint of an ordinary seam is not a crossing', () => {
        /*
            The case that makes the second half of the rule load bearing. Two
            stacked bays do put four occupied cells around their seam midpoint,
            so "all four quadrants covered" alone would put a crossing there on
            top of the vertical bridge already drawn. A crossing needs the
            covering entity to change left to right as well as top to bottom.
        */
        expect(crossingsOf([bay(0, 0), bay(0, 4)])).toEqual([])
        expect(crossingsOf([bay(0, 0), bay(4, 0)])).toEqual([])
    })

    test('a lone bay has four occupied corners of its own and no crossing', () => {
        expect(crossingsOf([bay(0, 0)])).toEqual([])
        expect(crossingsOf([pad(0, 0)])).toEqual([])
    })

    test('three entities can make a crossing, where two of the four are one', () => {
        // measured: a landing pad with two bays stacked against one side draws
        // a crossing at the midpoint of that side
        expect(crossingsOf([pad(0, 0), bay(6, -2), bay(6, 2)])).toEqual([
            { key: 'bridge_crossing', x: 4, y: 0 },
        ])
    })

    test('three quadrants is not enough', () => {
        // measured at the pad's own corner with one bay against it: every
        // candidate scored worse than drawing nothing
        expect(crossingsOf([pad(0, 0), bay(6, -2)])).toEqual([])
    })

    test('a row of three bays crossing a second row gives two crossings', () => {
        const boxes = [bay(0, 0), bay(4, 0), bay(8, 0), bay(0, 4), bay(4, 4), bay(8, 4)]
        expect(crossingsOf(boxes)).toEqual([
            { key: 'bridge_crossing', x: 2, y: 2 },
            { key: 'bridge_crossing', x: 6, y: 2 },
        ])
    })
})
