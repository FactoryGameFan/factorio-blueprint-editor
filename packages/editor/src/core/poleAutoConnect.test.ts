import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { loadData } from './factorioData'
import { IConnection } from './WireConnections'

/*
    Electric poles auto-wiring to the poles already on the map (issue #343).

    A pole placed by hand wired itself to its neighbours; a pole that arrived by
    paste did not. The fix is one routine for both, `autoConnectPoles`, and the
    rule it follows was measured on Factorio 2.0.77 headless by
    `tools/oracle/probe-pole-autoconnect.mjs`, whose capture is
    `tools/oracle/fixtures/pole-autoconnect.json`. Each case below is one probe
    row: the poles and wires that were on the map, the poles and wires the
    blueprint carried, and as the expected answer the copper wires the game
    reported once the paste was built. The expected strings are copied from the
    fixture's `revived` lists, in its own format - R(x,y) per pole, pairs sorted
    as strings - so a row can be checked against it by eye. They are copied
    rather than read because nothing under src/ may depend on tools/oracle.

    Positions are the probe's, relative to each case's origin. Every pole is a
    `medium-electric-pole`, reach 9, as in the probe.

    `bp-pole-with-3-wires-plus-4-existing` is left out on purpose: it is decided
    by four candidates at the same distance, and the order the game takes a tie
    in is unmeasured. `fan-out-7-chain-connected` has a tie too, but only for its
    last wire, so it is kept with that one wire asserted loosely.
    `control-create-entity` and `euclid-vs-manhattan-create` are the hand
    placement half, run below from `lone-near-existing` and `euclid-vs-manhattan`.
*/

const POLE = 'medium-electric-pole'

/** The 2.0 connector id for a pole's copper wire, as `createBpConnections` maps it. */
const POLE_COPPER = 5

const point = { red: [0.1, 0.1], green: [0.2, 0.2], copper: [0, 0] }
const fourWays = [0, 1, 2, 3].map(() => ({ wire: point, shadow: point }))

