import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Painting the two entities that cannot be mined (issue #367).

    `Entity.getItemName` used to read `minable.result` alone, and
    `captive-biter-spawner` and `space-platform-hub` are `minable: null`. The
    inventory (E) offered both, and choosing one threw "is being painted but has
    no item to place it with" from PaintEntityContainer.getItemName. They are
    the only two entities in data.json with an item that places them and no
    mining result; every other entity either has both or neither.

    This drives the pipette (Q) route rather than the inventory, the same way
    tests/editor-mode-input.spec.ts does: hover the entity, press Q. Both routes
    end in the same spawnPaintContainer -> PaintEntityContainer constructor ->
    getItemName call, and the pipette needs no dialog to click through. It is
    also the cleaner negative control. `BlueprintContainer.pipette` skips an
    entity whose getItemName is undefined, so before the fix Q did nothing and
    the mode stayed EDIT; after it the mode is PAINT.

    Measured with the fix reverted and this spec kept: both cases fail on the
    `toBe('PAINT')` line, reading EDIT.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

/*
    Both entities on one blueprint, apart so neither hover can land on the other.
    The spawner is 5x5 (collision box 4.4) and the hub 8x8 (7.8), so the spawner
    sits on a half-tile centre and the hub on a whole one.
*/
const UNMINEABLE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'captive-biter-spawner', position: { x: 2.5, y: 2.5 } },
        { entity_number: 2, name: 'space-platform-hub', position: { x: 12, y: 3 } },
    ],
})

const modeOf = (page: Page): Promise<string> =>
    page.evaluate(() => (window as any).__fbe_test.editorMode())

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

async function openEditorWithEntities(page: Page): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    const box = await page.locator(CANVAS).boundingBox()
    if (!box) throw new Error('the editor canvas has no bounding box')

    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, UNMINEABLE)
}

for (const [entityNumber, name] of [
    [1, 'captive-biter-spawner'],
    [2, 'space-platform-hub'],
] as const) {
    test(`pipette on a ${name} enters PAINT`, async ({ page }) => {
        const errors: string[] = []
        page.on('console', m => {
            if (m.type() === 'error') errors.push(m.text())
        })

        await openEditorWithEntities(page)

        const at = await screenOf(page, entityNumber)
        await page.mouse.move(at.x, at.y)
        expect(await modeOf(page)).toBe('EDIT')

        await page.keyboard.press('KeyQ')
        expect(await modeOf(page)).toBe('PAINT')
        expect(errors.join(' | ')).not.toContain('Failed to create paint container')
    })
}
