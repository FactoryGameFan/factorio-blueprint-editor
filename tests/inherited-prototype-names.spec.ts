import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    A prototype name that every JavaScript object already answers to.

    The strip filter in bpString.ts asks `FD.tiles[name]` and `FD.entities[name]`
    whether a name is known, and the schema keywords ask the same way. On a
    collection JSON.parse made, those reads were truthy for `toString`,
    `__proto__`, `constructor` and the other names on Object.prototype, so a
    blueprint using them validated clean, was stripped of nothing, and threw
    later - a tile inside initBP, an entity while being built. loadData now
    gives each collection a null prototype, so these names are unknown like
    any other.

    Current version, so no name migration applies - see nameMigrations.ts.
*/
const VERSION = packVersion(2, 0, 55)

const CASES = [
    {
        label: 'tiles named toString and __proto__',
        blueprint: {
            tiles: [
                { name: 'stone-path', position: { x: 0, y: 0 } },
                { name: 'toString', position: { x: 1, y: 0 } },
                { name: '__proto__', position: { x: 2, y: 0 } },
            ],
            entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 3.5 } }],
        },
        warning: 'Skipped 2 unknown tiles: toString, __proto__',
    },
    {
        label: 'an entity named constructor',
        blueprint: {
            entities: [
                { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
                { entity_number: 2, name: 'constructor', position: { x: 4.5, y: 0.5 } },
            ],
        },
        warning: 'Skipped 1 unknown entity: constructor',
    },
]

for (const { label, blueprint, warning } of CASES) {
    test(`strips and reports ${label} like any unknown prototype`, async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', e => errors.push(String(e)))
        await waitForEditor(page)

        await loadBlueprint(
            page,
            encodeBlueprint({ item: 'blueprint', version: VERSION, ...blueprint })
        )

        await expect(
            page.locator('.toasts-warning .toasts-text', { hasText: warning })
        ).toBeVisible()

        // What a copy would export: the real names survive, the inherited ones do not.
        const exported = decodeBlueprintString(
            await page.evaluate(() => window.__fbe_test.encodeLoaded())
        ).blueprint
        expect((exported.entities ?? []).map((e: { name: string }) => e.name)).toEqual([
            'wooden-chest',
        ])
        expect((exported.tiles ?? []).map((t: { name: string }) => t.name)).toEqual(
            blueprint.tiles ? ['stone-path'] : []
        )
        expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    })
}
