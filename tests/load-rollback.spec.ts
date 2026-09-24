import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    A blueprint that decodes but fails to load must leave the editor as it was.

    The failure is a copper wire between two entities that have no copper
    connector, which throws in WiresContainer.getWireSprite *after* initBP has
    already built a container for every entity. That is what this spec needs: a
    throw late enough to have left half-built state behind.

    No blueprint string reaches that throw any more. #457 drops a wire naming a
    missing entity on decode, and #488 drops a wire to a connection point its
    entity lacks in the Blueprint constructor - which was this spec's input
    until then. A test that needs a bug to stay unfixed argues against fixing
    it, so the wire is now added by a fixture after the constructor has run:
    `armUndrawableWire` in packages/website/src/index.ts, or for the ?source=
    test, a flag set before the page's own scripts run. The throw is still the
    real one.

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
    Two chests for the armed fixture to join with a copper wire.

    Reusing entity numbers 1 and 2 from LOADED is deliberate: it is the case
    where the half-built containers overwrite the outgoing blueprint's entries
    in the static EntityContainer.mappings index. The two are also close enough
    together (x 0.5 and 2.5 against LOADED's 0.5 and 8.5) that loading this one
    would re-centre entity 1 somewhere else, so entityPosition(1) can tell a
    real rollback from a load that went through.
*/
const FAILS_IN_INIT_BP = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 2.5, y: 0.5 } },
    ],
})

const THROWN = 'Could not find the wire connection point!'

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
        t.armUndrawableWire()
        try {
            await t.loadBp(await t.getBlueprintOrBookFromSource(src))
            return 'loaded'
        } catch (e) {
            return e instanceof Error ? e.message : String(e)
        }
    }, FAILS_IN_INIT_BP)
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

    await page.addInitScript(() => {
        window.__fbe_arm_undrawable_wire = true
    })
    await page.goto(`/?source=${encodeURIComponent(FAILS_IN_INIT_BP)}`)
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
