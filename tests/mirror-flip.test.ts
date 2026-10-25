import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { StorageTankPrototype } from 'factorio:prototype'
import { Blueprint } from '../packages/editor/src/core/Blueprint'
import { Entity } from '../packages/editor/src/core/Entity'
import FD, { loadData, usesMirroring } from '../packages/editor/src/core/factorioData'
import capture from '../tools/oracle/fixtures/mirroring-2.1.23.json'

/*
    What a flip does to `mirror`, against what `LuaEntity.flip` did on 2.1.23
    (tools/oracle/probe-mirroring.mjs, #612). The game flipped each candidate
    horizontally and vertically, from every direction, starting both plain and
    mirrored, and recorded the direction and `mirroring` it ended on.
    `Entity.getFlippedCopy` has to land on the same pair.

    `getFlippedCopy` flips about (0, 0), so the entity sits there and only its
    direction and mirror are compared - where it moves to is the selection's
    business, and is pinned in tests/persistent-selection.spec.ts.
*/

interface Snapshot {
    direction: number
    mirroring: boolean
    recipe?: string
}
interface Flip {
    from_direction: number
    from_mirroring: boolean
    horizontal: boolean
    ok: boolean
    got?: Snapshot
}
interface Measured {
    name: string
    use_mirroring?: boolean
    flips: Flip[] | Record<string, never>
}

const measured = (capture as unknown as { entities: Measured[] }).entities

/*
    The remaining control is a measured entity whose flipped direction the
    editor gets wrong, and is not about `mirror`, which it never carries.
    The game folds a steam engine,
    which has two directions, from 8 back to 0 and from 12 to 4, where the
    editor writes 8 and 12 - the same facing under another number. Kept out so
    this file stays about mirroring.
*/
const KNOWN_WRONG_DIRECTION = new Set(['steam-engine'])

beforeAll(() => {
    loadData(readFileSync('packages/exporter/data/output/data.json', 'utf8'))
    const tank: StorageTankPrototype = {
        ...(FD.entities['storage-tank'] as StorageTankPrototype),
        name: 'four-way-storage-tank',
        two_direction_only: false,
    }
    FD.entities[tank.name] = tank
})

describe('usesMirroring', () => {
    for (const e of measured) {
        it(`${e.name} answers what the game reads off its prototype`, () => {
            // The probe reads `use_mirroring` from the runtime prototype, which
            // has the default applied; types without one read nothing.
            expect(usesMirroring(FD.entities[e.name])).toBe(e.use_mirroring === true)
        })
    }
})

describe('Entity.getFlippedCopy', () => {
    for (const [vertical, directions] of [
        [false, [0, 12, 8, 4]],
        [true, [8, 4, 0, 12]],
    ] as const) {
        for (const [index, direction] of [0, 4, 8, 12].entries()) {
            it(`keeps four-way tank reflection on ${vertical ? 'V' : 'H'} from ${direction}`, () => {
                const bp = new Blueprint({})
                const entity = new Entity(
                    {
                        entity_number: 1,
                        name: 'four-way-storage-tank',
                        position: { x: 3, y: 5 },
                        direction,
                    },
                    bp
                )

                const copy = entity.getFlippedCopy(vertical)

                expect(copy.direction).toBe(directions[index])
                expect(copy.position).toEqual(vertical ? { x: 3, y: -5 } : { x: -3, y: 5 })
                const restored = copy.getFlippedCopy(vertical)
                expect(restored.direction).toBe(entity.direction)
                expect(restored.position).toEqual(entity.position)
            })
        }
    }

    for (const e of measured) {
        const flips = Array.isArray(e.flips) ? e.flips : []
        for (const f of flips) {
            if (!f.ok || !f.got) continue
            const label =
                `${e.name}: flip ${f.horizontal ? 'H' : 'V'} from ${f.from_direction}` +
                `${f.from_mirroring ? ' mirrored' : ''}`
            it(label, () => {
                const bp = new Blueprint({
                    entities: [
                        {
                            entity_number: 1,
                            name: e.name,
                            position: { x: 0, y: 0 },
                            direction: f.from_direction,
                            ...(f.from_mirroring && { mirror: true }),
                            ...(f.got?.recipe && { recipe: f.got.recipe }),
                        },
                    ],
                })
                const entity = bp.entities.get(1) as Entity
                const copy = entity.getFlippedCopy(!f.horizontal)
                expect(copy.mirror, 'mirror').toBe(f.got?.mirroring)
                if (!KNOWN_WRONG_DIRECTION.has(e.name)) {
                    expect(copy.direction, 'direction').toBe(f.got?.direction)
                }
            })
        }
    }
})
