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
 * The cell is 2 tiles because the art is: measured, all 17 connection pieces are
 * about 2.1 tiles wide, a snug fit for a 2-tile cell and three times oversized
 * for a single tile. Every footprint here is a multiple of 2 as well - 4x4 for a
 * cargo bay, 8x8 for a landing pad and for a platform hub.
 *
 * It is NOT because of `build_grid_size`. Only `cargo-landing-pad` declares one
 * (`= 2`); `cargo-bay` and `space-platform-hub` declare none and snap to whole
 * tiles like any other even-sized entity. So each entity's cells are laid out
 * from its own footprint and two entities' cell grids need not line up, which is
 * why occupancy is asked of the tile across an edge rather than of a cell.
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

/**
 * Tiles of shared edge one `_wide` bridge covers.
 *
 * A bay's side is 4 tiles, which is 2 cells, and that is the unit: measured
 * against the game, a 4-tile seam takes one wide bridge at its midpoint, and
 * two - one per cell - are worse than none. A landing pad's 8-tile side carries
 * two independent 4-tile contacts in every corpus blueprint that has one, which
 * is the same unit seen from the other side.
 */
export const CARGO_BAY_SPAN = 4

/** A bay-like entity's footprint: centre position and square tile size. */
export interface CargoBayBox {
    readonly x: number
    readonly y: number
    readonly size: number
}

/** A connection piece to draw, and where its anchor goes in world tiles. */
export interface CargoBayPiece {
    readonly key: string
    readonly x: number
    readonly y: number
}

const left = (b: CargoBayBox): number => b.x - b.size / 2
const right = (b: CargoBayBox): number => b.x + b.size / 2
const top = (b: CargoBayBox): number => b.y - b.size / 2
const bottom = (b: CargoBayBox): number => b.y + b.size / 2

/**
 * Split a shared edge into spans and name the piece each one takes.
 *
 * `lo`..`hi` is the overlap along the seam. Full 4-tile spans take the wide
 * piece; a shorter remainder takes the narrow one.
 *
 * Two lengths are measured against the game: 4 tiles, which is a bay's whole
 * side, and 2, which is what two entities offset by half a side share. Nothing
 * else is. An odd overlap is reachable - a bay declares no `build_grid_size`, so
 * two of them can sit 1 or 3 tiles out of step - and an 8-tile edge is reachable
 * from a hand-written blueprint holding two landing pads. Both fall out of the
 * same "4 tiles is the unit" rule rather than being answers of their own.
 */
function spansOf(lo: number, hi: number): { readonly centre: number; readonly wide: boolean }[] {
    const out: { centre: number; wide: boolean }[] = []
    for (let a = lo; a < hi; a += CARGO_BAY_SPAN) {
        const b = Math.min(a + CARGO_BAY_SPAN, hi)
        out.push({ centre: (a + b) / 2, wide: b - a >= CARGO_BAY_SPAN })
    }
    return out
}

/**
 * The bridge pieces `self` draws for its neighbours.
 *
 * Bridges sit on the shared edge BETWEEN two entities rather than on a cell of
 * either, which is why no cell mask selects one and why Factorio 2.1 leaves
 * them out of `tileset_mapping` (issue #362 argued from that silence that they
 * were unreachable; the game says otherwise). Each seam is drawn once, by the
 * entity on its west or north side, because both entities of a pair can see it
 * and the neighbour is redrawn whenever either changes.
 *
 * Which key: the name follows the direction the bridge spans, so entities side
 * by side take `bridge_horizontal_*` and stacked ones take `bridge_vertical_*`.
 * Measured against Factorio 2.0.77 on six arrangements, scoring each candidate
 * over the pixels it would itself cover: at every seam exactly one of the eight
 * candidates improves on drawing nothing and the other seven make it worse.
 */
export function cargoBayBridges(
    self: CargoBayBox,
    neighbours: readonly CargoBayBox[]
): readonly CargoBayPiece[] {
    const out: CargoBayPiece[] = []
    for (const n of neighbours) {
        // west or north side only, so a seam is drawn once rather than twice
        if (right(self) === left(n)) {
            const lo = Math.max(top(self), top(n))
            const hi = Math.min(bottom(self), bottom(n))
            for (const s of spansOf(lo, hi)) {
                out.push({
                    key: s.wide ? 'bridge_horizontal_wide' : 'bridge_horizontal_narrow',
                    x: right(self),
                    y: s.centre,
                })
            }
        }
        if (bottom(self) === top(n)) {
            const lo = Math.max(left(self), left(n))
            const hi = Math.min(right(self), right(n))
            for (const s of spansOf(lo, hi)) {
                out.push({
                    key: s.wide ? 'bridge_vertical_wide' : 'bridge_vertical_narrow',
                    x: s.centre,
                    y: bottom(self),
                })
            }
        }
    }
    return out
}

/**
 * The `bridge_crossing` points `self` draws.
 *
 * A crossing goes where the seams themselves cross: a cell corner with all four
 * quadrants covered, and with the covering entity changing both left to right
 * and top to bottom. Both halves of that are load bearing. Without the first, a
 * corner of a lone bay would take one; without the second, the midpoint of an
 * ordinary seam would take one on top of the bridge already there, because the
 * two entities either side of a seam do make its midpoint a four-quadrant
 * point.
 *
 * It is not only a four-entity junction. Measured, a landing pad with two bays
 * stacked against one of its sides draws a crossing at the midpoint of that
 * side, where three entities meet - the pad fills two quadrants and a bay each
 * of the others.
 *
 * `owner` takes a POINT and identifies whichever bay-like entity covers the tile
 * containing it, or undefined for open ground. The four quadrants are read half
 * a tile out from the corner in each diagonal, so the answer does not depend on
 * two entities' cells lining up - which they need not, since a cargo bay
 * declares no `build_grid_size`. The entity in the north-west quadrant draws the
 * crossing, so each point is drawn once.
 */
export function cargoBayCrossings(
    self: CargoBayBox,
    selfId: number,
    owner: (cellX: number, cellY: number) => number | undefined
): readonly CargoBayPiece[] {
    const out: CargoBayPiece[] = []
    const C = CARGO_BAY_CELL
    for (let y = top(self) + C; y <= bottom(self); y += C) {
        for (let x = left(self) + C; x <= right(self); x += C) {
            const nw = owner(x - 0.5, y - 0.5)
            if (nw !== selfId) continue
            const ne = owner(x + 0.5, y - 0.5)
            const sw = owner(x - 0.5, y + 0.5)
            const se = owner(x + 0.5, y + 0.5)
            if (ne === undefined || sw === undefined || se === undefined) continue
            if (nw === ne && sw === se) continue // a seam runs left to right only
            if (nw === sw && ne === se) continue // a seam runs top to bottom only
            out.push({ key: 'bridge_crossing', x, y })
        }
    }
    return out
}