beforeAll(() => {
    // loadData permanently replaces FD's accessors. Vitest's per-file module
    // isolation keeps this synthetic dataset from leaking into other test files.
    loadData(
        JSON.stringify({
            items: { [POLE]: { name: POLE, place_result: POLE } },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                // The fields that matter copied from data.json: the reach, and a
                // collision box that keeps it a 1x1 entity. The connection points
                // only have to exist - the Blueprint constructor drops a wire to
                // an entity with none (#488), and the paste below goes through it.
                [POLE]: {
                    type: 'electric-pole',
                    name: POLE,
                    maximum_wire_distance: 9,
                    collision_box: [
                        [-0.15, -0.15],
                        [0.15, 0.15],
                    ],
                    connection_points: fourWays,
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: { wire_connector_id: { pole_copper: POLE_COPPER } },
        })
    )
})

type XY = readonly [number, number]
/** Indexes into the list of poles it sits beside. */
type Pair = readonly [number, number]

interface Case {
    name: string
    /** Poles already on the map, and the copper wires between them. */
    map?: XY[]
    mapWires?: Pair[]
    /** Poles the blueprint builds, where they land, and the blueprint's own wires. */
    paste: XY[]
    pasteWires?: Pair[]
    /** The game's copper wires after the build, in the probe's format. */
    expected: string[]
}

const copper = (a: number, b: number): IConnection => ({
    color: 'copper',
    cps: [
        { entityNumber: a, entitySide: 1 },
        { entityNumber: b, entitySide: 1 },
    ],
})

/** A map holding `map`'s poles, joined only by `mapWires`. */
function buildMap(c: Pick<Case, 'map' | 'mapWires'>): { bp: Blueprint; mapNumbers: number[] } {
    const bp = new Blueprint()
    const mapNumbers = (c.map ?? []).map(
        ([x, y]) => bp.createEntity({ name: POLE, position: { x, y } }).entityNumber
    )
    for (const [a, b] of c.mapWires ?? []) {
        bp.wireConnections.create(copper(mapNumbers[a], mapNumbers[b]))
    }
    return { bp, mapNumbers }
}

/**
 * Pastes the way `PaintBlueprintContainer.placeEntityContainer` does: the
 * selection is its own Blueprint, every entity is created on the map inside one
 * transaction, and the same `wirePastedEntities` call then copies its wires and
 * auto-wires. Only the placement planning, which is about collisions and not
 * wires, is skipped. Answers the new entity numbers.
 */
function paste(bp: Blueprint, c: Pick<Case, 'paste' | 'pasteWires'>): number[] {
    const source = new Blueprint({
        entities: c.paste.map(([x, y], i) => ({
            entity_number: i + 1,
            name: POLE,
            position: { x, y },
        })),
        wires: (c.pasteWires ?? []).map(([a, b]) => [a + 1, POLE_COPPER, b + 1, POLE_COPPER]),
    })
    return bp.history.transaction('Create Entities', () => {
        const oldEntIDToNewEntID = new Map<number, number>()
        c.paste.forEach(([x, y], i) => {
            const e = bp.createEntity({ name: POLE, position: { x, y } })
            oldEntIDToNewEntID.set(i + 1, e.entityNumber)
        })
        bp.wireConnections.wirePastedEntities(source.wireConnections, oldEntIDToNewEntID)
        return [...oldEntIDToNewEntID.values()]
    })
}

/** Every copper wire on the map, formatted and sorted the way the probe prints them. */
function copperWires(bp: Blueprint): string[] {
    const at = (n: number): string => {
        const e = bp.entities.get(n)
        if (e === undefined) throw new Error(`wire to missing entity ${n}`)
        return `R(${e.position.x},${e.position.y})`
    }
    const wires: string[] = []
    bp.wireConnections.forEach(conn => {
        if (conn.color !== 'copper') return
        const a = at(conn.cps[0].entityNumber)
        const b = at(conn.cps[1].entityNumber)
        wires.push(a < b ? `${a}-${b}` : `${b}-${a}`)
    })
    return wires.sort()
}

/** A probe line such as `R(0.5,0.5)-R(5.5,0.5)  R(...)-R(...)`, split into wires. */
const wires = (line: string): string[] => line.split(/\s+/).filter(w => w !== '')

// ring(7, 4) from the probe, in its order, as pole centres
const RING_7: XY[] = [
    [4.5, 0.5],
    [2.5, 3.5],
    [-0.5, 4.5],
    [-3.5, 2.5],
    [-3.5, -1.5],
    [-0.5, -3.5],
    [2.5, -2.5],
]

// The chain in fan-out-7-chain-connected: ring pole i wired to ring pole i + 1
const CHAIN_RING: Pair[] = [0, 1, 2, 3, 4, 5].map(i => [i, i + 1] as const)
const CHAIN_RING_WIRES = wires(
    'R(-0.5,-3.5)-R(-3.5,-1.5)  R(-0.5,-3.5)-R(2.5,-2.5)  R(-0.5,4.5)-R(-3.5,2.5)  R(-0.5,4.5)-R(2.5,3.5)  R(-3.5,-1.5)-R(-3.5,2.5)  R(2.5,3.5)-R(4.5,0.5)'
)

// A map pole holding 4 wires to poles far out of a new pole's reach
const HUB_WITH_4: Pick<Case, 'map' | 'mapWires'> = {
    map: [
        [0.5, 0.5],
        [-7.5, 0.5],
        [-5.5, -5.5],
        [-5.5, 6.5],
        [0.5, -7.5],
    ],
    mapWires: [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
    ],
}

const CHAIN_OF_4: Pair[] = [
    [0, 1],
    [1, 2],
    [2, 3],
]

const CASES: Case[] = [
    {
        name: 'lone-near-existing',
        map: [[0.5, 0.5]],
        paste: [[5.5, 0.5]],
        expected: wires('R(0.5,0.5)-R(5.5,0.5)'),
    },
    {
        name: 'lone-out-of-reach',
        map: [[0.5, 0.5]],
        paste: [[20.5, 0.5]],
        expected: [],
    },
    {
        name: 'bp-unwired-pair-alone',
        paste: [
            [-1.5, 0.5],
            [2.5, 0.5],
        ],
        expected: [],
    },
    {
        name: 'bp-wired-pair-alone',
        paste: [
            [-1.5, 0.5],
            [2.5, 0.5],
        ],
        pasteWires: [[0, 1]],
        expected: wires('R(-1.5,0.5)-R(2.5,0.5)'),
    },
    {
        name: 'bp-wired-pair-both-in-reach-of-existing',
        map: [[0.5, 0.5]],
        paste: [
            [3.5, 0.5],
            [7.5, 0.5],
        ],
        pasteWires: [[0, 1]],
        expected: wires('R(0.5,0.5)-R(3.5,0.5)  R(3.5,0.5)-R(7.5,0.5)'),
    },
    {
        name: 'bp-unwired-pair-both-in-reach-of-existing',
        map: [[0.5, 0.5]],
        paste: [
            [3.5, 0.5],
            [7.5, 0.5],
        ],
        expected: wires('R(0.5,0.5)-R(3.5,0.5)  R(0.5,0.5)-R(7.5,0.5)'),
    },
    {
        name: 'bp-wired-pair-one-in-reach',
        map: [[0.5, 0.5]],
        paste: [
            [5.5, 0.5],
            [11.5, 0.5],
        ],
        pasteWires: [[0, 1]],
        expected: wires('R(0.5,0.5)-R(5.5,0.5)  R(11.5,0.5)-R(5.5,0.5)'),
    },
    {
        name: 'bp-order-AB-unwired-existing-between',
        map: [[4.5, 3.5]],
        paste: [
            [0.5, 0.5],
            [8.5, 0.5],
        ],
        expected: wires('R(0.5,0.5)-R(4.5,3.5)  R(4.5,3.5)-R(8.5,0.5)'),
    },
    {
        name: 'fan-out-7-unconnected',
        map: RING_7,
        paste: [[0.5, 0.5]],
        expected: wires(
            'R(-0.5,-3.5)-R(0.5,0.5)  R(-0.5,4.5)-R(0.5,0.5)  R(0.5,0.5)-R(2.5,-2.5)  R(0.5,0.5)-R(2.5,3.5)  R(0.5,0.5)-R(4.5,0.5)'
        ),
    },
    {
        name: 'fan-out-7-all-to-one-hub-far',
        // Seven poles in one network through a hub out of the new pole's reach.
        // The triangle check looks at direct neighbours only, so all five wire.
        map: [...RING_7, [0.5, 12.5]],
        mapWires: [0, 1, 2, 3, 4, 5, 6].map(i => [i, 7] as const),
        paste: [[0.5, 0.5]],
        expected: wires(
            'R(-0.5,-3.5)-R(0.5,0.5)  R(-0.5,-3.5)-R(0.5,12.5)  R(-0.5,4.5)-R(0.5,0.5)  R(-0.5,4.5)-R(0.5,12.5)  R(-3.5,-1.5)-R(0.5,12.5)  R(-3.5,2.5)-R(0.5,12.5)  R(0.5,0.5)-R(2.5,-2.5)  R(0.5,0.5)-R(2.5,3.5)  R(0.5,0.5)-R(4.5,0.5)  R(0.5,12.5)-R(2.5,-2.5)  R(0.5,12.5)-R(2.5,3.5)  R(0.5,12.5)-R(4.5,0.5)'
        ),
    },
    {
        name: 'target-already-has-5',
        map: [...(HUB_WITH_4.map ?? []), [0.5, 8.5]],
        mapWires: [...(HUB_WITH_4.mapWires ?? []), [0, 5]],
        paste: [[8.5, 0.5]],
        expected: wires(
            'R(-5.5,-5.5)-R(0.5,0.5)  R(-5.5,6.5)-R(0.5,0.5)  R(-7.5,0.5)-R(0.5,0.5)  R(0.5,-7.5)-R(0.5,0.5)  R(0.5,0.5)-R(0.5,8.5)'
        ),
    },
    {
        name: 'target-has-4-control',
        ...HUB_WITH_4,
        paste: [[8.5, 0.5]],
        expected: wires(
            'R(-5.5,-5.5)-R(0.5,0.5)  R(-5.5,6.5)-R(0.5,0.5)  R(-7.5,0.5)-R(0.5,0.5)  R(0.5,-7.5)-R(0.5,0.5)  R(0.5,0.5)-R(8.5,0.5)'
        ),
    },
    {
        name: 'target-has-4-two-unwired-pasted',
        // The cap is read live: the nearer pasted pole takes the hub's fifth
        // wire, and the farther one, also in reach, gets none.
        ...HUB_WITH_4,
        paste: [
            [5.5, 0.5],
            [5.5, 6.5],
        ],
        expected: wires(
            'R(-5.5,-5.5)-R(0.5,0.5)  R(-5.5,6.5)-R(0.5,0.5)  R(-7.5,0.5)-R(0.5,0.5)  R(0.5,-7.5)-R(0.5,0.5)  R(0.5,0.5)-R(5.5,0.5)'
        ),
    },
    {
        name: 'cap-0-bp-wires-4-existing',
        map: [
            [2.5, -1.5],
            [2.5, 2.5],
            [3.5, 0.5],
            [3.5, -2.5],
        ],
        paste: [[0.5, 0.5]],
        expected: wires(
            'R(0.5,0.5)-R(2.5,-1.5)  R(0.5,0.5)-R(2.5,2.5)  R(0.5,0.5)-R(3.5,-2.5)  R(0.5,0.5)-R(3.5,0.5)'
        ),
    },
    {
        name: 'cap-3-bp-wires-4-existing',
        // The same four map poles, but the pasted pole brings 3 wires of its
        // own, so it takes 2 more: 3 + 2 = 5.
        map: [
            [6.5, -1.5],
            [6.5, 2.5],
            [7.5, 0.5],
            [7.5, -2.5],
        ],
        paste: [
            [4.5, 0.5],
            [-3.5, 0.5],
            [-3.5, -1.5],
            [-3.5, 2.5],
        ],
        pasteWires: [
            [0, 1],
            [0, 2],
            [0, 3],
        ],
        expected: wires(
            'R(-3.5,-1.5)-R(4.5,0.5)  R(-3.5,0.5)-R(4.5,0.5)  R(-3.5,2.5)-R(4.5,0.5)  R(4.5,0.5)-R(6.5,-1.5)  R(4.5,0.5)-R(6.5,2.5)'
        ),
    },
    {
        name: 'bp-wired-chain-of-4-all-in-reach-of-existing',
        map: [[0.5, 0.5]],
        paste: [
            [1.5, 3.5],
            [3.5, 3.5],
            [5.5, 3.5],
            [7.5, 3.5],
        ],
        pasteWires: CHAIN_OF_4,
        expected: wires(
            'R(0.5,0.5)-R(1.5,3.5)  R(0.5,0.5)-R(5.5,3.5)  R(1.5,3.5)-R(3.5,3.5)  R(3.5,3.5)-R(5.5,3.5)  R(5.5,3.5)-R(7.5,3.5)'
        ),
    },
    {
        name: 'bp-wired-chain-of-4-REVERSED-numbering',
        map: [[0.5, 0.5]],
        paste: [
            [7.5, 3.5],
            [5.5, 3.5],
            [3.5, 3.5],
            [1.5, 3.5],
        ],
        pasteWires: CHAIN_OF_4,
        expected: wires(
            'R(0.5,0.5)-R(1.5,3.5)  R(0.5,0.5)-R(5.5,3.5)  R(1.5,3.5)-R(3.5,3.5)  R(3.5,3.5)-R(5.5,3.5)  R(5.5,3.5)-R(7.5,3.5)'
        ),
    },
    {
        name: 'chain-E-east-numbered-west-to-east',
        map: [[5.5, -2.5]],
        paste: [
            [-2.5, 0.5],
            [-0.5, 0.5],
            [1.5, 0.5],
            [3.5, 0.5],
        ],
        pasteWires: CHAIN_OF_4,
        expected: wires(
            'R(-0.5,0.5)-R(-2.5,0.5)  R(-0.5,0.5)-R(1.5,0.5)  R(-0.5,0.5)-R(5.5,-2.5)  R(1.5,0.5)-R(3.5,0.5)  R(3.5,0.5)-R(5.5,-2.5)'
        ),
    },
    {
        name: 'chain-E-east-numbered-east-to-west',
        map: [[-2.5, -2.5]],
        paste: [
            [3.5, 0.5],
            [1.5, 0.5],
            [-0.5, 0.5],
            [-2.5, 0.5],
        ],
        pasteWires: CHAIN_OF_4,
        expected: wires(
            'R(-0.5,0.5)-R(-2.5,0.5)  R(-0.5,0.5)-R(1.5,0.5)  R(-2.5,-2.5)-R(-2.5,0.5)  R(-2.5,-2.5)-R(1.5,0.5)  R(1.5,0.5)-R(3.5,0.5)'
        ),
    },
    {
        name: 'euclid-vs-manhattan',
        // (4.5,4.5) is 5.66 away and 8 by Manhattan distance; (-5.5,0.5) is 6 by
        // both. With four nearer poles taking four of the five wires, the fifth
        // goes to (4.5,4.5) - for a paste and for a single create_entity.
        map: [
            [3.5, 0.5],
            [-2.5, 0.5],
            [0.5, 3.5],
            [0.5, -2.5],
            [4.5, 4.5],
            [-5.5, 0.5],
        ],
        paste: [[0.5, 0.5]],
        expected: wires(
            'R(-2.5,0.5)-R(0.5,0.5)  R(0.5,-2.5)-R(0.5,0.5)  R(0.5,0.5)-R(0.5,3.5)  R(0.5,0.5)-R(3.5,0.5)  R(0.5,0.5)-R(4.5,4.5)'
        ),
    },
]

/*
    fan-out-7-chain-connected, up to a tie whose order is unmeasured. Seven map
    poles in one chain, around one new pole at (0.5,0.5). The game wired it to
    (2.5,-2.5), (2.5,3.5) and (-3.5,-1.5). The first two are the nearest, and
    every other pole at 4 or 4.12 tiles is a neighbour of one of them. The third
    is one of two poles exactly sqrt(20) away, (-3.5,-1.5) and (-3.5,2.5), which
    are wired to each other, so whichever is taken first rules out the other.
    Which one the game takes first is the unmeasured tie order, so either is
    accepted. The old Manhattan sort chose (4.5,0.5), (-0.5,4.5) and (-0.5,-3.5).
*/
function expectChainConnected(placeNewPole: (bp: Blueprint) => void): void {
    const { bp } = buildMap({ map: RING_7, mapWires: CHAIN_RING })
    placeNewPole(bp)
    const added = copperWires(bp).filter(w => !CHAIN_RING_WIRES.includes(w))
    expect(added).toHaveLength(3)
    expect(added).toContain('R(0.5,0.5)-R(2.5,-2.5)')
    expect(added).toContain('R(0.5,0.5)-R(2.5,3.5)')
    expect(
        added.filter(w => w === 'R(-3.5,-1.5)-R(0.5,0.5)' || w === 'R(-3.5,2.5)-R(0.5,0.5)')
    ).toHaveLength(1)
}

describe('pasted poles wire to the map as the game does (#343)', () => {
    it.each(CASES)('$name', c => {
        const { bp } = buildMap(c)
        paste(bp, c)
        expect(copperWires(bp)).toEqual(c.expected)
    })

    it('fan-out-7-chain-connected, up to a tie', () => {
        expectChainConnected(bp => paste(bp, { paste: [[0.5, 0.5]] }))
    })
})

describe('a pole placed by hand follows the same rule', () => {
    /*
        `createEntity(pole, true)` is single placement. The probe built
        `euclid-vs-manhattan` and `control-create-entity` both ways and the two
        agreed, so every one-pole row above should come out the same either way.
        The other one-pole rows were measured by paste only; they are run here
        because single placement now goes through the same routine, not because
        the game was asked.
    */
    const ONE_POLE = CASES.filter(c => c.paste.length === 1 && c.pasteWires === undefined)

    it.each(ONE_POLE)('$name', c => {
        const { bp } = buildMap(c)
        const [[x, y]] = c.paste
        bp.createEntity({ name: POLE, position: { x, y } }, true)
        expect(copperWires(bp)).toEqual(c.expected)
    })

    it('fan-out-7-chain-connected, up to a tie', () => {
        expectChainConnected(bp =>
            bp.createEntity({ name: POLE, position: { x: 0.5, y: 0.5 } }, true)
        )
    })

    it('is one undo step, wires included', () => {
        // Before: the pole and each of its wires were separate history entries,
        // so one undo took back a wire and left the pole standing.
        const { bp } = buildMap({
            map: [
                [0.5, 0.5],
                [6.5, 0.5],
            ],
        })
        bp.createEntity({ name: POLE, position: { x: 3.5, y: 0.5 } }, true)
        expect(bp.entities.size).toBe(3)
        expect(copperWires(bp)).toEqual(wires('R(0.5,0.5)-R(3.5,0.5)  R(3.5,0.5)-R(6.5,0.5)'))

        bp.history.undo()
        expect(bp.entities.size).toBe(2)
        expect(copperWires(bp)).toEqual([])

        bp.history.redo()
        expect(bp.entities.size).toBe(3)
        expect(copperWires(bp)).toHaveLength(2)
    })
})
