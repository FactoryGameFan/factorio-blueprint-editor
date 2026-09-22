import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    A blueprint whose wires point at entities that are not there still opens -
    issue #457.

    The unit tests in packages/editor/src/core/danglingWires.test.ts pin the
    rule: which endpoints get dropped, in which of the three shapes, and what
    the warning says. They run against a synthetic dataset and stop at the
    serialized model.

    This file is here for the part they cannot see. The defect was never in the
    model - `new Blueprint(...)` accepted a dangling endpoint quite happily. It
    threw later, in `WiresContainer.entityOf`, while initBP was drawing, and the
    user lost the whole blueprint. Only a real browser with the real Factorio
    data loaded can say that the blueprint now reaches the screen, so the
    assertions below are about containers being drawn rather than about arrays.

    The modded case is the one worth having: `stripUnknownPrototypes` removes an
    entity this build does not know, and before #457 the wire that pointed at it
    was left behind to throw. Dropping the modded entity is exactly what that
    filter exists to make possible, so a modded blueprint that could not be
    opened at all was the filter defeating itself.
*/

const VERSION = packVersion(2, 0, 55)

/** Entity 1 wired to an entity 2 the blueprint never declares. */
const HAND_WRITTEN = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [{ entity_number: 1, name: 'decider-combinator', position: { x: 0.5, y: 1 } }],
    wires: [[1, 1, 2, 1]],
})

/**
 * The same dangling wire, but made by the editor itself. `ee-infinity-loader`
 * is a Editor Extensions entity, so this build strips it and entity 2 goes.
 */
const STRIPPED_MOD = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'decider-combinator', position: { x: 0.5, y: 1 } },
        { entity_number: 2, name: 'ee-infinity-loader', position: { x: 4.5, y: 1 } },
    ],
    wires: [[1, 1, 2, 1]],
})

/** Two combinators that really are wired together, which must be left alone. */
const INTACT = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'decider-combinator', position: { x: 0.5, y: 1 } },
        { entity_number: 2, name: 'decider-combinator', position: { x: 4.5, y: 1 } },
    ],
    wires: [[1, 1, 2, 1]],
})

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

/** Loads through the real path and reports what reached the editor. */
async function load(page: import('@playwright/test').Page, source: string) {
    return page.evaluate(async src => {
        const t = window.__fbe_test
        try {
            await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        } catch (e) {
            return { failed: e instanceof Error ? e.message : String(e) }
        }
        return { containers: t.entityContainerCount(), encoded: await t.encodeLoaded() }
    }, source)
}

test('a hand-written dangling wire no longer loses the blueprint', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await load(page, HAND_WRITTEN)

    // Before #457 this threw 'Wire connects to entity 2, which is not in the blueprint'.
    expect(result.failed).toBeUndefined()
    expect(result.containers).toBe(1)
    // The entity survives and the wire does not come back out.
    const exported = decodeBlueprintString(result.encoded as string).blueprint
    expect(exported.entities).toHaveLength(1)
    expect(exported.wires ?? []).toEqual([])

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a wire to a stripped modded entity no longer loses the blueprint', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await load(page, STRIPPED_MOD)

    expect(result.failed).toBeUndefined()
    // The known entity is drawn; the modded one is gone, as the filter intends.
    expect(result.containers).toBe(1)
    const exported = decodeBlueprintString(result.encoded as string).blueprint
    expect(exported.entities).toHaveLength(1)
    expect(exported.entities[0].name).toBe('decider-combinator')
    expect(exported.wires ?? []).toEqual([])

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The control, and the reason it is not redundant with the unit tests: those
    assert an array survives serialization, this asserts the wire is still drawn.
    Without it, "drops dangling wires" and "drops wires" look the same here.
*/
test('a wire between two present entities is still loaded and drawn', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await load(page, INTACT)

    expect(result.failed).toBeUndefined()
    expect(result.containers).toBe(2)
    const exported = decodeBlueprintString(result.encoded as string).blueprint
    expect(exported.wires).toEqual([[1, 1, 2, 1]])

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The user-facing half. A ?source= link with a dangling wire used to leave the
    page stuck behind its loading overlay; after the rollback change it reported
    a failure and loaded nothing. It should now just open the blueprint, with the
    dropped wire named in a warning rather than as an error.
*/
test('a ?source= link with a dangling wire opens the blueprint and warns', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await page.goto(`/?source=${encodeURIComponent(STRIPPED_MOD)}`)
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    await expect(page.locator('#loadingScreen')).not.toHaveClass(/\bactive\b/)
    await expect(
        page.locator('.toasts-text', { hasText: 'Blueprint string could not be loaded.' })
    ).toHaveCount(0)
    await expect(
        page.locator('.toasts-text', { hasText: 'Skipped 1 wire to a missing entity' })
    ).toBeVisible()

    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
