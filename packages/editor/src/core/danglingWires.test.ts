import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { getAndClearLoadWarnings, getBlueprintOrBookFromSource } from './bpString'
import { loadData } from './factorioData'

/*
    A wire endpoint naming an entity the blueprint does not have - issue #457.

    Nothing checked wire endpoints against the entity set, so such a wire reached
    `initBP` and threw in `WiresContainer.entityOf`, losing the whole blueprint.
    The common way to get one needs no hand-written blueprint:
    `stripUnknownPrototypes` removes entities this build does not know, such as a
    modded `ee-infinity-loader`, but it looked only at names. A wire that pointed
    at a removed entity stayed behind with a dangling end, so a modded blueprint
    whose modded entity was wired to anything could not be opened at all -
    although dropping the modded entity is exactly what the strip filter exists
    to make possible.

    Three shapes carry an endpoint, and measured against the editor before this
    fix all three threw the same `Wire connects to entity 2` error. The issue
    named only the first:

    - `blueprint.wires`, post-2.0
    - each entity's `connections`, pre-2.0, red and green by side plus copper
      through `Cu0`/`Cu1`
    - each entity's `neighbours`, pre-2.0, copper between power poles

    The cleaning runs on every blueprint rather than only on one that lost an
    entity, because a hand-written dangling wire needs no strip to exist.

    These tests assert against the serialized output rather than the model. A
    connection the model dropped and a connection the model never read look the
    same from a getter; only what comes back out can tell them apart.
*/

/** How Factorio packs a version into a blueprint's `version` field. */
const packVersion = (main: number, major: number, minor: number): number =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16

const V_2_0 = packVersion(2, 0, 55)
const V_1_1 = packVersion(1, 1, 107)

beforeAll(() => {
    // loadData permanently replaces FD's accessors. Vitest's per-file module
    // isolation keeps this synthetic dataset from leaking into other test files.
    loadData(
        JSON.stringify({
            items: { 'wooden-chest': { name: 'wooden-chest', place_result: 'wooden-chest' } },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'wooden-chest': {
                    type: 'container',
                    name: 'wooden-chest',
                    collision_box: [
                        [-0.35, -0.35],
                        [0.35, 0.35],
                    ],
                },
                'decider-combinator': {
                    type: 'decider-combinator',
                    name: 'decider-combinator',
                    collision_box: [
                        [-0.65, -0.35],
                        [0.65, 0.35],
                    ],
                },
                'medium-electric-pole': {
                    type: 'electric-pole',
                    name: 'medium-electric-pole',
                    collision_box: [
                        [-0.25, -0.25],
                        [0.25, 0.25],
                    ],
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            // The real values, because `createBpConnections` maps a connector id
            // through them and throws `Missing mapping!` on anything it cannot
            // place. An empty `defines` would fail every test here for that
            // reason rather than for the one under test.
            defines: {
                wire_connector_id: {
                    circuit_red: 1,
                    circuit_green: 2,
                    combinator_input_red: 1,
                    combinator_input_green: 2,
                    combinator_output_red: 3,
                    combinator_output_green: 4,
                    pole_copper: 5,
                    power_switch_left_copper: 5,
                    power_switch_right_copper: 6,
                },
            },
        })
    )
})

/*
    Decodes through the real path, so the cleaning has to be wired into it rather
    than exposed as a helper the test calls itself.

    Deflates with the same web APIs `bpString.encode` uses. `zlib` would need
    node types, which this package's tsconfig does not carry.

    `icons` is supplied on every case because the schema requires it. Without it
    every blueprint here loads with "Blueprint had validation warnings" attached,
    which lands in the same list the dropped-wire warning does and would make the
    warning assertions pass or fail for the wrong reason.
*/
async function load(blueprint: Record<string, unknown>): Promise<Blueprint> {
    const data = {
        blueprint: {
            icons: [{ index: 1, signal: { type: 'item', name: 'wooden-chest' } }],
            ...blueprint,
        },
    }
    const deflated = new Blob([JSON.stringify(data)])
        .stream()
        .pipeThrough(new CompressionStream('deflate'))
    const bytes = new Uint8Array(await new Response(deflated).arrayBuffer())
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const loaded = await getBlueprintOrBookFromSource(`0${btoa(binary)}`)
    if (!(loaded instanceof Blueprint)) throw new Error('Expected a blueprint')
    return loaded
}

const chest = (entity_number: number, x: number) => ({
    entity_number,
    name: 'wooden-chest',
    position: { x, y: 0.5 },
})

describe('a post-2.0 wire naming a missing entity', () => {
    it('drops the wire and keeps the blueprint', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [chest(1, 0.5)],
            wires: [[1, 1, 2, 1]],
        })
        const serialized = bp.serialize()
        expect(serialized.entities).toHaveLength(1)
        expect(serialized.wires ?? []).toEqual([])
    })

    it('warns with the count of wires it dropped', async () => {
        await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [chest(1, 0.5)],
            wires: [[1, 1, 2, 1]],
        })
        expect(getAndClearLoadWarnings()).toContain('Skipped 1 wire to a missing entity')
    })

    /*
        The control. A wire between two entities that are both present has to
        survive, or "drops dangling wires" is indistinguishable from "drops
        wires".
    */
    it('leaves a wire alone when both ends are present', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [
                { entity_number: 1, name: 'decider-combinator', position: { x: 0.5, y: 1 } },
                { entity_number: 2, name: 'decider-combinator', position: { x: 3.5, y: 1 } },
            ],
            wires: [[1, 1, 2, 1]],
        })
        expect(bp.serialize().wires).toEqual([[1, 1, 2, 1]])
        expect(getAndClearLoadWarnings()).toEqual([])
    })
})

