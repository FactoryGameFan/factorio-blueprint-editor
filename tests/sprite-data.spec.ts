import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { loadBlueprint, waitForEditor, SpriteDataTally } from './helpers/fbe-test-api'

/*
    Coverage net for spriteDataBuilder's draw_* functions, ahead of clearing its
    82 strictNullChecks errors (issue #22).

    sprite-generation.spec.ts already pins which entities fail to generate sprites
    at all, which catches a read turned into a throw. It says nothing about what
    the ones that succeed produced, and that is the hole this fills: a read turned
    into a skip, a `?? []`, or a layers array swapped for the single sprite that
    held it all leave the entity generating sprites - just fewer, or different
    ones - and nothing in the suite notices. getSpriteData's try/catch means even
    the throw case only ever reaches a log line.

    The digest is "<layer count>:<hash>" per placement. The count is the readable
    half and is what moves when a layer is dropped or added; the hash covers the
    fields that decide where each layer lands, so a shift or sheet-offset change
    shows up too. See spriteDataTally in packages/website/src/index.ts.

    All four fixtures are fixed points, not snapshots to regenerate. A diff means
    the sprites for that entity changed - review it as a rendering change.

    One thing to know before adding a test here: EntitySprite.getParts fills in
    `filename` from `filenames` on the sprite objects, which for most draw
    functions are the prototype objects out of data.json rather than copies. So
    rendering a blueprint mutates state the digest reads. Each test gets a fresh
    page, so a fixture is stable for the test as written - but adding a
    loadBlueprint call to a test that did not have one will move its fixture, and
    that is why, not a rendering regression.
*/

/** Cardinals only, matching sprite-generation.spec.ts - see the note there. */
const DIRECTIONS = [0, 4, 8, 12]

/*
    tests/__fixtures__/sprite-data.json holds both halves, out of line only
    because there are ~1500 digests. It is a fixed point, NOT a snapshot to
    regenerate: a diff means the sprites changed for that entity, and the change
    is what wants reviewing. There is deliberately no way to re-record it.

    Some entries record known-wrong behaviour rather than correct behaviour, so
    do not "fix" them by editing the file: dummy-rail-ramp and dummy-rail-support
    generate no layers at all ("0:..."), and railgun-turret is "FAILED" in both
    real halves because util.getDirName throws for the diagonal facings (2 and
    14) the corpus places it at.
*/
const EXPECTED: {
    synthetic: Record<string, string[]>
    noGrid: Record<string, string[]>
    noGridReal: Record<string, string[]>
    paintPreview: Record<string, string[]>
    real: Record<string, string[]>
} = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'tests/__fixtures__/sprite-data.json'), 'utf8')
)

type Page = import('@playwright/test').Page

async function tallyFor(page: Page, source: string): Promise<SpriteDataTally> {
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.spriteDataTally())
}

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

test('every entity generates the sprite data it generated before', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const { source, names } = buildAllEntitiesBlueprint(DIRECTIONS)
    expect(names.length).toBeGreaterThan(100)

    expect(summarise(await tallyFor(page, source))).toEqual(EXPECTED.synthetic)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    The entity editor preview and the paint preview both draw an entity with no
    position grid, and the paint one also with no position and no direction. That
    is a third set of branches - every `if (data.positionGrid)` else-path, plus
    whatever EntitySprite.getDrawData defaults the missing fields to - and
    nothing else in the suite reaches them.

    Both corpora are needed here for a reason the grid tests do not have: the
    synthetic entities carry no wires, so `generateConnector` is false for all of
    them and the circuit connector branch never runs. The real bases are the only
    place a wired belt gets drawn without a grid.
*/
async function noGridTally(page: Page): Promise<SpriteDataTally> {
    const { source } = buildAllEntitiesBlueprint(DIRECTIONS)
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.spriteDataTally(undefined, { withGrid: false }))
}

test('every entity generates the same sprite data with no position grid', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    expect(summarise(await noGridTally(page))).toEqual(EXPECTED.noGrid)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('real blueprints generate the same sprite data with no position grid', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

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

    expect(summarise(tally)).toEqual(EXPECTED.noGridReal)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    PaintEntityContainer draws from a bare `{ name, direction, directionType }` -
    no Entity, so no position, no grid, no generateConnector, no modules. It is
    the only caller that reaches EntitySprite.getDrawData's defaults; every other
    one hands over an Entity that supplies each field, which means the tests
    above cannot see a wrong default at all.
*/
test('the paint preview generates the sprite data it generated before', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    // The trailing undefined omits `direction`, which is the only thing that
    // exercises getDrawData's `dir` default.
    const tally = await page.evaluate(dirs => window.__fbe_test.paintPreviewTally(dirs), [
        ...DIRECTIONS,
        undefined,
    ] as (number | undefined)[])

    expect(Object.keys(tally).length).toBeGreaterThan(100)
    /*
        Not summarised: one digest per entry of the directions array, in order,
        so the last one is the omitted-direction case. Collapsing to a set would
        hide a wrong `dir` default whose value happens to be one of the four
        cardinals already in the list.
    */
    expect(sortKeys(tally)).toEqual(EXPECTED.paintPreview)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    The synthetic blueprint spaces entities out so none of them touch, so it never
    reaches the branches that read neighbours - pipe junctions, belt corners,
    underground pairs, heat pipe and wall connection sprites, gate rail bases.
    Those are a large part of the file, which is why the real bases carry the
    other half of the coverage here, same as in sprite-generation.spec.ts.
*/
test('real blueprints generate the sprite data they generated before', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))
    const { tally, blueprintCount, entitiesSeen } = await page.evaluate(
        async (strings: string[]) => {
            const api = window.__fbe_test
            const out: Record<string, string[]> = {}
            let blueprintCount = 0
            let entitiesSeen = 0

            for (const str of strings) {
                /*
                    Books are most of test-blueprints/ and loading one renders
                    only its first entry, so walk the entries directly. Each
                    carries its own position grid, populated as its entities were
                    created, which is all the neighbour branches need.
                */
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

    // Same corpus entity-accessors.spec.ts walks - see its EXPECTED.
    expect(blueprintCount).toBe(367)
    expect(entitiesSeen).toBeGreaterThan(300_000)
    expect(summarise(tally)).toEqual(EXPECTED.real)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
