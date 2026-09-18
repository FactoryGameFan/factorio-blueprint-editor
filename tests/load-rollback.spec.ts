import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    A blueprint that decodes but fails to load must leave the editor as it was.

    The failure here is a wire naming an entity the blueprint does not have.
    Nothing checks wire endpoints against the entity set on decode, so it gets
    as far as initBP and throws in WiresContainer. That is a real input - an
    author can write one, and the unknown-prototype strip filter makes one out
    of any wire to a modded entity - and it throws *after* initBP has already
    built a container for every entity.

    Four things have to go back, and each assertion below is one of them:
    G.bp (entityPosition), the static EntityContainer.mappings index
    (entityContainerCount, entityInfoVisible), the website's own bp and book
    (encodeLoaded, which is what Ctrl+C exports), and G.BPC being the container
    on stage (createEntity lands in the blueprint that is drawn).
*/

const VERSION = packVersion(2, 0, 55)

/*
    Two chests far enough apart that loading re-centres entity 1 somewhere other
    than where the failing blueprint's entity 1 would land.
*/
const LOADED = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 8.5, y: 0.5 } },
    ],
})

/*
    Entity 1 only, with a red wire to an entity 2 that does not exist. Sharing
    the number 1 with LOADED is deliberate: it is the case where the half-built
    container overwrites an entry in the static index.
*/
const DANGLING_WIRE = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
    wires: [[1, 1, 2, 1]],
})

const THROWN = 'Wire connects to entity 2, which is not in the blueprint'

async function snapshot(page: import('@playwright/test').Page) {
    return page.evaluate(async () => {
        const t = window.__fbe_test
        return {
            encoded: await t.encodeLoaded(),
            position: t.entityPosition(1),
            containers: t.entityContainerCount(),
        }
    })
}

test('a blueprint that fails in initBP leaves the loaded one in place', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await waitForEditor(page)
    await loadBlueprint(page, LOADED)
    const before = await snapshot(page)
    expect(before.containers).toBe(2)

    // The error first, so a load that silently succeeded cannot pass as a rollback.
    const failure = await page.evaluate(async src => {
        const t = window.__fbe_test
        try {
            await t.loadBp(await t.getBlueprintOrBookFromSource(src))
            return 'loaded'
        } catch (e) {
            return e instanceof Error ? e.message : String(e)
        }
    }, DANGLING_WIRE)
    expect(failure).toContain(THROWN)

    expect(await snapshot(page)).toEqual(before)

    // Every entity of the blueprint on screen still has its container.
    expect(
        await page.evaluate(() => [1, 2].map(n => typeof window.__fbe_test.entityInfoVisible(n)))
    ).toEqual(['boolean', 'boolean'])

    // And the editor is live on it: a new entity is drawn and exported.
    await page.evaluate(() => window.__fbe_test.createEntity('wooden-chest', 0.5, 6.5))
    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(3)
    const exported = decodeBlueprintString(
        await page.evaluate(() => window.__fbe_test.encodeLoaded())
    ).blueprint
    expect(exported.entities).toHaveLength(3)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a ?source= blueprint that fails in initBP still brings the editor up', async ({ page }) => {
    const errors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.goto(`/?source=${encodeURIComponent(DANGLING_WIRE)}`)
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    // The failure is reported, through the catch-all rather than the corrupt-string arm.
    await expect(
        page.locator('.toasts-text', { hasText: 'Blueprint string could not be loaded.' })
    ).toBeVisible()
    expect(consoleErrors.join('\n')).toContain(THROWN)

    // The overlay comes down, and what is loaded is an empty, usable blueprint.
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/\bactive\b/)
    expect(await page.evaluate(() => window.__fbe_test.exportGuardResult())).toEqual({
        exportString: false,
        exportImage: false,
    })
    await page.evaluate(() => window.__fbe_test.createEntity('wooden-chest', 0.5, 0.5))
    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
