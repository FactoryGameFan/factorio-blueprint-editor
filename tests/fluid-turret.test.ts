import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import FD from '../packages/editor/src/core/factorioData'
import {
    getSpriteData,
    SPRITE_GENERATION_FAILED,
    type IDrawData,
} from '../packages/editor/src/core/spriteDataBuilder'

/*
    Factorio 2.1 makes the flamethrower turret eight-way (#366), and
    draw_fluid_turret reached util.getDirName, which throws on a diagonal - the
    bug #357 fixed on railgun-turret, one entity over. Nothing committed reaches
    it: the 2.0 prototype carries four animation keys and no alternate pipe
    connection, so a browser spec shaped like tests/railgun-turret-diagonal.spec.ts
    cannot put a flamethrower turret on a diagonal at all. This test builds the
    2.1 shape by hand on top of the committed prototype instead.

    Animation keys and alternate connection coordinates come from Factorio 2.1.14
    base/prototypes/entity/fire.lua: fireutil.flamethrower_turret_extension
    returns the eight underscored keys, and lines 528-529 give
    alt_direction = west with alt_position = {-1, 0} and alt_direction = south
    with alt_position = {0, 1}. That the alternates are defined at north-east and
    rotate in quarter turns for the other three diagonals is an inference fire.lua
    does not state, so this test asserts the model it assumes and cannot catch
    that convention being wrong; confirming it against regenerated 2.1 data is on
    the #187 checklist.

    It lives under tests/ rather than beside spriteDataBuilder.ts because the
    editor tsconfig includes every JSON file under its src, so importing the
    3.9 MB data.json from there pulls the whole file into the editor's type-check
    program to read one prototype. Reading it off disk needs node types, which only the root project
    has - see the `unit` project in vite.config.ts.
*/

// Resolved from the working directory, the way tests/wire-switch-completeness.test.ts
// does: the root tsconfig is `module: "ES6"`, which predates import.meta.dirname.
const DATA_JSON = path.resolve(process.cwd(), 'packages/exporter/data/output/data.json')

// RotatedAnimation8Way keys in direction order, so index i is direction i * 2.
const NAMES = [
    'north',
    'north_east',
    'east',
    'south_east',
    'south',
    'south_west',
    'west',
    'north_west',
] as const

const DIAGONALS = [2, 6, 10, 14] as const

// The pipe_covers key and tile offset of each cover a diagonal turret draws, by
// quadrant: north_east, south_east, south_west, north_west. The first pair is
// fire.lua's alt_direction west / alt_position {-1, 0} and south / {0, 1}
// rotated by the quadrant; the offset adds the cover's own one-tile step.
const COVER_DIRECTIONS = [
    ['west', 'south'],
    ['north', 'west'],
    ['east', 'north'],
    ['south', 'east'],
] as const
const COVER_OFFSETS = [
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
] as const

type Prototype = any

const draw = (name: string, dir: number, positionGrid?: IDrawData['positionGrid']) =>
    getSpriteData({
        name,
        dir,
        position: { x: 0, y: 0 },
        positionGrid,
        generateConnector: false,
        // A crafting machine only has fluid boxes to cover once a recipe gives it
        // fluids; a turret is not one and ignores both. On, so the placeholder
        // cases below reach the cover code the same way the all-entity sweep did.
        assemblerHasFluidInputs: true,
        assemblerHasFluidOutputs: true,
    } as IDrawData)

