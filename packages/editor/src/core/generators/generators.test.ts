import { describe, it, expect } from 'vite-plus/test'
import { IPoint } from '../../types'
import { generatePipes, pipeGridTooLarge } from './pipe'
import { generateBeacons } from './beacon'
import { generatePoles } from './pole'
import EXPECTED from './__fixtures__/expected-output.json'

/*
    Characterization tests for the oil outpost generators.

    These do not assert that the generated layouts are *good* - nobody has written
    down what "good" means for these algorithms. They assert that the output does
    not change, which is what makes the generators safe to refactor. The fixture in
    __fixtures__/expected-output.json was captured from the generators before the
    strictNullChecks cleanup (issue #22) and must be treated as a fixed point: a
    diff here means a refactor changed behaviour, not that the fixture is stale.

    Regenerating it is only correct when a change to the algorithms is intended, and
    the new output should be reviewed as a layout change rather than accepted blind.

    All three generators run in sequence because that is how Blueprint.generatePipes
    calls them - beacons are placed around the pumpjacks and pipes, and poles around
    all three. Chaining them means a pipe-stage regression also shows up downstream.
*/

const LAYOUTS: Record<string, { entity_number: number; position: IPoint }[]> = {
    // two pumpjacks in a straight line: the simplest group, no group merging
    pair: [
        { entity_number: 1, position: { x: 1.5, y: 1.5 } },
        { entity_number: 2, position: { x: 10.5, y: 1.5 } },
    ],
    // three collinear pumpjacks: exercises the collinear branch of pointsToLines
    row: [
        { entity_number: 1, position: { x: 1.5, y: 1.5 } },
        { entity_number: 2, position: { x: 8.5, y: 1.5 } },
        { entity_number: 3, position: { x: 15.5, y: 1.5 } },
    ],
    // no two pumpjacks share an axis, so lines are sparse and the generator has to
    // fall back on pathfinding, group merging and the leftover-pumpjack pass
    scattered: [
        { entity_number: 1, position: { x: 2.5, y: 2.5 } },
        { entity_number: 2, position: { x: 12.5, y: 3.5 } },
        { entity_number: 3, position: { x: 7.5, y: 13.5 } },
        { entity_number: 4, position: { x: 20.5, y: 11.5 } },
        { entity_number: 5, position: { x: 18.5, y: 22.5 } },
    ],
    // aligned on both axes plus two outliers: many candidate lines to sort between,
    // and multiple groups that have to be connected to each other
    grid: [
        { entity_number: 1, position: { x: 2.5, y: 2.5 } },
        { entity_number: 2, position: { x: 11.5, y: 2.5 } },
        { entity_number: 3, position: { x: 2.5, y: 11.5 } },
        { entity_number: 4, position: { x: 11.5, y: 11.5 } },
        { entity_number: 5, position: { x: 20.5, y: 6.5 } },
        { entity_number: 6, position: { x: 6.5, y: 20.5 } },
    ],
}

function runGenerators(pumpjacks: { entity_number: number; position: IPoint }[]): unknown {
    const pipes = generatePipes(pumpjacks, 1)

    const entitiesForBeaconGen = [
        ...pumpjacks.map(p => ({ ...p, name: 'pumpjack', size: 3, effect: true })),
        ...pipes.pipes.map(p => ({ ...p, size: 1, effect: false })),
    ]
    const beacons = generateBeacons(entitiesForBeaconGen, 1)

    const entitiesForPoleGen = [
        ...pumpjacks.map(p => ({ ...p, name: 'pumpjack', size: 3, power: true })),
        ...pipes.pipes.map(p => ({ ...p, size: 1, power: false })),
        ...beacons.beacons.map(p => ({ ...p, size: 3, power: true })),
    ]
    const poles = generatePoles(entitiesForPoleGen)

    // visualizations are debug overlays, not output - left out so cosmetic changes
    // to them do not fail the test
    return {
        pipes: {
            pumpjacksToRotate: pipes.pumpjacksToRotate,
            pipes: pipes.pipes,
            info: pipes.info,
        },
        beacons: { beacons: beacons.beacons, info: beacons.info },
        poles: { poles: poles.poles, info: poles.info },
    }
}

describe('oil outpost generators', () => {
    for (const [name, pumpjacks] of Object.entries(LAYOUTS)) {
        it(`produces unchanged output for the "${name}" layout`, () => {
            // compared through JSON so key order is part of the contract and
            // undefined-vs-missing properties cannot slip through unnoticed
            const actual = JSON.parse(JSON.stringify(runGenerators(pumpjacks)))
            expect(actual).toEqual((EXPECTED as Record<string, unknown>)[name])
        })
    }

    it('covers every layout in the fixture', () => {
        expect(Object.keys(LAYOUTS).sort()).toEqual(Object.keys(EXPECTED).sort())
    })

    it('is deterministic across repeated runs', () => {
        const first = JSON.stringify(runGenerators(LAYOUTS.scattered))
        const second = JSON.stringify(runGenerators(LAYOUTS.scattered))
        expect(second).toBe(first)
    })
})

/*
    The grid size limit (GHSA-9w8p-4q25-qv54). A pumpjack at tile (x, y) covers
    x - 1 to x + 1, and the grid adds a 2-tile margin on every side, so two
    pumpjacks D tiles apart span a grid of D + 7 tiles on that axis.
*/
describe('pipe grid size limit', () => {
    const at = (n: number, x: number, y: number) => ({
        entity_number: n,
        position: { x: x + 0.5, y: y + 0.5 },
    })

    it('accepts every characterization layout', () => {
        for (const pumpjacks of Object.values(LAYOUTS)) {
            expect(pipeGridTooLarge(pumpjacks)).toBeUndefined()
        }
    })

    it('accepts a 500 x 500 grid and refuses 501 x 501, the area limit', () => {
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 493, 493)])).toBeUndefined()
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 494, 494)])).toBe(
            'The pumpjacks are too far apart! The pipe grid would be 501 x 501 tiles; ' +
                'it can be at most 1000 x 1000 and 250,000 tiles in area.'
        )
    })

    it('accepts a row 1000 wide and refuses 1001, the side limit', () => {
        // 7 tall, so the area stays far under its limit and only the side can refuse it
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 993, 0)])).toBeUndefined()
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 994, 0)])).toContain('1001 x 7')
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 0, 994)])).toContain('7 x 1001')
    })

    it('refuses positions that are not finite numbers', () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            expect(pipeGridTooLarge([at(1, 0, 0), at(2, bad, 0)])).toContain('unbounded')
        }
        // finite, so the message can still give the size
        expect(pipeGridTooLarge([at(1, 0, 0), at(2, 1e300, 0)])).toContain('1e+300 x 7')
    })

    it('makes generatePipes throw before it builds the grid', () => {
        /*
            A row just past the side limit, chosen because without the guard it
            plans in milliseconds: removing the guard fails this test rather
            than hanging or crashing the run.
        */
        expect(() => generatePipes([at(1, 0, 0), at(2, 994, 0)], 1)).toThrow('1001 x 7')
    })
})
