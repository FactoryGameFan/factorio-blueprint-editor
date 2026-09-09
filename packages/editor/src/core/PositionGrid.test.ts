import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { IPoint } from '../types'
import { Blueprint } from './Blueprint'
import { loadData } from './factorioData'

/*
    Underground pairing: PositionGrid.getOpposingEntity, the one lookup that
    decides whether two undergrounds are partners.

    Nothing tested it, and that is how #329 4.1 survived. The method carried
    Factorio 1.1's 8-way direction arithmetic:

        const horizontal = searchDirection % 4 !== 0
        const sign = searchDirection === 0 || searchDirection === 6 ? -1 : 1

    Our directions are 16-way (north 0, east 4, south 8, west 12), so every
    cardinal is a multiple of 4 and `horizontal` was false for all of them - an
    east or west underground searched up and down the Y axis and could never
    find its partner. 6 is not a direction in the 16-way scheme either, so west
    walked towards +X. Only north and south still worked, north because its
    sign was in the special case and south because +1 was already right.

    The last two lines of the same method were already 16-way
    ((direction + 8) % 16), which is what made this a half-finished migration
    rather than an obviously stale file.

    These run under vitest rather than Playwright because the lookup is pure
    grid arithmetic - it reads entity numbers out of a Map and never touches a
    sprite - so a fake dataset with the four prototypes is enough.
*/

// the real values out of data.json, so the boundary cases below are the game's
const MAX_DISTANCE = {
    'underground-belt': 5,
    'fast-underground-belt': 7,
    'express-underground-belt': 9,
    'turbo-underground-belt': 11,
}

const beltPrototype = (name: string, max_distance: number): unknown => ({
    type: 'underground-belt',
    name,
    max_distance,
    collision_box: [
        [-0.4, -0.4],
        [0.4, 0.4],
    ],
})

beforeAll(() => {
    // loadData permanently replaces FD's accessors; vitest's per-file module
    // isolation keeps this synthetic dataset out of the other test files.
    loadData(
        JSON.stringify({
            items: {},
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'underground-belt': beltPrototype('underground-belt', 5),
                'fast-underground-belt': beltPrototype('fast-underground-belt', 7),
                'express-underground-belt': beltPrototype('express-underground-belt', 9),
                'turbo-underground-belt': beltPrototype('turbo-underground-belt', 11),
                /*
                    pipe-to-ground has no max_distance of its own - the overlay
                    passes 10 for it - but it reaches the same lookup, so the
                    fix covers it and so do the cases below. Loaders reach it
                    too, from Entity.rotate, which passes undefined for anything
                    that is not an underground belt; that is the no-reach case.
                */
                'pipe-to-ground': {
                    type: 'pipe-to-ground',
                    name: 'pipe-to-ground',
                    collision_box: [
                        [-0.29, -0.29],
                        [0.29, 0.2],
                    ],
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: {},
        })
    )
})

interface Placement {
    name: string
    /** tile centre, the form a real blueprint stores a 1x1 entity at */
    x: number
    y: number
    direction: number
    directionType?: 'input' | 'output'
}

/**
 * A blueprint of 1x1 entities, numbered from 1 in the order given.
 *
 * The constructor recentres everything it is handed, so the positions that come
 * back are not the ones passed in - only the offsets between them survive.
 * Every case below therefore searches from `positionOf(bp, 1)` rather than from
 * a literal.
 */
const blueprintOf = (...placements: Placement[]): Blueprint =>
    new Blueprint({
        entities: placements.map((p, i) => ({
            entity_number: i + 1,
            name: p.name,
            position: { x: p.x, y: p.y },
            direction: p.direction,
            type: p.directionType,
        })),
    })

const positionOf = (bp: Blueprint, entityNumber: number): IPoint => {
    const entity = bp.entities.get(entityNumber)
    if (entity === undefined) throw new Error(`no entity ${entityNumber} in this blueprint`)
    return entity.position
}

const NORTH = 0
const EAST = 4
const SOUTH = 8
const WEST = 12

describe('getOpposingEntity pairs along all four cardinals', () => {
    /*
        One input and one output of the same name, facing the same way, four
        tiles apart. Both halves of a real pair are asked here: the input looks
        forwards along its own direction, and the output looks backwards, which
        is the (direction + 8) % 16 its callers pass.

        Before the fix, east and west answered undefined in both halves.
    */
    const cases = [
        { dir: NORTH, name: 'north', dx: 0, dy: -4 },
        { dir: EAST, name: 'east', dx: 4, dy: 0 },
        { dir: SOUTH, name: 'south', dx: 0, dy: 4 },
        { dir: WEST, name: 'west', dx: -4, dy: 0 },
    ]

    for (const { dir, name, dx, dy } of cases) {
        it(`finds the output of an input facing ${name}`, () => {
            const bp = blueprintOf(
                {
                    name: 'underground-belt',
                    x: 0.5,
                    y: 0.5,
                    direction: dir,
                    directionType: 'input',
                },
                {
                    name: 'underground-belt',
                    x: 0.5 + dx,
                    y: 0.5 + dy,
                    direction: dir,
                    directionType: 'output',
                }
            )

            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    dir,
                    positionOf(bp, 1),
                    dir,
                    MAX_DISTANCE['underground-belt']
                )
            ).toBe(2)
        })

        it(`finds the input of an output facing ${name}`, () => {
            const bp = blueprintOf(
                {
                    name: 'underground-belt',
                    x: 0.5,
                    y: 0.5,
                    direction: dir,
                    directionType: 'output',
                },
                {
                    name: 'underground-belt',
                    x: 0.5 - dx,
                    y: 0.5 - dy,
                    direction: dir,
                    directionType: 'input',
                }
            )

            // an output searches backwards, which is what Entity.rotate and the
            // overlay both pass as searchDirection
            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    dir,
                    positionOf(bp, 1),
                    (dir + 8) % 16,
                    MAX_DISTANCE['underground-belt']
                )
            ).toBe(2)
        })
    }

    it('does not find a partner that sits on the other axis', () => {
        // the shape of the old bug: an east-west pair, searched along Y
        const bp = blueprintOf(
            { name: 'underground-belt', x: 0.5, y: 0.5, direction: EAST, directionType: 'input' },
            { name: 'underground-belt', x: 0.5, y: 4.5, direction: EAST, directionType: 'output' }
        )

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                EAST,
                positionOf(bp, 1),
                EAST,
                MAX_DISTANCE['underground-belt']
            )
        ).toBeUndefined()
    })
})

