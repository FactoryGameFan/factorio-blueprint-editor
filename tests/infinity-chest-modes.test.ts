import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../packages/editor/src/core/Blueprint'
import {
    getAndClearLoadWarnings,
    getBlueprintOrBookFromSource,
} from '../packages/editor/src/core/bpString'
import { loadData } from '../packages/editor/src/core/factorioData'
import capture from '../tools/oracle/fixtures/infinity-chest-modes.json'

/*
    Infinity chests in the shapes Factorio 2.1 writes them (#611).

    2.1 gave the infinity chest a logistic mode, stored as a new key,
    `override_logistic_mode`, beside `request_filters` and, after a switch
    away from requester, `saved_request_filters` and
    `saved_request_from_buffers`. The editor has no control for any of them
    yet. What it must not do meanwhile is lose them, so every string the game
    exported or accepted in `tools/oracle/probe-infinity-chest-modes.mjs` goes
    through the editor and back, and must come out with every key it went in
    with.

    Two of the game's own import results are why losing a key matters. A chest
    whose mode key is dropped keeps its requests in the string, and the game
    then drops those requests on import without a word. And writing the mode
    as "none" makes the game refuse the whole string, so the key has to come
    back exactly as it went in, not rebuilt.

    `direction`, `position` and `entity_number` are left out of the comparison.
    The editor adds `direction: 0`, re-centres positions on load and may
    renumber entities, all on purpose and for every entity.
*/

type Entity = Record<string, unknown>
interface Row {
    label: string
    exported?: string
    entity?: Entity
    import_code?: number
}
interface Fixture {
    captured_on: string
    exports: Row[]
    imports: Row[]
}

const fixture = capture as unknown as Fixture
// Lua's JSON writer turns an empty list into {}.
const list = <T>(x: T[] | Record<string, never> | undefined): T[] => (Array.isArray(x) ? x : [])

const rows = [
    ...list(fixture.exports).map(r => ({ ...r, from: 'exported' })),
    // A string the game refused says nothing about what it keeps.
    ...list(fixture.imports)
        .filter(r => r.import_code === 0)
        .map(r => ({ ...r, from: 'imported and re-exported' })),
].filter(
    (r): r is Row & { exported: string; entity: Entity; from: string } =>
        r.exported !== undefined && r.entity !== undefined
)

const comparable = ({ entity_number: _n, position: _p, direction: _d, ...rest }: Entity) => rest

beforeAll(() => {
    loadData(readFileSync('packages/exporter/data/output/data.json', 'utf8'))
})

describe(`infinity chests as ${fixture.captured_on} writes them`, () => {
    // A recapture that lost a case would otherwise shrink this test quietly.
    it('covers every logistic mode and both saved fields', () => {
        expect(new Set(rows.map(r => r.entity.override_logistic_mode))).toEqual(
            new Set([
                'active-provider',
                'buffer',
                'passive-provider',
                'requester',
                'storage',
                undefined,
            ])
        )
        const keys = new Set(rows.flatMap(r => Object.keys(r.entity)))
        expect(keys).toContain('saved_request_filters')
        expect(keys).toContain('saved_request_from_buffers')
        // The switch a mode editor has to copy: requests parked in saved_* while
        // the chest provides. Rows with no mode carry saved_* too, so check the pair.
        expect(
            rows.some(
                r =>
                    r.entity.override_logistic_mode === 'passive-provider' &&
                    'saved_request_filters' in r.entity
            )
        ).toBe(true)
    })

    for (const row of rows) {
        it(`keeps every key of "${row.label}" (${row.from})`, async () => {
            getAndClearLoadWarnings()
            const bp = await getBlueprintOrBookFromSource(row.exported)
            expect(getAndClearLoadWarnings()).toEqual([])
            if (!(bp instanceof Blueprint)) throw new Error('Expected a blueprint')

            const out = bp.serialize().entities ?? []
            expect(out).toHaveLength(1)
            expect(comparable(out[0] as unknown as Entity)).toEqual(comparable(row.entity))
        })
    }
})
