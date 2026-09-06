import * as fs from 'fs'
import * as path from 'path'
import { describe, test, expect } from 'vite-plus/test'
import {
    cargoBayCellPieces,
    cargoBayNeighboursFromMask,
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
