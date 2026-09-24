import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { getBlueprintOrBookFromSource } from './bpString'
import { loadData } from './factorioData'

/*
    A wire whose entity has no connection point for it - issue #488.

    Both endpoints exist, so #457's dangling-endpoint drop leaves such a wire
    alone, and it used to reach `initBP` and throw "Could not find the wire
    connection point!" in `WiresContainer.getWireSprite`, losing the whole
    blueprint. A real export reaches it without any hand editing: Factorio 2.1
    gave labs a circuit connector, so a 2.1 biolab wired to a substation has a
    red or green wire that the 2.0 data this editor ships cannot attach.

    The question is asked of `Entity.getWireConnectionPoint`, the accessor
    `getWireSprite` asks, after every entity is built - not of the raw JSON at
    decode. Which point an entity has depends on its direction, a loader's
    input or output mode and a belt's neighbours in the position grid, and a
    copy of that logic over raw JSON is how an accessor goes wrong.

    As in danglingWires.test.ts, these assert against the serialized output,
    which is the only place a dropped wire and an unread one differ.
*/

const packVersion = (main: number, major: number, minor: number): number =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16

const V_2_0 = packVersion(2, 0, 55)
const V_1_1 = packVersion(1, 1, 107)

const box = (h: number) => [
    [-h, -h],
    [h, h],
]
const point = { red: [0.1, 0.1], green: [0.2, 0.2], copper: [0, 0] }

beforeAll(() => {
    loadData(
        JSON.stringify({
            items: { 'iron-chest': { name: 'iron-chest', place_result: 'iron-chest' } },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                // No circuit_connector: nothing can attach, like a 2.0 lab.
                'wooden-chest': {
                    type: 'container',
                    name: 'wooden-chest',
                    collision_box: box(0.35),
                },
                // A circuit_connector with red and green, and no copper.
                'iron-chest': {
                    type: 'container',
                    name: 'iron-chest',
                    collision_box: box(0.35),
                    circuit_connector: {
                        points: {
                            wire: { red: point.red, green: point.green },
                            shadow: { red: point.red, green: point.green },
                        },
                    },
                },
                'medium-electric-pole': {
                    type: 'electric-pole',
                    name: 'medium-electric-pole',
                    collision_box: box(0.15),
                    connection_points: [0, 1, 2, 3].map(() => ({ wire: point, shadow: point })),
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
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

async function load(blueprint: Record<string, unknown>): Promise<Blueprint> {
    const data = {
        blueprint: {
            icons: [{ index: 1, signal: { type: 'item', name: 'iron-chest' } }],
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

const entity = (entity_number: number, name: string, x: number) => ({
    entity_number,
    name,
    position: { x, y: 0.5 },
})

describe('a post-2.0 wire to a connection point the entity does not have', () => {
    it('drops a copper wire between two chests and keeps both chests', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [entity(1, 'iron-chest', 0.5), entity(2, 'iron-chest', 2.5)],
            wires: [[1, 5, 2, 5]],
        })
        const serialized = bp.serialize()
        expect(serialized.entities).toHaveLength(2)
        expect(serialized.wires ?? []).toEqual([])
        expect(bp.skippedWires).toBe(1)
    })

    it('drops a red wire when only one end has no connector', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [entity(1, 'iron-chest', 0.5), entity(2, 'wooden-chest', 2.5)],
            wires: [[1, 1, 2, 1]],
        })
        expect(bp.serialize().wires ?? []).toEqual([])
        expect(bp.skippedWires).toBe(1)
    })

    // The control: the same shape with a point at both ends is kept.
    it('keeps a red wire between two chests that both have one', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [entity(1, 'iron-chest', 0.5), entity(2, 'iron-chest', 2.5)],
            wires: [[1, 1, 2, 1]],
        })
        expect(bp.serialize().wires).toEqual([[1, 1, 2, 1]])
        expect(bp.skippedWires).toBe(0)
    })

    it('keeps the wires that attach and counts only the ones that do not', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [
                entity(1, 'iron-chest', 0.5),
                entity(2, 'iron-chest', 2.5),
                entity(3, 'medium-electric-pole', 4.5),
                entity(4, 'medium-electric-pole', 6.5),
            ],
            wires: [
                [1, 1, 2, 1],
                [1, 5, 2, 5],
                [3, 5, 4, 5],
                [2, 2, 3, 2],
            ],
        })
        expect(bp.serialize().wires).toEqual([
            [1, 1, 2, 1],
            [3, 5, 4, 5],
            [2, 2, 3, 2],
        ])
        expect(bp.skippedWires).toBe(1)
    })

    /*
        A connector id nothing maps to. This threw `Missing mapping!` in
        `createBpConnections` instead, at decode, so it reached the corrupt-string
        toast rather than initBP - and lost the blueprint the same way.
    */
    it('drops a wire whose connector id maps to nothing', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_2_0,
            entities: [entity(1, 'iron-chest', 0.5), entity(2, 'iron-chest', 2.5)],
            wires: [
                [1, 99, 2, 1],
                [1, 1, 2, 1],
            ],
        })
        expect(bp.serialize().wires).toEqual([[1, 1, 2, 1]])
        expect(bp.skippedWires).toBe(1)
    })
})

describe('a pre-2.0 wire to a connection point the entity does not have', () => {
    it('drops a red wire from `connections` to a chest with no connector', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                {
                    ...entity(1, 'iron-chest', 0.5),
                    connections: { 1: { red: [{ entity_id: 2 }] } },
                },
                entity(2, 'wooden-chest', 2.5),
            ],
        })
        expect(bp.serialize().entities).toHaveLength(2)
        expect(bp.skippedWires).toBe(1)
        expect(bp.wireConnections.getEntityConnections(1)).toEqual([])
    })

    it('keeps the same wire between two chests that both have one', async () => {
        const bp = await load({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                {
                    ...entity(1, 'iron-chest', 0.5),
                    connections: { 1: { red: [{ entity_id: 2 }] } },
                },
                entity(2, 'iron-chest', 2.5),
            ],
        })
        expect(bp.skippedWires).toBe(0)
        expect(bp.wireConnections.getEntityConnections(1)).toHaveLength(1)
    })
})

it('a blueprint built with no data skips nothing', () => {
    expect(new Blueprint().skippedWires).toBe(0)
})
