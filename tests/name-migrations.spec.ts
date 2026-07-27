import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    The legacy prototype renames in nameMigrations.ts apply per blueprint, by the
    version each one declares. nameMigrations.test.ts covers the table and the
    thresholds as a unit; this covers the same thing through the real decode path,
    where the migrated names have to resolve against FD or bpString strips the
    entity.

    It needs synthetic blueprints because it cannot come from the corpus: every
    file in wormeyman-tests/ declares 2.0.45 or later, so nothing in it should be
    migrated at all. That is what made issue #40 invisible for so long - the
    renames were running on all 578 of them, and the two whose source names are
    live prototypes again quietly rewrote 9535 stack inserters.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const V_0_16 = version(0, 16, 51)
const V_1_1 = version(1, 1, 107)
const V_2_0 = version(2, 0, 55)

interface Loaded {
    entities: string[]
    recipes: string[]
    tiles: string[]
}

async function load(page: import('@playwright/test').Page, source: string): Promise<Loaded> {
    return page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        const bp = await api.getBlueprintOrBookFromSource(str)
        // Renders too, so a migrated name that reaches the sprite builder wrong
        // shows up as a page error rather than passing quietly.
        await api.loadBp(bp)
        const entities = [...bp.entities.values()]
        return {
            entities: entities.map((e: any): string => e.name).sort(),
            recipes: entities
                .map((e: any): string | undefined => e.recipe)
                // A predicate rather than `Boolean`: the latter narrows nothing, so
                // the result stays (string | undefined)[] and sort() has no
                // string-array exemption to claim.
                .filter((r): r is string => Boolean(r))
                .sort(),
            tiles: [...new Set([...bp.tiles.values()].map((t: any): string => t.name))].sort(),
        }
    }, source)
}

let errors: string[] = []

test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
})

test('a 2.0 blueprint keeps the names it was written with (issue #40)', async ({ page }) => {
    const loaded = await load(
        page,
        encode({
            item: 'blueprint',
            version: V_2_0,
            entities: [
                { entity_number: 1, name: 'stack-inserter', position: { x: 0.5, y: 0.5 } },
                {
                    entity_number: 2,
                    name: 'assembling-machine-2',
                    position: { x: 20.5, y: 0.5 },
                    recipe: 'fusion-reactor-equipment',
                },
            ],
        })
    )

    expect(loaded.entities).toEqual(['assembling-machine-2', 'stack-inserter'])
    expect(loaded.recipes).toEqual(['fusion-reactor-equipment'])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a pre-2.0 blueprint still gets the 2.0 renames', async ({ page }) => {
    const loaded = await load(
        page,
        encode({
            item: 'blueprint',
            version: V_1_1,
            entities: [
                { entity_number: 1, name: 'stack-inserter', position: { x: 0.5, y: 0.5 } },
                { entity_number: 2, name: 'stack-filter-inserter', position: { x: 20.5, y: 0.5 } },
                { entity_number: 3, name: 'filter-inserter', position: { x: 40.5, y: 0.5 } },
                { entity_number: 4, name: 'logistic-chest-storage', position: { x: 60.5, y: 0.5 } },
                {
                    entity_number: 5,
                    name: 'logistic-chest-passive-provider',
                    position: { x: 80.5, y: 0.5 },
                },
                { entity_number: 6, name: 'curved-rail', position: { x: 100, y: 0 }, direction: 0 },
            ],
        })
    )

    // Nothing stripped: every rename landed on a name FD still knows.
    expect(loaded.entities).toEqual([
        'bulk-inserter',
        'bulk-inserter',
        'fast-inserter',
        'legacy-curved-rail',
        'passive-provider-chest',
        'storage-chest',
    ])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a 0.16 blueprint gets the 0.17 renames as well', async ({ page }) => {
    /*
        Only the below-every-threshold case is worth loading. Whether a 1.1
        blueprint is held back from the 0.17 groups belongs to
        nameMigrations.test.ts, which can ask without rendering: the names those
        rows migrate *from* are ones FD no longer has, so a blueprint that keeps
        one is not a blueprint the editor can draw. It is also not a blueprint
        Factorio can write - grass-1 stopped existing in 0.17.10, well below the
        version such a case would have to declare.
    */
    const loaded = await load(
        page,
        encode({
            item: 'blueprint',
            version: V_0_16,
            entities: [
                {
                    entity_number: 1,
                    name: 'assembling-machine-2',
                    position: { x: 0.5, y: 0.5 },
                    recipe: 'science-pack-1',
                },
                {
                    entity_number: 2,
                    name: 'assembling-machine-2',
                    position: { x: 20.5, y: 0.5 },
                    recipe: 'high-tech-science-pack',
                },
                // A 0.17 row that drops the field rather than renaming it.
                {
                    entity_number: 3,
                    name: 'assembling-machine-2',
                    position: { x: 40.5, y: 0.5 },
                    recipe: 'steel-axe',
                },
            ],
            tiles: [{ name: 'grass-1', position: { x: 0, y: 5 } }],
        })
    )

    expect(loaded.recipes).toEqual(['automation-science-pack', 'utility-science-pack'])
    expect(loaded.tiles).toEqual(['landfill'])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