describe('getOpposingEntity reach', () => {
    const pairAtDistance = (
        name: string,
        distance: number,
        maxDistance: number | undefined
    ): number | undefined => {
        const bp = blueprintOf(
            { name, x: 0.5, y: 0.5, direction: EAST, directionType: 'input' },
            { name, x: 0.5 + distance, y: 0.5, direction: EAST, directionType: 'output' }
        )
        return bp.entityPositionGrid.getOpposingEntity(
            name,
            EAST,
            positionOf(bp, 1),
            EAST,
            maxDistance
        )
    }

    /*
        The loop runs i = 1..maxDistance inclusive, so max_distance is the
        largest gap in tiles between the two entities themselves - 5 for the
        basic belt, and 7, 9 and 11 for the three faster ones.
    */
    for (const [name, max] of Object.entries(MAX_DISTANCE)) {
        it(`${name} pairs at exactly ${max} tiles and not at ${max + 1}`, () => {
            expect(pairAtDistance(name, max, max)).toBe(2)
            expect(pairAtDistance(name, max + 1, max)).toBeUndefined()
        })
    }

    it('answers undefined when there is no reach to search along', () => {
        /*
            The loader path. Entity.rotate reads max_distance off the prototype
            and only an underground belt has one, so a loader asks with
            undefined and the search never runs. A loader pair is therefore
            still not modelled - the fix does not change that, and this pins it
            so a later change to loaders has to say so.
        */
        expect(pairAtDistance('underground-belt', 2, undefined)).toBeUndefined()
    })

    it('answers undefined for a diagonal search direction', () => {
        // unreachable through the UI - getPossibleRotations gives these
        // entities [0, 4, 8, 12] - but a blueprint file can hold one, and it
        // must cost no more than this one connection
        const bp = blueprintOf(
            { name: 'underground-belt', x: 0.5, y: 0.5, direction: 2, directionType: 'input' },
            { name: 'underground-belt', x: 4.5, y: 0.5, direction: 2, directionType: 'output' }
        )

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                2,
                positionOf(bp, 1),
                2,
                MAX_DISTANCE['underground-belt']
            )
        ).toBeUndefined()
    })
})

