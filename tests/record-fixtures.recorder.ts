import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { loadBlueprint, waitForEditor, SpriteDataTally } from './helpers/fbe-test-api'

/*
    THROWAWAY. Deleted before the PR for #186 lands.

    Re-records the four sets of pinned values that are keyed to corpus
    membership, for the one change that legitimately moves them: the corpus
    itself being replaced. These fixtures are fixed points and the repo
    deliberately has no re-record path; this is a measuring instrument that
    exists for one change and then goes, the same way tools/oracle/ treats a
    probe.

    Every measurement below is copied verbatim from the spec that owns it. That
    duplication is the point rather than a shortcut: run against the corpus as
    it stands today, this must reproduce the committed fixtures byte for byte,
    and an independent copy agreeing to the byte is what makes anything it says
    afterwards trustworthy. Run against a corpus it cannot reproduce, nothing it
    produces means anything.

    One test per fixture half, because each needs a fresh page.
    EntitySprite.getParts fills `filename` in from `filenames` on the prototype
    objects out of data.json rather than on copies, so rendering a blueprint
    mutates state the digest reads - see the note at the head of
    tests/sprite-data.spec.ts.
*/

const OUT = process.env.FBE_RECORD_OUT ?? path.resolve(process.cwd(), 'recorder-out')

/** Cardinals only - must match sprite-data.spec.ts and overlay-container.spec.ts. */
const DIRECTIONS = [0, 4, 8, 12]

type Page = import('@playwright/test').Page

// ---------------------------------------------------------------- output

function writeJson(name: string, value: unknown): void {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 4) + '\n')
}

/**
 * A TypeScript object literal in this repo's house style: identifier keys
 * unquoted, everything else single quoted, 4-space indent, trailing commas.
 * Line wrapping is left to `vp check --fix`, which is deterministic, so two
 * renderings that agree on values and key order converge on identical text.
 */
function toTs(value: unknown, indent = 0): string {
    const pad = ' '.repeat(indent)
    const inner = ' '.repeat(indent + 4)
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        return `[${value.map(v => toTs(v, indent + 4)).join(', ')}]`
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) return '{}'
        const body = entries
            .map(([k, v]) => {
                const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k}'`
                return `${inner}${key}: ${toTs(v, indent + 4)},`
            })
            .join('\n')
        return `{\n${body}\n${pad}}`
    }
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    return String(value)
}

function writeTs(name: string, declaration: string, value: unknown): void {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, name), `${declaration} = ${toTs(value)}\n`)
}

// ------------------------------------------- copied from sprite-data.spec.ts

/** Same digests, entities in name order. */
function sortKeys(digests: SpriteDataTally): Record<string, string[]> {
    return Object.fromEntries(Object.entries(digests).sort(([a], [b]) => a.localeCompare(b)))
}

/** Sorted distinct digests per entity. */
function summarise(digests: Record<string, Iterable<string>>): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(digests)
            .map(([name, seen]) => [name, [...new Set(seen)].sort()] as const)
            .sort(([a], [b]) => a.localeCompare(b))
    )
}

async function tallyFor(page: Page, source: string): Promise<SpriteDataTally> {
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.spriteDataTally())
}

/*
    Assembled across five tests and written once, so the key order matches the
    committed file: synthetic, noGrid, noGridReal, paintPreview, real. Playwright
    runs a file's tests in declaration order at workers: 1.
*/
const spriteData: Record<string, Record<string, string[]>> = {}

test('record sprite-data: synthetic', async ({ page }) => {
    await waitForEditor(page)
    const { source, names } = buildAllEntitiesBlueprint(DIRECTIONS)
    expect(names.length).toBeGreaterThan(100)
    spriteData.synthetic = summarise(await tallyFor(page, source))
})

test('record sprite-data: noGrid', async ({ page }) => {
    await waitForEditor(page)
    const { source } = buildAllEntitiesBlueprint(DIRECTIONS)
    await loadBlueprint(page, source)
    const tally = await page.evaluate(() =>
        window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
    )
    spriteData.noGrid = summarise(tally)
})

