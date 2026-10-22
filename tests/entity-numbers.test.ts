import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../packages/editor/src/core/Blueprint'
import {
    getAndClearLoadWarnings,
    getBlueprintOrBookFromSource,
    isUsableEntityNumber,
} from '../packages/editor/src/core/bpString'
import { loadData } from '../packages/editor/src/core/factorioData'
import { IBlueprint, IBlueprintBook } from '../packages/editor/src/types'
import { discoverBlueprintFiles } from './helpers/blueprint-files'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'

/*
    entity_number values the model cannot key an entity by, dropped on decode
    (#469). bpString.ts says why each kind broke the model; these pin the drop,
    the warning, and that no committed blueprint loses anything to it.
*/

beforeAll(() => {
    loadData(readFileSync('packages/exporter/data/output/data.json', 'utf8'))
})

const chest = (entity_number: number, x: number, name = 'wooden-chest') => ({
    entity_number,
    name,
    position: { x, y: 0.5 },
})

async function load(entities: object[], wires?: number[][]): Promise<Blueprint> {
    getAndClearLoadWarnings()
    const loaded = await getBlueprintOrBookFromSource(
        encodeBlueprint({
            item: 'blueprint',
            version: packVersion(2, 0, 55),
            icons: [{ index: 1, signal: { type: 'item', name: 'wooden-chest' } }],
            entities,
            ...(wires ? { wires } : {}),
        })
    )
    if (!(loaded instanceof Blueprint)) throw new Error('Expected a blueprint')
    return loaded
}

const names = (bp: Blueprint) => bp.serialize().entities?.map(e => e.name) ?? []

describe('an entity_number the model cannot use', () => {
    for (const bad of [Number.MAX_SAFE_INTEGER, 1e300, 2 ** 32, 0, -1, 1.5]) {
        it(`drops the entity numbered ${bad} and keeps the rest`, async () => {
            const bp = await load([chest(1, 0.5), chest(bad, 4.5, 'iron-chest')])
            expect(names(bp)).toEqual(['wooden-chest'])
            expect(getAndClearLoadWarnings()).toContain(
                'Skipped 1 entity with an unusable or repeated entity number'
            )
        })
    }

    /*
        The failure the bound exists for, from the model's side. Before the
        bound, a blueprint holding 2^53 - 1 gave its next two new entities one
        key between them. The largest number kept still numbers new entities
        apart.
    */
    it('keeps the largest allowed number, and new entities still number apart', async () => {
        const bp = await load([chest(2 ** 32 - 1, 0.5)])
        expect(getAndClearLoadWarnings()).toEqual([])
        bp.createEntity({ name: 'wooden-chest', position: { x: 4.5, y: 0.5 } } as never)
        bp.createEntity({ name: 'wooden-chest', position: { x: 8.5, y: 0.5 } } as never)
        expect(bp.entities.size).toBe(3)
    })
})

describe('a repeated entity_number', () => {
    it('keeps the first holder and drops the later one, with a warning', async () => {
        const bp = await load([chest(1, 0.5), chest(1, 4.5, 'iron-chest')])
        expect(names(bp)).toEqual(['wooden-chest'])
        expect(getAndClearLoadWarnings()).toContain(
            'Skipped 1 entity with an unusable or repeated entity number'
        )
    })

    // dropDanglingWires runs after, so a wire to the dropped entity goes too.
    it('drops a wire to the entity it dropped', async () => {
        const bp = await load(
            [chest(1, 0.5), chest(2, 2.5), chest(3e300, 4.5)],
            [
                [1, 1, 2, 1],
                [2, 1, 3e300, 1],
            ]
        )
        expect(bp.serialize().wires).toEqual([[1, 1, 2, 1]])
    })
})

it('leaves ordinary numbers alone', async () => {
    const bp = await load([chest(1, 0.5), chest(7, 4.5, 'iron-chest')])
    expect(names(bp)).toEqual(['wooden-chest', 'iron-chest'])
    expect(getAndClearLoadWarnings()).toEqual([])
})

/*
    The guard against the rule dropping something real. Every entity in every
    blueprint in test-blueprints/, books walked to the bottom, has to pass it.
    Measured 2026-10-21: 350,862 entities, the largest numbered 35,964.
*/
it('drops nothing from any committed blueprint', () => {
    const problems: string[] = []
    let checked = 0

    const checkBlueprint = (bp: IBlueprint, where: string): void => {
        const seen = new Set<number>()
        for (const e of bp.entities ?? []) {
            checked += 1
            if (!isUsableEntityNumber(e.entity_number) || seen.has(e.entity_number)) {
                problems.push(`${where} entity ${e.entity_number}`)
            }
            seen.add(e.entity_number)
        }
    }
    const walk = (book: IBlueprintBook, where: string): void => {
        ;(book.blueprints ?? []).forEach((entry, i) => {
            if (entry.blueprint) checkBlueprint(entry.blueprint, `${where}/${i}`)
            if (entry.blueprint_book) walk(entry.blueprint_book, `${where}/${i}`)
        })
    }

    for (const { name, filePath } of discoverBlueprintFiles()) {
        const data = decodeBlueprintString(readFileSync(filePath, 'utf8').trim())
        if (data.blueprint) checkBlueprint(data.blueprint, name)
        if (data.blueprint_book) walk(data.blueprint_book, name)
    }

    // Nothing checked would make an empty problem list meaningless.
    expect(checked).toBeGreaterThan(0)
    expect(problems).toEqual([])
})