describe('a wire to an entity the strip filter removed', () => {
    /*
        The case that needs no hand-written blueprint. `ee-infinity-loader` is
        not in the synthetic dataset above, so the strip filter removes it and
        the wire that pointed at it is left dangling.
    */
    it('drops the wire that pointed at the stripped entity', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [
                chest(1, 0.5),
                { entity_number: 2, name: 'ee-infinity-loader', position: { x: 2.5, y: 0.5 } },
            ],
            wires: [[1, 1, 2, 1]],
        })
        const serialized = bp.serialize()
        expect(serialized.entities).toHaveLength(1)
        expect(serialized.wires ?? []).toEqual([])
    })

    it('reports both the stripped entity and the dropped wire', async () => {
        await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [
                chest(1, 0.5),
                { entity_number: 2, name: 'ee-infinity-loader', position: { x: 2.5, y: 0.5 } },
            ],
            wires: [[1, 1, 2, 1]],
        })
        const warnings = getAndClearLoadWarnings()
        expect(warnings).toContain('Skipped 1 unknown entity: ee-infinity-loader')
        expect(warnings).toContain('Skipped 1 wire to a missing entity')
    })
})

describe('a pre-2.0 connection naming a missing entity', () => {
    it('drops a dangling red circuit connection', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                {
                    entity_number: 1,
                    name: 'decider-combinator',
                    position: { x: 0.5, y: 1 },
                    connections: { 1: { red: [{ entity_id: 2, circuit_id: 1 }] } },
                },
            ],
        })
        expect(bp.serialize().wires ?? []).toEqual([])
    })

    it('drops a dangling copper `neighbours` entry', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                {
                    entity_number: 1,
                    name: 'medium-electric-pole',
                    position: { x: 0.5, y: 0.5 },
                    neighbours: [2],
                },
            ],
        })
        expect(bp.serialize().wires ?? []).toEqual([])
    })

    /*
        The control for the pre-2.0 shape. Two poles that really are neighbours
        keep their copper wire, which serializes into the post-2.0 `wires` array
        because that is the only shape the editor writes.
    */
    it('leaves a `neighbours` entry alone when the other pole is present', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                {
                    entity_number: 1,
                    name: 'medium-electric-pole',
                    position: { x: 0.5, y: 0.5 },
                    neighbours: [2],
                },
                {
                    entity_number: 2,
                    name: 'medium-electric-pole',
                    position: { x: 4.5, y: 0.5 },
                    neighbours: [1],
                },
            ],
        })
        expect(bp.serialize().wires).toEqual([[1, 5, 2, 5]])
        expect(getAndClearLoadWarnings()).toEqual([])
    })
})
