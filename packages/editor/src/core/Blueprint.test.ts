import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { loadData } from './factorioData'

beforeAll(() => {
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
    it('serializes without icons when every entity is non-minable', () => {
        const blueprint = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'space-platform-hub',
                    position: { x: 0, y: 0 },
                },
            ],
        })

        expect(blueprint.serialize().icons).toEqual([])
    })
})
