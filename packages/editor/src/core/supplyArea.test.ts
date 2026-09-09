import { describe, expect, it } from 'vite-plus/test'
import {
    BeaconPrototype,
    ElectricPolePrototype,
    EntityWithOwnerPrototype,
} from 'factorio:prototype'
import { supplyAreaBounds, supplyAreaHalfExtent, suppliesEntity } from './supplyArea'

/*
    The beacon supply area (#263, and upstream #263's twin here).

    Nothing asserted either of these numbers before, which is why a beacon drew
    an 8x8 square and reported its modules over a 9x9 one shifted half a tile
    south and east - two different wrong answers to the same question, and both
    of them looked exactly like right ones.

    The prototype values below are the real ones out of
    `packages/exporter/data/output/data.json`, printed from that file rather than
    remembered. The expected areas are the game's own published figures: a
    beacon covers 9x9, a small pole 5x5, a medium 7x7, a big 4x4 and a
    substation 18x18.
*/

const pole = (name: string, supply_area_distance: number, box: number): ElectricPolePrototype =>
    ({
        type: 'electric-pole',
        name,
        supply_area_distance,
        collision_box: [
            [-box, -box],
            [box, box],
        ],
    }) as unknown as ElectricPolePrototype

const beacon = (supply_area_distance: number, box: number): BeaconPrototype =>
    ({
        type: 'beacon',
        name: 'beacon',
        supply_area_distance,
        collision_box: [
            [-box, -box],
            [box, box],
        ],
    }) as unknown as BeaconPrototype

/** data.json: supply_area_distance 3, collision box 2.4x2.4, so a 3x3 entity. */
const BEACON = beacon(3, 1.2)

/** data.json: 2.5 and a 0.3 box, so 1x1. */
const SMALL_POLE = pole('small-electric-pole', 2.5, 0.15)
/** data.json: 3.5 and a 0.3 box, so 1x1. */
const MEDIUM_POLE = pole('medium-electric-pole', 3.5, 0.15)
/** data.json: 2 and a 1.3 box, so 2x2. */
const BIG_POLE = pole('big-electric-pole', 2, 0.65)
/** data.json: 9 and a 1.4 box, so 2x2. */
const SUBSTATION = pole('substation', 9, 0.7)

/** A hypothetical even-sized beacon; no such prototype ships, but the formula must hold. */
const EVEN_BEACON = beacon(3, 1)

/**
 * An entity's centre, given the top-left tile it occupies and its size. An
 * odd-sized entity centres on a tile centre, an even-sized one on a tile corner.
 */
const centre = (leftTile: number, topTile: number, size: number): { x: number; y: number } => ({
    x: leftTile + size / 2,
    y: topTile + size / 2,
})

describe('supplyAreaHalfExtent', () => {
    /*
        The beacon is the one this fix is about. `supply_area_distance` is
        measured out from its footprint, so 3 tiles of beacon plus 3 either side
        is 9, and the half-extent from its centre is 4.5 - not the 4 the underlay
        drew.
    */
    it('reaches 4.5 tiles from the centre of a beacon, for a 9x9 area', () => {
        expect(supplyAreaHalfExtent(BEACON)).toBe(4.5)
        expect(supplyAreaHalfExtent(BEACON) * 2).toBe(9)
    })

    /*
        The pole's field means the other thing: it already IS the half-extent,
        and the pole's own size never enters. These four are the check that the
        beacon's formula must not be applied to a pole - it would give a small
        pole 6x6 and a big pole 6x6, where the game gives 5x5 and 4x4.
    */
    it('takes an electric pole distance as the half-extent, size and all', () => {
        expect(supplyAreaHalfExtent(SMALL_POLE) * 2).toBe(5)
        expect(supplyAreaHalfExtent(MEDIUM_POLE) * 2).toBe(7)
        expect(supplyAreaHalfExtent(BIG_POLE) * 2).toBe(4)
        expect(supplyAreaHalfExtent(SUBSTATION) * 2).toBe(18)
    })

    /*
        Odd and even differ only in where the centre sits, and the half-extent
        carries the size term either way: 3 + 2/2 = 4 for a 2x2 beacon, an 8x8
        area, which is 2 + 3 + 3.
    */
    it('carries the size term for an even-sized beacon too', () => {
        expect(supplyAreaHalfExtent(EVEN_BEACON)).toBe(4)
        expect(supplyAreaHalfExtent(EVEN_BEACON) * 2).toBe(8)
    })

    it('answers undefined for an entity that supplies nothing', () => {
        const assembler = {
            type: 'assembling-machine',
            name: 'assembling-machine-1',
        } as unknown as EntityWithOwnerPrototype
        expect(supplyAreaHalfExtent(assembler)).toBeUndefined()
    })
})

