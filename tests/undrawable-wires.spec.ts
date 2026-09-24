import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString,
    encodeBlueprint,
    encodeBlueprintBook,
    packVersion,
} from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    A wire to a connection point its entity does not have no longer loses the
    blueprint - issue #488.

    packages/editor/src/core/undrawableWires.test.ts pins the rule against a
    synthetic dataset. This file is for what that cannot see: the throw was in
    `WiresContainer.getWireSprite`, while initBP was drawing, so only a real
    browser with the real Factorio data can say the blueprint now reaches the
    screen, and that the user is told what was left out.

    The lab is the case a real export reaches. Factorio 2.1 gave labs a circuit
    connector, and the 2.0 data this editor ships has none, so a 2.1 book with a
    lab wired to a substation had a page that would not open at all.
*/

const VERSION = packVersion(2, 0, 55)

const SUBSTATION = { entity_number: 1, name: 'substation', position: { x: 1, y: 1 } }
const LAB = { entity_number: 2, name: 'lab', position: { x: 5.5, y: 1.5 } }
const CHEST = { entity_number: 2, name: 'wooden-chest', position: { x: 4.5, y: 0.5 } }

/** A red wire from a substation to a lab, as a 2.1 export writes it. */
const LAB_WIRE = {
    item: 'blueprint',
    version: VERSION,
    label: 'lab wire',
    entities: [SUBSTATION, LAB],
    wires: [[1, 1, 2, 1]],
}

/** The same wire to a chest, which has a red connection point. */
const CHEST_WIRE = {
    item: 'blueprint',
    version: VERSION,
    entities: [SUBSTATION, CHEST],
    wires: [[1, 1, 2, 1]],
}

const WARNING = 'Skipped 1 wire to connection points that do not exist'

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

async function load(page: import('@playwright/test').Page, source: string) {
    return page.evaluate(async src => {
        const t = window.__fbe_test
        try {
            await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        } catch (e) {
            return { failed: e instanceof Error ? e.message : String(e) }
        }
        return {
            containers: t.entityContainerCount(),
            wires: t.wireCount(),
            encoded: await t.encodeLoaded(),
        }
    }, source)
}

test('a red wire to a lab no longer loses the blueprint', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await load(page, encodeBlueprint(LAB_WIRE))

    // Before #488 this threw 'Could not find the wire connection point!'.
    expect(result.failed).toBeUndefined()
    expect(result.containers).toBe(2)
    expect(result.wires).toBe(0)
    const exported = decodeBlueprintString(result.encoded as string).blueprint
    expect(exported.entities).toHaveLength(2)
    expect(exported.wires ?? []).toEqual([])
    await expect(page.locator('.toasts-text', { hasText: WARNING })).toBeVisible()

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The control. Without it, "drops wires it cannot draw" and "drops wires" look
    the same here.
*/
test('the same wire to a chest is still loaded and drawn', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const result = await load(page, encodeBlueprint(CHEST_WIRE))

    expect(result.failed).toBeUndefined()
    expect(result.wires).toBe(1)
    const exported = decodeBlueprintString(result.encoded as string).blueprint
    expect(exported.wires).toEqual([[1, 1, 2, 1]])
    await expect(page.locator('.toasts-text', { hasText: 'Skipped' })).toHaveCount(0)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    A book page is built when it is selected, after decode has already reported
    its warnings, so this is the path that shows whether the warning reaches the
    user at all for a book - which is how the real case arrived.
*/
test('a book page with a lab wire opens and says what it left out', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const book = encodeBlueprintBook({
        item: 'blueprint-book',
        version: VERSION,
        active_index: 0,
        blueprints: [
            { index: 0, blueprint: CHEST_WIRE },
            { index: 1, blueprint: LAB_WIRE },
        ],
    })
    expect((await load(page, book)).failed).toBeUndefined()
    await expect(page.locator('.toasts-text', { hasText: 'Skipped' })).toHaveCount(0)

    const selected = await page.evaluate(async () => {
        try {
            await window.__fbe_test.selectBookIndex(1)
            return 'selected'
        } catch (e) {
            return e instanceof Error ? e.message : String(e)
        }
    })
    expect(selected).toBe('selected')
    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(2)
    await expect(page.locator('.toasts-text', { hasText: WARNING })).toBeVisible()

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
