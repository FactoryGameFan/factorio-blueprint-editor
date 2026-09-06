/*
    Which connection piece each cell of a cargo bay, landing pad or platform hub
    draws, given its eight neighbours.

    Split out of spriteDataBuilder.ts so it can be unit tested without loading
    Factorio data: it is pure, and `tests/cargo-bay-connections.test.ts` checks
    it against the game's own table rather than against our reasoning.
*/

/**
 * Tiles per connection cell.
 *
 * Connection pieces are placed per cell, not per entity - that is issue #378.
 * Each cell computes its own neighbour mask and draws its own piece at its own
 * offset; one entity-wide mask drawn at the entity centre stacks every piece on
 * one spot, which is why two bays side by side used to render as two islands
 * with a gap between them.
 *
 * The cell is 2 tiles because `CargoBayPrototype.build_grid_size` is 2 and every
 * footprint here is a multiple of it: 4x4 for a cargo bay, 8x8 for a landing pad
 * and for a platform hub. The art agrees - measured, all 17 connection pieces
 * are about 2.1 tiles wide, which is a snug fit for a 2-tile cell and three
 * times oversized for a single tile.
 */
export const CARGO_BAY_CELL = 2

/** Whether a bay-like entity occupies each neighbouring cell. */
export interface CargoBayCellNeighbours {
    readonly N: boolean
    readonly E: boolean
    readonly S: boolean
    readonly W: boolean
    readonly NW: boolean
    readonly NE: boolean
    readonly SE: boolean
    readonly SW: boolean
}

/**
 * The 12 connection keys a cell can draw, in the order the game lists them.
 *
 * Derived from Factorio 2.1's `tileset_mapping`, which is this same rule in
 * table form. 2.1 replaced the 12 named keys our 2.0 data still uses with a
 * `tileset` array plus a mask lookup, but the two line up exactly: the tileset's
 * 12 entries carry comments with these names, and their `create_layered_variation`
 * frame numbers match our named keys one for one. The mask's bit order is
 * clockwise from the top-left - NW, N, NE, E, SE, S, SW, W - read off the table
 * rather than its prose, which describes it inconsistently.
 *
 * The non-obvious arm is the walls. An outer corner piece already contains both
 * of the wall segments that meet in it, so a wall is only drawn when neither
 * corner on that side applies: `top_wall` needs N exposed *and* both W and E
 * present. Drawing the wall as well as the corner over-draws by about a third,
 * which is what the entity-wide version did.
 */
export function cargoBayCellPieces(n: CargoBayCellNeighbours): readonly string[] {
    const keys: string[] = []

    if (!n.N && n.W && n.E) keys.push('top_wall')
    if (!n.E && n.N && n.S) keys.push('right_wall')
    if (!n.S && n.W && n.E) keys.push('bottom_wall')
    if (!n.W && n.N && n.S) keys.push('left_wall')

    if (!n.N && !n.W) keys.push('top_left_outer_corner')
    if (!n.N && !n.E) keys.push('top_right_outer_corner')
    if (!n.S && !n.W) keys.push('bottom_left_outer_corner')
    if (!n.S && !n.E) keys.push('bottom_right_outer_corner')

    if (n.N && n.W && !n.NW) keys.push('top_left_inner_corner')
    if (n.N && n.E && !n.NE) keys.push('top_right_inner_corner')
    if (n.S && n.W && !n.SW) keys.push('bottom_left_inner_corner')
    if (n.S && n.E && !n.SE) keys.push('bottom_right_inner_corner')

    return keys
}

/** Bit positions in the game's mask, clockwise from the top-left. */
export const CARGO_BAY_MASK_BITS = {
    NW: 0,
    N: 1,
    NE: 2,
    E: 3,
    SE: 4,
    S: 5,
    SW: 6,
    W: 7,
} as const

/** Expand one of the game's 8-bit masks into the neighbour flags. */
export function cargoBayNeighboursFromMask(mask: number): CargoBayCellNeighbours {
    const bit = (d: keyof typeof CARGO_BAY_MASK_BITS): boolean =>
        ((mask >> CARGO_BAY_MASK_BITS[d]) & 1) === 1
    return {
        N: bit('N'),
        E: bit('E'),
        S: bit('S'),
        W: bit('W'),
        NW: bit('NW'),
        NE: bit('NE'),
        SE: bit('SE'),
        SW: bit('SW'),
    }
}
