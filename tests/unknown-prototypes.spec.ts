import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'

/*
    A blueprint can name a prototype this build of the editor does not have - a
    mod's entity, a tile from a Factorio version newer than the exporter ran
    against, a hand-edited string. bpString drops what it cannot resolve and warns
    rather than failing the load, and this pins that for each kind of name a
    blueprint carries, because the two were not handled the same way: entities
    were filtered and tiles were not, so an unknown tile took the whole load down
    on `FD.tiles[name].variants` (issue #46).

    Synthetic blueprints, because the corpus cannot hold this case: an unknown name
    is by definition one that is not in data.json, and every blueprint in
    wormeyman-tests/ loads clean today.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

/** Current, so no name migration applies - see nameMigrations.ts. */
const VERSION = packVersion(2, 0, 55)

interface Loaded {
    entities: string[]
    tiles: string[]
    warnings: string[]
    errors: string[]
}

async function load(
    page: import('@playwright/test').Page,
    blueprint: Record<string, unknown>
): Promise<Loaded> {
    const warnings: string[] = []
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'warning') warnings.push(m.text())
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const loaded = await page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        const bp = await api.getBlueprintOrBookFromSource(str)
        // loadBp is what emits the warnings, and rendering is where an
        // unresolvable name actually throws.
        await api.loadBp(bp)
        return {
            entities: [...bp.entities.values()].map((e: any) => e.name).sort(),
            tiles: [...bp.tiles.values()].map((t: any) => t.name).sort(),
        }
    }, encodeBlueprint(blueprint))

    return { ...loaded, warnings, errors }
}

test('an unknown entity is dropped and named in a warning', async ({ page }) => {
    const loaded = await load(page, {
        item: 'blueprint',
        version: VERSION,
        entities: [
            { entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 } },
            { entity_number: 2, name: 'ee-infinity-loader', position: { x: 20.5, y: 0.5 } },
        ],
    })

    expect(loaded.entities).toEqual(['inserter'])
    expect(loaded.warnings.join(' | ')).toContain('ee-infinity-loader')
    expect(loaded.errors, `page errors: ${loaded.errors.join(' | ')}`).toEqual([])
})

test('an unknown tile is dropped and named in a warning', async ({ page }) => {
    const loaded = await load(page, {
        item: 'blueprint',
        version: VERSION,
        tiles: [
            { name: 'refined-concrete', position: { x: 0, y: 0 } },
            // grass-1 is the realistic case: a real Factorio tile until 0.17.10,
            // so a genuinely old string can carry it, and not in FD today.
            { name: 'grass-1', position: { x: 1, y: 0 } },
        ],
    })

    expect(loaded.tiles).toEqual(['refined-concrete'])
    expect(loaded.warnings.join(' | ')).toContain('grass-1')
    expect(loaded.errors, `page errors: ${loaded.errors.join(' | ')}`).toEqual([])
})

test('a blueprint of nothing but unknown names still loads', async ({ page }) => {
    /*
        The empty-after-stripping case reaches Blueprint with no entities and no
        tiles, which is the same shape as a blank editor and must not be an error.
    */
    const loaded = await load(page, {
        item: 'blueprint',
        version: VERSION,
        entities: [{ entity_number: 1, name: 'ee-infinity-loader', position: { x: 0.5, y: 0.5 } }],
        tiles: [{ name: 'grass-1', position: { x: 0, y: 0 } }],
    })

    expect(loaded.entities).toEqual([])
    expect(loaded.tiles).toEqual([])
    expect(loaded.errors, `page errors: ${loaded.errors.join(' | ')}`).toEqual([])
})