/** The committed 2.0 flamethrower-turret with the 2.1 eight-way fields added. */
function turret21(original: Prototype): Prototype {
    const turret = structuredClone(original)
    turret.name = 'flamethrower-turret-2.1'
    for (const name of NAMES.filter((_, i) => i % 2)) {
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
    return turret
}

/** The covers a diagonal turret draws when nothing is connected to it. */
function expectedCovers(turret: Prototype, quadrant: number) {
    return COVER_DIRECTIONS[quadrant].map((dir, j) => {
        const cover = turret.fluid_box.pipe_covers[dir].layers[0]
        return {
            ...cover,
            shift: (cover.shift ?? [0, 0]).map(
                (value: number, axis: number) => value + COVER_OFFSETS[quadrant][j][axis]
            ),
        }
    })
}

describe('fluid turret at the eight 2.1 facings', () => {
    let original: Prototype
    let turret: Prototype

    beforeEach(() => {
        const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8'))
        FD.entities = data.entities
        original = data.entities['flamethrower-turret']
        turret = turret21(original)
        FD.entities[turret.name] = turret
        // getSpriteData reports a throw as a console warning and the placeholder;
        // the placeholder is what the diagnostic cases below assert on.
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('draws each cardinal exactly as the 2.0 prototype does', () => {
        for (const i of [0, 2, 4, 6]) {
            const sprites = draw(turret.name, i * 2)
            expect(Array.isArray(sprites)).toBe(true)
            expect(sprites).toEqual(draw(original.name, i * 2))
        }
    })

    it('draws each diagonal from its own key with the alternate pipe covers', () => {
        for (const i of [1, 3, 5, 7]) {
            const sprites = draw(turret.name, i * 2)
            expect(Array.isArray(sprites)).toBe(true)
            expect(sprites).toEqual([
                { filename: `base-${NAMES[i]}.png` },
                { filename: `gun-${NAMES[i]}.png` },
                ...expectedCovers(turret, (i - 1) / 2),
            ])
        }
    })

    /*
        A neighbour suppresses a cover only when one of its connections lands on
        the turret's tile and points back at it. The two controls are what make
        that a test of *which* connection matched rather than of "something
        matched": replacing the direction comparison in checkFluidConnection
        with `true` leaves the positive case green and fails the first control,
        and dropping the position comparison fails the second.
    */
    describe('a neighbouring diagonal turret', () => {
        type Neighbour = { turn?: number; shift?: number }

        // A grid holding one diagonal turret at each cover tile of `quadrant`,
        // facing north-east with a 2.1 alternate connection aimed at the turret
        // under test. `turn` rotates that aim away from it; `shift` moves the
        // neighbour's own position east of the tile the grid found it on.
        const gridOf = (quadrant: number, neighbour: (j: number) => Neighbour) =>
            ({
                getEntityAtPosition: ({ x, y }: { x: number; y: number }) => {
                    const j = COVER_OFFSETS[quadrant].findIndex(([cx, cy]) => cx === x && cy === y)
                    expect(j).toBeGreaterThanOrEqual(0)
                    const { turn = 0, shift = 0 } = neighbour(j)
                    const back = (NAMES.indexOf(COVER_DIRECTIONS[quadrant][j]) * 2 + 8) % 16
                    return {
                        position: { x: x + shift, y },
                        direction: 2,
                        entityData: {
                            type: 'fluid-turret',
                            fluid_box: {
                                pipe_connections: [
                                    {
                                        position: [9, 9],
                                        direction: 0,
                                        alt_position: [0, 0],
                                        alt_direction: (back + turn) % 16,
                                    },
                                ],
                            },
                        },
                    }
                },
            }) as unknown as IDrawData['positionGrid']

        it('takes the cover off a connection it points back at', () => {
            for (const i of [1, 3, 5, 7]) {
                const uncovered = draw(turret.name, i * 2).slice(0, 2)
                expect(
                    draw(
                        turret.name,
                        i * 2,
                        gridOf((i - 1) / 2, () => ({}))
                    )
                ).toEqual(uncovered)
            }
        })

        it('leaves the cover on when its connection faces the wrong way', () => {
            for (const i of [1, 3, 5, 7]) {
                const covered = draw(turret.name, i * 2)
                expect(covered).toHaveLength(4)
                expect(
                    draw(
                        turret.name,
                        i * 2,
                        gridOf((i - 1) / 2, () => ({ turn: 4 }))
                    )
                ).toEqual(covered)
            }
        })

        it('leaves the cover on when it sits one tile off', () => {
            for (const i of [1, 3, 5, 7]) {
                const covered = draw(turret.name, i * 2)
                expect(
                    draw(
                        turret.name,
                        i * 2,
                        gridOf((i - 1) / 2, () => ({ shift: 1 }))
                    )
                ).toEqual(covered)
            }
        })

        it('takes off only the cover whose neighbour matches', () => {
            for (const i of [1, 3, 5, 7]) {
                const covered = draw(turret.name, i * 2)
                // The first neighbour matches and the second faces away, so the
                // first cover goes and the second stays.
                const grid = gridOf((i - 1) / 2, j => (j === 0 ? {} : { turn: 4 }))
                expect(draw(turret.name, i * 2, grid)).toEqual([...covered.slice(0, 2), covered[3]])
            }
        })
    })

    /*
        The alternate-connection path is taken only when the prototype declares
        one. A diagonal direction on an entity without it is malformed data, and
        spriteShape.ts's header makes the loud failure deliberate: the throw
        reaches getSpriteData, which logs it and returns the placeholder. Gating
        on the direction alone turned that into a silent cardinal render with the
        covers in the wrong place on five committed entities - measured over all
        155 at every direction with fluid inputs on, storage-tank the clearest
        because its own draw never reaches getDirName.
    */
    it('keeps the placeholder for a diagonal entity with no alternate connection', () => {
        for (const name of [
            'storage-tank',
            'steam-engine',
            'steam-turbine',
            'pumpjack',
            'electromagnetic-plant',
        ]) {
            for (const dir of DIAGONALS) {
                expect(draw(name, dir), `${name} at ${dir}`).toBe(SPRITE_GENERATION_FAILED)
            }
            expect(Array.isArray(draw(name, 0)), `${name} at 0`).toBe(true)
        }
        // The 2.0 turret has no diagonal keys either, and a diagonal there fails too.
        for (const dir of DIAGONALS) {
            expect(draw(original.name, dir)).toBe(SPRITE_GENERATION_FAILED)
        }
    })
})
