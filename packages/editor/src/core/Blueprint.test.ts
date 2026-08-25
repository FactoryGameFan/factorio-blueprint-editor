import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { encode, getAndClearLoadWarnings, getBlueprintOrBookFromSource } from './bpString'
import { loadData } from './factorioData'

beforeAll(() => {
    // loadData permanently replaces FD's accessors. Vitest's per-file module
    // isolation keeps this synthetic dataset from leaking into other test files.
    loadData(
        JSON.stringify({
            items: {},
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'space-platform-hub': {
                    type: 'space-platform-hub',
                    name: 'space-platform-hub',
                    collision_box: [
                        [-1, -1],
                        [1, 1],
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

describe('Blueprint icon generation', () => {
    it('round-trips with an entity icon when every entity is non-minable', async () => {
        const blueprint = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'space-platform-hub',
                    position: { x: 0, y: 0 },
                },
            ],
        })

        const icons = [
            {
                index: 1,
                signal: { type: 'entity' as const, name: 'space-platform-hub' },
            },
        ]
        expect(blueprint.serialize().icons).toEqual(icons)

        const roundTripped = await getBlueprintOrBookFromSource(await encode(blueprint))

        expect(getAndClearLoadWarnings()).toEqual([])
        expect(roundTripped.serialize().icons).toEqual(icons)
    })
})