test('record sprite-data: noGridReal', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))
    const tally = await page.evaluate(async (strings: string[]) => {
        const api = window.__fbe_test
        const out: Record<string, string[]> = {}
        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? (loaded.lastBookIndex ?? 0) + 1 : 1
            for (let i = 0; i < count; i++) {
                const blueprint = isBook ? loaded.selectBlueprint(i) : loaded
                for (const [name, digests] of Object.entries(
                    api.spriteDataTally(blueprint, { withGrid: false })
                )) {
                    ;(out[name] ??= []).push(...digests)
                }
            }
        }
        return out
    }, sources)

    spriteData.noGridReal = summarise(tally)
})

test('record sprite-data: paintPreview', async ({ page }) => {
    await waitForEditor(page)
    const tally = await page.evaluate(dirs => window.__fbe_test.paintPreviewTally(dirs), [
        ...DIRECTIONS,
        undefined,
    ] as (number | undefined)[])
    expect(Object.keys(tally).length).toBeGreaterThan(100)
    // Not summarised - one digest per entry of the directions array, in order.
    spriteData.paintPreview = sortKeys(tally)
})

test('record sprite-data: real', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))
    const { tally, blueprintCount, entitiesSeen } = await page.evaluate(
        async (strings: string[]) => {
            const api = window.__fbe_test
            const out: Record<string, string[]> = {}
            let blueprintCount = 0
            let entitiesSeen = 0

            for (const str of strings) {
                const loaded = await api.getBlueprintOrBookFromSource(str)
                const isBook = typeof loaded.selectBlueprint === 'function'
                const count = isBook ? (loaded.lastBookIndex ?? 0) + 1 : 1

                for (let i = 0; i < count; i++) {
                    const blueprint = isBook ? loaded.selectBlueprint(i) : loaded
                    blueprintCount += 1
                    for (const [name, digests] of Object.entries(api.spriteDataTally(blueprint))) {
                        entitiesSeen += digests.length
                        ;(out[name] ??= []).push(...digests)
                    }
                }
            }

            return { tally: out, blueprintCount, entitiesSeen }
        },
        sources
    )

    spriteData.real = summarise(tally)
    // Reported, not asserted - the spec pins them and this is what tells us what to.
    console.log(`RECORDED blueprintCount=${blueprintCount} entitiesSeen=${entitiesSeen}`)
    writeJson('sprite-data.counts.json', { blueprintCount, entitiesSeen })
})

// -------------------------------------- copied from entity-accessors.spec.ts

const TALLIED = [
    'recipe',
    'directionType',
    'railLayer',
    'filters',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'moduleSlots',
    'combinatorConditions',
    'inserterStackSize',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

type Tally = { value: number; empty: number; nothing: number; threw: number }

test('record entity-accessors EXPECTED', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))

    const tally = await page.evaluate(
        async ({ strings, accessors }: { strings: string[]; accessors: string[] }) => {
            const api = window.__fbe_test as unknown as Record<string, any>
            const out: Record<string, Tally> = {}
            const bump = (key: string, field: keyof Tally): void => {
                out[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
                out[key][field] += 1
            }

            let entityCount = 0
            let blueprintCount = 0

            for (const str of strings) {
                const loaded = await api.getBlueprintOrBookFromSource(str)
                const isBook = typeof loaded.selectBlueprint === 'function'
                const count = isBook ? loaded.lastBookIndex + 1 : 1

                for (let i = 0; i < count; i++) {
                    const bp = isBook ? loaded.selectBlueprint(i) : loaded
                    blueprintCount += 1
                    for (const e of bp.entities.values()) {
                        entityCount += 1
                        for (const key of accessors) {
                            let v: unknown
                            try {
                                v = e[key]
                            } catch {
                                bump(key, 'threw')
                                continue
                            }
                            if (v === undefined || v === null) bump(key, 'nothing')
                            else if (Array.isArray(v) && v.length === 0) bump(key, 'empty')
                            else bump(key, 'value')
                        }
                    }
                }
            }

            return { entityCount, blueprintCount, accessors: out }
        },
        { strings: sources, accessors: [...TALLIED] }
    )

    /*
        The spec asserts with toEqual, which ignores key order, and `out` is
        built in TALLIED order. The committed literal is ASCII-sorted, so sort
        here or the re-recorded block reorders 25 keys for no reason.
    */
    const recorded = {
        entityCount: tally.entityCount,
        blueprintCount: tally.blueprintCount,
        accessors: Object.fromEntries(
            Object.entries(tally.accessors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        ),
    }

    writeJson('entity-accessors.EXPECTED.json', recorded)
    writeTs(
        'entity-accessors.EXPECTED.ts.txt',
        `const EXPECTED: {
    entityCount: number
    blueprintCount: number
    accessors: Record<string, Tally>
}`,
        recorded
    )
})