describe('getOpposingEntity blocking and mismatches', () => {
    it('is blocked by a belt of the same name facing the other way', () => {
        // Factorio's own rule: an underground of the same tier pointing back at
        // you, between the two ends, breaks the connection
        const bp = blueprintOf(
            { name: 'underground-belt', x: 0.5, y: 0.5, direction: EAST, directionType: 'input' },
            { name: 'underground-belt', x: 2.5, y: 0.5, direction: WEST, directionType: 'input' },
            { name: 'underground-belt', x: 4.5, y: 0.5, direction: EAST, directionType: 'output' }
        )

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                EAST,
                positionOf(bp, 1),
                EAST,
                MAX_DISTANCE['underground-belt']
            )
        ).toBeUndefined()
    })

    it('walks past a belt of a different tier', () => {
        const bp = blueprintOf(
            { name: 'underground-belt', x: 0.5, y: 0.5, direction: EAST, directionType: 'input' },
            {
                name: 'fast-underground-belt',
                x: 2.5,
                y: 0.5,
                direction: WEST,
                directionType: 'input',
            },
            { name: 'underground-belt', x: 4.5, y: 0.5, direction: EAST, directionType: 'output' }
        )

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                EAST,
                positionOf(bp, 1),
                EAST,
                MAX_DISTANCE['underground-belt']
            )
        ).toBe(3)
    })

    it('answers undefined when nothing of that name is in reach', () => {
        const bp = blueprintOf({
            name: 'underground-belt',
            x: 0.5,
            y: 0.5,
            direction: EAST,
            directionType: 'input',
        })

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                EAST,
                positionOf(bp, 1),
                EAST,
                MAX_DISTANCE['underground-belt']
            )
        ).toBeUndefined()
    })
})

describe('getOpposingEntity for pipes to ground', () => {
    /*
        The same method under a different convention. A pipe-to-ground stores no
        directionType, so its search direction is always (direction + 8) % 16,
        and the overlay asks for a partner facing that same way - two pipes
        whose undergrounds run towards each other. The reach is the overlay's
        fixed 10, because the prototype carries no max_distance.
    */
    const findPipe = (bp: Blueprint, direction: number): number | undefined =>
        bp.entityPositionGrid.getOpposingEntity(
            'pipe-to-ground',
            (direction + 8) % 16,
            positionOf(bp, 1),
            (direction + 8) % 16,
            10
        )

    it('pairs an east-facing pipe with the west-facing one behind it', () => {
        const bp = blueprintOf(
            { name: 'pipe-to-ground', x: 0.5, y: 0.5, direction: EAST },
            { name: 'pipe-to-ground', x: -5.5, y: 0.5, direction: WEST }
        )

        expect(findPipe(bp, EAST)).toBe(2)
    })

    it('pairs a north-facing pipe with the south-facing one below it', () => {
        const bp = blueprintOf(
            { name: 'pipe-to-ground', x: 0.5, y: 0.5, direction: NORTH },
            { name: 'pipe-to-ground', x: 0.5, y: 5.5, direction: SOUTH }
        )

        expect(findPipe(bp, NORTH)).toBe(2)
    })

    it('does not pair two pipes whose undergrounds run the same way', () => {
        const bp = blueprintOf(
            { name: 'pipe-to-ground', x: 0.5, y: 0.5, direction: EAST },
            { name: 'pipe-to-ground', x: -5.5, y: 0.5, direction: EAST }
        )

        expect(findPipe(bp, EAST)).toBeUndefined()
    })
})

describe('Entity.undergroundSearchDirection', () => {
    /*
        The direction the hidden connection runs in, which four call sites used
        to spell out. One of them, the overlay's "not a pair" guard, spelled it
        `direction + (8 % 16)` - a misplaced bracket that reads as
        `direction + 8`. That agrees with the real answer only below 8, so a
        south-facing output gave 16 and a west-facing one 20 (#329).
    */
    const entityAt = (direction: number, directionType?: 'input' | 'output') =>
        blueprintOf({
            name: 'underground-belt',
            x: 0.5,
            y: 0.5,
            direction,
            directionType,
        }).entities.get(1)

    it('is the entity direction for an input', () => {
        for (const dir of [NORTH, EAST, SOUTH, WEST]) {
            expect(entityAt(dir, 'input')?.undergroundSearchDirection).toBe(dir)
        }
    })

    it('wraps to the opposite direction for an output', () => {
        expect(entityAt(NORTH, 'output')?.undergroundSearchDirection).toBe(SOUTH)
        expect(entityAt(EAST, 'output')?.undergroundSearchDirection).toBe(WEST)
        // the two the misplaced bracket got wrong: 16 and 20 rather than 0 and 4
        expect(entityAt(SOUTH, 'output')?.undergroundSearchDirection).toBe(NORTH)
        expect(entityAt(WEST, 'output')?.undergroundSearchDirection).toBe(EAST)
    })

    it('takes the output form when there is no direction type', () => {
        // pipe-to-ground stores none, and every caller already treated it so
        expect(entityAt(SOUTH)?.undergroundSearchDirection).toBe(NORTH)
    })
})