describe('supplyAreaBounds', () => {
    /*
        Tile spans, not just a number. A beacon on tiles 0..2 in both axes has
        its centre at (1.5, 1.5), and the area it supplies runs from tile -3 to
        tile 5 inclusive - left -3, right 6 as an exclusive edge.

        The old panel produced left -3 and right 6 from a centre of 1.5 too, but
        by padding a 1x1 rectangle pinned at (1.5, 1.5): left -2.5, right 6.5.
        Same width, half a tile out.
    */
    it('puts a beacon on tiles 0..2 over tiles -3..5', () => {
        const bounds = supplyAreaBounds(BEACON, centre(0, 0, 3))

        expect(bounds).toEqual({ left: -3, top: -3, right: 6, bottom: 6 })
    })

    it('keeps the beacon area centred as the beacon moves', () => {
        const bounds = supplyAreaBounds(BEACON, centre(10, 20, 3))

        expect(bounds).toEqual({ left: 7, top: 17, right: 16, bottom: 26 })
    })

    it('puts a small pole on tile 0,0 over tiles -2..2', () => {
        const bounds = supplyAreaBounds(SMALL_POLE, centre(0, 0, 1))

        expect(bounds).toEqual({ left: -2, top: -2, right: 3, bottom: 3 })
    })

    it('puts a substation on tiles 0..1 over tiles -8..9', () => {
        const bounds = supplyAreaBounds(SUBSTATION, centre(0, 0, 2))

        expect(bounds).toEqual({ left: -8, top: -8, right: 10, bottom: 10 })
    })

    /*
        The cheap cross-check on both formulas at once, and the reason to be
        confident they are not swapped. A supply area lines up with the tile
        grid, so every edge has to be a whole number - and it only is when each
        prototype gets its own rule. Give a 1x1 pole the beacon's formula and its
        edges land on x.5; give the 3x3 beacon the pole's and the same happens.
    */
    it('lands every real supplier on whole tile edges', () => {
        const cases: [ElectricPolePrototype | BeaconPrototype, number][] = [
            [BEACON, 3],
            [SMALL_POLE, 1],
            [MEDIUM_POLE, 1],
            [BIG_POLE, 2],
            [SUBSTATION, 2],
        ]

        for (const [proto, size] of cases) {
            const bounds = supplyAreaBounds(proto, centre(0, 0, size))
            for (const edge of [bounds.left, bounds.top, bounds.right, bounds.bottom]) {
                expect(Number.isInteger(edge)).toBe(true)
            }
        }
    })
})

describe('suppliesEntity', () => {
    /** A beacon on tiles 0..2, so covering tiles -3..5 in both axes. */
    const beaconCentre = centre(0, 0, 3)
    const oneByOne = { x: 1, y: 1 }

    /** A 1x1 entity sitting on the given tile. */
    const at = (tileX: number, tileY: number): { x: number; y: number } => centre(tileX, tileY, 1)

    it('reaches the last tile inside the area on every side', () => {
        expect(suppliesEntity(BEACON, beaconCentre, at(-3, 1), oneByOne)).toBe(true)
        expect(suppliesEntity(BEACON, beaconCentre, at(5, 1), oneByOne)).toBe(true)
        expect(suppliesEntity(BEACON, beaconCentre, at(1, -3), oneByOne)).toBe(true)
        expect(suppliesEntity(BEACON, beaconCentre, at(1, 5), oneByOne)).toBe(true)
    })

    /*
        One tile further out on each side. East and south are the two the panel
        got wrong: its aura sat half a tile that way, so tile 6 fell inside it
        and an entity a full tile outside the beacon's reach was credited with
        the beacon's modules. West and north it happened to get right, the half
        tile of slack there being smaller than a tile.

        They are asserted all four the same way because the west and north pair
        is what the old corner test would have got wrong the moment the aura was
        placed correctly: tile -4's east edge lands exactly on the aura's west
        edge, and `Rectangle.contains` counts that touch as containment.
    */
    it('stops one tile past the area on every side', () => {
        expect(suppliesEntity(BEACON, beaconCentre, at(-4, 1), oneByOne)).toBe(false)
        expect(suppliesEntity(BEACON, beaconCentre, at(6, 1), oneByOne)).toBe(false)
        expect(suppliesEntity(BEACON, beaconCentre, at(1, -4), oneByOne)).toBe(false)
        expect(suppliesEntity(BEACON, beaconCentre, at(1, 6), oneByOne)).toBe(false)
    })

    it('reaches a 3x3 assembler tucked into the area corner', () => {
        expect(suppliesEntity(BEACON, beaconCentre, centre(3, 3, 3), { x: 3, y: 3 })).toBe(true)
        expect(suppliesEntity(BEACON, beaconCentre, centre(6, 6, 3), { x: 3, y: 3 })).toBe(false)
    })

    /*
        The case four corners cannot see: a long entity crossing the area with
        every corner of its own outside it. Nothing this shape supplies modules
        today, so this pins the predicate rather than a bug anyone has hit.
    */
    it('reaches an entity long enough to cross the area with its corners outside', () => {
        // Tile column 1, tile rows -7..12: every corner is outside the aura's
        // -3..5, but the middle of it runs straight through.
        const long = { x: 1, y: 20 }
        expect(suppliesEntity(BEACON, beaconCentre, { x: 1.5, y: 3 }, long)).toBe(true)
    })

    it('answers false for a supplier with no supply area', () => {
        const assembler = {
            type: 'assembling-machine',
            name: 'assembling-machine-1',
        } as unknown as EntityWithOwnerPrototype
        expect(suppliesEntity(assembler, beaconCentre, at(0, 0), oneByOne)).toBe(false)
    })
})