// ----------------------------------- copied from blueprint-round-trip.spec.ts

test('record blueprint-round-trip EXPECTED', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))

    const summary = await page.evaluate(async (strings: string[]) => {
        const api = window.__fbe_test as unknown as Record<string, any>

        const hashInto = (h: number, s: string): number => {
            let acc = h
            for (let i = 0; i < s.length; i++) {
                acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
            }
            return acc
        }

        let blueprints = 0
        let entities = 0
        let tiles = 0
        let wires = 0
        let icons = 0
        let threw = 0
        let positionChecksum = 0
        let modelPositionChecksum = 0
        let serializedHash = 5381

        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? loaded.lastBookIndex + 1 : 1

            for (let i = 0; i < count; i++) {
                const bp = isBook ? loaded.selectBlueprint(i) : loaded
                blueprints += 1

                for (const e of bp.entities.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }
                for (const t of bp.tiles.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum + Math.round(t.x) * 11 + Math.round(t.y) * 13) | 0
                }

                let obj: any
                try {
                    obj = bp.serialize()
                } catch {
                    threw += 1
                    continue
                }

                entities += obj.entities ? obj.entities.length : 0
                tiles += obj.tiles ? obj.tiles.length : 0
                wires += obj.wires ? obj.wires.length : 0
                icons += obj.icons ? obj.icons.length : 0

                for (const e of obj.entities ?? []) {
                    positionChecksum =
                        (positionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }

                serializedHash = hashInto(serializedHash, JSON.stringify(obj))
            }
        }

        return {
            blueprints,
            entities,
            tiles,
            wires,
            icons,
            threw,
            positionChecksum,
            modelPositionChecksum,
            serializedHash,
        }
    }, sources)

    writeJson('blueprint-round-trip.EXPECTED.json', summary)
    writeTs('blueprint-round-trip.EXPECTED.ts.txt', 'const EXPECTED', summary)
})

// ------------------------------------- copied from overlay-container.spec.ts

/** Sorted distinct counts, dropping entities that never draw anything. */
function summariseOverlay(counts: Record<string, Iterable<number>>): Record<string, number[]> {
    return Object.fromEntries(
        Object.entries(counts)
            .map(([name, seen]) => [name, [...new Set(seen)].sort((a, b) => a - b)] as const)
            .filter(([, seen]) => seen.some(c => c !== -1))
            .sort(([a], [b]) => a.localeCompare(b))
    )
}

test('record overlay-container EXPECTED_REAL', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const combined: Record<string, Set<number>> = {}
    let entitiesSeen = 0

    for (const file of files) {
        await loadBlueprint(page, readBlueprintString(file.filePath))
        const tally = await page.evaluate(() => window.__fbe_test.overlayInfoTally())
        for (const [name, counts] of Object.entries(tally)) {
            entitiesSeen += counts.length
            for (const c of counts) (combined[name] ??= new Set()).add(c)
        }
    }

    console.log(`RECORDED overlay entitiesSeen=${entitiesSeen}`)
    const recorded = summariseOverlay(combined)
    writeJson('overlay-container.EXPECTED_REAL.json', recorded)
    writeTs(
        'overlay-container.EXPECTED_REAL.ts.txt',
        'const EXPECTED_REAL: Record<string, number[]>',
        recorded
    )
})

// ----------------------------------------------------------------- assemble

const HALVES = ['synthetic', 'noGrid', 'noGridReal', 'paintPreview', 'real'] as const

test.afterAll(() => {
    /*
        Refuse to write a partial file. Running a subset with --grep leaves
        halves undefined, and a sprite-data.json missing one is silently wrong
        in exactly the way the whole control exists to rule out.
    */
    const missing = HALVES.filter(k => spriteData[k] === undefined)
    if (missing.length > 0) {
        console.log(`NOT WRITING sprite-data.json - halves not recorded: ${missing.join(', ')}`)
        return
    }
    writeJson('sprite-data.json', Object.fromEntries(HALVES.map(k => [k, spriteData[k]])))
})
