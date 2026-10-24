import { describe, expect, it } from 'vite-plus/test'
import { IPoint } from '../packages/editor/src/types'
import { mirrorDirection, mirrorPoint } from '../packages/editor/src/core/mirroring'
import capture2077 from '../tools/oracle/fixtures/mirroring-2.0.77.json'
import capture2123 from '../tools/oracle/fixtures/mirroring-2.1.23.json'

/*
    The rule in packages/editor/src/core/mirroring.ts, checked against every
    measurement the oracle took (`tools/oracle/probe-mirroring.mjs`, one
    fixture per Factorio version). For each entity and direction the game built
    once plain and once mirrored, the mirrored connections must be the plain
    ones run through `mirrorPoint` and `mirrorDirection`, and so must a drill's
    or inserter's drop and pickup points.
*/

type Pair = [number, number]
interface Connection {
    position: Pair
    target: Pair
}
interface Snapshot {
    direction: number
    mirroring: boolean
    fluidboxes: Connection[][] | Record<string, never>
    drop?: Pair
    pickup?: Pair
}
interface Fixture {
    captured_on: string
    entities: {
        name: string
        cases: { asked_direction: number; asked_mirror: boolean; got?: Snapshot }[]
    }[]
}

// Lua's JSON writer turns an empty list into {}.
const list = <T>(x: T[] | Record<string, never> | undefined): T[] => (Array.isArray(x) ? x : [])
const pt = ([x, y]: Pair): IPoint => ({ x, y })
const key = (p: IPoint): string => `${p.x + 0},${p.y + 0}`
// A connection's facing, read off the step from its position to its target.
const facing = (c: Connection): number => {
    const dx = c.target[0] - c.position[0]
    const dy = c.target[1] - c.position[1]
    return dy < 0 ? 0 : dx > 0 ? 4 : dy > 0 ? 8 : 12
}
const describeConnection = (c: { position: IPoint; dir: number }): string =>
    `${key(c.position)}@${c.dir}`

const fixtures = [capture2077, capture2123] as unknown as Fixture[]

for (const fixture of fixtures) {
    describe(`the game's mirrored entities (${fixture.captured_on})`, () => {
        let compared = 0
        for (const entity of fixture.entities) {
            for (const dir of [0, 4, 8, 12]) {
                const plain = entity.cases.find(c => c.asked_direction === dir && !c.asked_mirror)
                const mirrored = entity.cases.find(c => c.asked_direction === dir && c.asked_mirror)
                // An entity that kept neither the facing nor the mirror says nothing here.
                if (
                    plain?.got?.direction !== dir ||
                    mirrored?.got?.direction !== dir ||
                    !mirrored.got.mirroring
                )
                    continue
                const a = plain.got
                const b = mirrored.got

                it(`${entity.name} facing ${dir}`, () => {
                    const boxesA = list(a.fluidboxes)
                    const boxesB = list(b.fluidboxes)
                    expect(boxesB.length).toBe(boxesA.length)
                    boxesA.forEach((box, i) => {
                        const expected = list(box)
                            .map(c => ({
                                position: mirrorPoint(pt(c.position), dir),
                                dir: mirrorDirection(facing(c), dir),
                            }))
                            .map(describeConnection)
                            .sort()
                        const got = list(boxesB[i])
                            .map(c => ({ position: pt(c.position), dir: facing(c) }))
                            .map(describeConnection)
                            .sort()
                        expect(got).toEqual(expected)
                    })
                    for (const field of ['drop', 'pickup'] as const) {
                        const p = a[field]
                        const q = b[field]
                        if (p && q) expect(key(pt(q))).toBe(key(mirrorPoint(pt(p), dir)))
                    }
                })
                compared++
            }
        }
        it('compared enough cases to mean something', () => {
            expect(compared).toBeGreaterThan(20)
        })
    })
}
