import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { importTextarea } from './helpers/dialog-textareas'
import { PADDING, APPEND_Y } from '../packages/editor/src/UI/ImportDialog'
import {
    ROW_BUTTON_WIDTH,
    ROW_BUTTON_HEIGHT,
} from '../packages/editor/src/UI/controls/DescribedButton'

/*
    Append carries the appended blueprint's wires, and only those (#469).

    Editor.appendBlueprint rebound every appended entity to the blueprint on
    screen, and PaintBlueprintContainer reads its wires from the first entity's
    blueprint. So the paste took the on-screen blueprint's wires, filtered by
    the appended blueprint's entity numbers. Both sides here number their two
    combinators 1 and 2, which is what makes the numbers collide. Measured
    before the fix: the first test found 2 wires, the second 0.

    tests/paste-wires.spec.ts covers a copy inside one blueprint, where the
    entities and the wires come from the same place and this cannot show.
*/

type Page = import('@playwright/test').Page

const pair = (wired: boolean) =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            { entity_number: 1, name: 'constant-combinator', position: { x: 0.5, y: 0.5 } },
            { entity_number: 2, name: 'constant-combinator', position: { x: 2.5, y: 0.5 } },
        ],
        // 2 is the green circuit connector on a combinator's input side.
        ...(wired ? { wires: [[1, 2, 2, 2]] } : {}),
    })

const wireCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.wireCount())

const entityCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.entityContainerCount())

const editorMode = (page: Page): Promise<string> =>
    page.evaluate(() => window.__fbe_test.editorMode())

async function append(page: Page, source: string): Promise<void> {
    await page.evaluate(() => window.__fbe_test.openImportDialog())
    await importTextarea(page).fill(source)
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(
        dialog.x + PADDING + ROW_BUTTON_WIDTH / 2,
        dialog.y + APPEND_Y + ROW_BUTTON_HEIGHT / 2
    )
    await page.waitForFunction(() => window.__fbe_test.openDialogCount() === 0)
}

/** Appends, then clicks well below the loaded pair so the paste has room. */
async function appendAndPlace(page: Page, source: string): Promise<void> {
    const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(1))
    if (!at) throw new Error('no entity 1 in the loaded blueprint')
    await append(page, source)
    expect(await editorMode(page)).toBe('PAINT')
    await page.mouse.move(at.x, at.y + 220)
    await page.mouse.down()
    await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('an append brings its own wire', async ({ page }) => {
    await loadBlueprint(page, pair(false))
    expect(await wireCount(page)).toBe(0)

    await appendAndPlace(page, pair(true))

    expect(await entityCount(page)).toBe(4)
    expect(await wireCount(page)).toBe(1)
})

test('an append does not copy the loaded blueprint’s wires', async ({ page }) => {
    await loadBlueprint(page, pair(true))
    expect(await wireCount(page)).toBe(1)

    await appendAndPlace(page, pair(false))

    expect(await entityCount(page)).toBe(4)
    // The original pair's wire, and nothing on the appended pair.
    expect(await wireCount(page)).toBe(1)
})

test('appending a blueprint with no entities says so', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await loadBlueprint(page, pair(false))
    await append(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            tiles: [{ name: 'stone-path', position: { x: 0, y: 0 } }],
        })
    )

    await expect(
        page.locator('.toasts-warning', { hasText: 'no entities to append' })
    ).toBeVisible()
    expect(await editorMode(page)).toBe('NONE')
    expect(await entityCount(page)).toBe(2)
    expect(pageErrors).toEqual([])
})
