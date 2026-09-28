import { test, expect } from '@playwright/test'
import { decodeBlueprintString } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    A quality-only inserter filter (issue #493): `{ index, quality, comparator }`
    and no item name, which a 2.0 inserter really holds. It loaded and exported
    unchanged, but two writes treated a filter with no name as an empty slot and
    dropped it - `pasteSettings`, which kept only names the target accepts, and
    the `filters` setter, which kept only slots with a name. The filter dialog
    goes through that setter with every slot whenever one changes, so touching
    any slot of an inserter holding one lost it too.

    The blueprint is the issue's own string: two bulk inserters, entity 1 with
    the quality-only filter and entity 2 with none.
*/

type Page = import('@playwright/test').Page

const ISSUE_493 =
    '0eJyNjtFKw0AQRf/lPk+LlqQ2A36JhLKpowxudtPdWWkI++/SFKSiDz6eC/dwFgy+yJQ0GHiBmozgu43wKSlrDOB2v+uarmsPzf6pPTQEPcWQwS8LNLzKBfxIyPoenL+qbJ4EfDMSghuvNBT/sdGQJZkk1NoTJJiayk20wnwMZRwkrcI/j4QpZrU1a8EFvNltW8IMfti2lVCyHN/Um6QMtlSE8I0/cs/FebUZjBDT6DwIpzhOLjmLCYxn1L7Sr67df7vus2pf6xdIAnms'

const QUALITY_ONLY = [{ index: 1, quality: 'normal', comparator: '=' }]

/*
    InserterEditor puts its Filters component at (208, 70), and Filters lays
    its slots out on a 38px pitch, each 36px square, in one row - a bulk
    inserter has five. Mirrors tests/chest-editor.spec.ts's constants.
*/
const FILTERS_X = 208
const FILTERS_Y = 70
const SLOT_PITCH = 38
const SLOT_CENTRE = 18

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/** As tests/paste-entity-settings.spec.ts: waits for the editor to agree it is hovered. */
async function hoverEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await screenOf(page, entityNumber)
    await page.mouse.move(at.x, at.y)
    await page.waitForFunction(n => window.__fbe_test.hoveredEntityNumber() === n, entityNumber, {
        timeout: 10_000,
    })
}

async function pasteSettings(page: Page, from: number, to: number): Promise<void> {
    await hoverEntity(page, from)
    await page.keyboard.down('Shift')
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    await hoverEntity(page, to)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
}

/** Right-clicks filter slot `index` (0-based) in the inserter dialog for `entityNumber`. */
async function clearSlot(page: Page, entityNumber: number, index: number): Promise<void> {
    // Stepping off first, because hover only updates when the pointer crosses a
    // tile boundary - see openEditorOn in tests/chest-editor.spec.ts.
    const at = await screenOf(page, entityNumber)
    await page.mouse.move(at.x, at.y + 240)
    await hoverEntity(page, entityNumber)
    await page.mouse.down()
    await page.mouse.up()
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)

    // Two frames, so pixi has given the new dialog a world transform to hit-test
    // against - see renderedDialogBounds in tests/chest-editor.spec.ts.
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
    )
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(
        dialog.x + FILTERS_X + index * SLOT_PITCH + SLOT_CENTRE,
        dialog.y + FILTERS_Y + SLOT_CENTRE,
        { button: 'right' }
    )
}

const filtersOf = (page: Page, entityNumber: number) =>
    page.evaluate((n: number) => window.__fbe_test.entityFilters(n), entityNumber)

async function exportedFilters(page: Page, entityNumber: number): Promise<unknown> {
    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const { entities } = decodeBlueprintString(source).blueprint
    return entities.find((e: { entity_number: number }) => e.entity_number === entityNumber).filters
}

let errors: string[] = []

test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, ISSUE_493)
    expect(await filtersOf(page, 1)).toEqual(QUALITY_ONLY)
})

test.afterEach(() => {
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a paste carries a quality-only filter', async ({ page }) => {
    await pasteSettings(page, 1, 2)

    expect(await filtersOf(page, 2)).toEqual(QUALITY_ONLY)
    expect(await exportedFilters(page, 2)).toEqual(QUALITY_ONLY)
    // and the source is left as it was
    expect(await exportedFilters(page, 1)).toEqual(QUALITY_ONLY)
})

test('editing another slot in the dialog keeps a quality-only filter', async ({ page }) => {
    // Clearing an empty slot still sends every slot back through the setter.
    await clearSlot(page, 1, 1)

    expect(await filtersOf(page, 1)).toEqual(QUALITY_ONLY)
    expect(await exportedFilters(page, 1)).toEqual(QUALITY_ONLY)
})

test('clearing its own slot in the dialog removes a quality-only filter', async ({ page }) => {
    // The control for the one above: the slot is not stuck, it clears like a
    // named filter does.
    await clearSlot(page, 1, 0)

    expect(await filtersOf(page, 1)).toEqual([])
})
