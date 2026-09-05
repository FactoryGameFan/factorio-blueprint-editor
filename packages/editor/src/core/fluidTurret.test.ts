import { expect, it } from 'vite-plus/test'
import exportedData from '../../../exporter/data/output/data.json'
import FD from './factorioData'
import { getSpriteData, type IDrawData } from './spriteDataBuilder'

it('renders all eight fluid turret facings, including the 2.1 alternate pipe covers', () => {
    const data = JSON.parse(JSON.stringify(exportedData))
    FD.entities = data.entities
    const original = data.entities['flamethrower-turret']
    const turret = structuredClone(original)
    turret.name = 'flamethrower-turret-2.1'
    FD.entities[turret.name] = turret

    // Shape and connection coordinates from Factorio 2.1.14 base/prototypes/entity/fire.lua:
    // https://github.com/wube/factorio-data/blob/2.1.14/base/prototypes/entity/fire.lua
    const names = [
        'north',
        'north_east',
        'east',
        'south_east',
        'south',
        'south_west',
        'west',
        'north_west',
    ]
    for (const name of names.filter((_, i) => i % 2)) {
        turret.graphics_set.base_visualisation.animation[name] = {
            layers: [{ filename: `base-${name}.png` }],
        }
        turret.folded_animation[name] = { layers: [{ filename: `gun-${name}.png` }] }
    }
    Object.assign(turret.fluid_box.pipe_connections[0], {
        alt_direction: 12,
        alt_position: [-1, 0],
    })
    Object.assign(turret.fluid_box.pipe_connections[1], { alt_direction: 8, alt_position: [0, 1] })

    const draw = (name: string, dir: number, positionGrid?: IDrawData['positionGrid']) =>
        getSpriteData({
            name,
            dir,
            position: { x: 0, y: 0 },
            positionGrid,
            generateConnector: false,
            assemblerHasFluidInputs: false,
            assemblerHasFluidOutputs: false,
        } as IDrawData)
    const coverDirections = [
        ['west', 'south'],
        ['north', 'west'],
        ['east', 'north'],
        ['south', 'east'],
    ]
    const coverOffsets = [
        [
            [-2, 0],
            [0, 2],
        ],
        [
            [0, -2],
            [-2, 0],
        ],
        [
            [2, 0],
            [0, -2],
        ],
        [
            [0, 2],
            [2, 0],
        ],
    ]
    for (let i = 0; i < names.length; i++) {
        const sprites = draw(turret.name, i * 2)
        expect(Array.isArray(sprites)).toBe(true)
        if (i % 2 === 0) {
            expect(sprites).toEqual(draw(original.name, i * 2))
        } else {
            const quadrant = (i - 1) / 2
            const covers = coverDirections[quadrant].map((dir, j) => {
                const cover = turret.fluid_box.pipe_covers[dir].layers[0]
                return {
                    ...cover,
                    shift: (cover.shift ?? [0, 0]).map(
                        (value: number, axis: number) => value + coverOffsets[quadrant][j][axis]
                    ),
                }
            })
            expect(sprites).toEqual([
                { filename: `base-${names[i]}.png` },
                { filename: `gun-${names[i]}.png` },
                ...covers,
            ])
            // A neighbouring diagonal turret must expose its alternate connection too.
            const positionGrid = {
                getEntityAtPosition: ({ x, y }: { x: number; y: number }) => {
                    const j = coverOffsets[quadrant].findIndex(([cx, cy]) => cx === x && cy === y)
                    expect(j).toBeGreaterThanOrEqual(0)
                    const direction = (names.indexOf(coverDirections[quadrant][j]) * 2 + 8) % 16
                    return {
                        position: { x, y },
                        direction: 2,
                        entityData: {
                            type: 'fluid-turret',
                            fluid_box: {
                                pipe_connections: [
                                    {
                                        position: [9, 9],
                                        direction: 0,
                                        alt_position: [0, 0],
                                        alt_direction: direction,
                                    },
                                ],
                            },
                        },
                    }
                },
            } as unknown as IDrawData['positionGrid']
            expect(draw(turret.name, i * 2, positionGrid)).toEqual(sprites.slice(0, 2))
        }
    }
})
