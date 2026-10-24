import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
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
    The two controls are the measured entities whose flipped direction the
    editor gets wrong, and neither is about `mirror`, which they never carry.
    The game turns a flipped storage tank a quarter, 0 <-> 4, where the editor
    keeps the direction it reflects to. And the game folds a steam engine,
    which has two directions, from 8 back to 0 and from 12 to 4, where the
    editor writes 8 and 12 - the same facing under another number. Kept out so
    this file stays about mirroring.
*/
const KNOWN_WRONG_DIRECTION = new Set(['storage-tank', 'steam-engine'])

beforeAll(() => {
    loadData(readFileSync('packages/exporter/data/output/data.json', 'utf8'))
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
