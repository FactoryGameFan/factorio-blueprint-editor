import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    encodeBlueprintBook as encodeBook,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { PADDING, LINK_Y } from '../packages/editor/src/UI/ExportDialog'
import {
    ROW_BUTTON_WIDTH,
    ROW_BUTTON_HEIGHT,
} from '../packages/editor/src/UI/controls/DescribedButton'

/*
    Share links in the fragment, `/#source=<string>` (#570).

    The reading rules are unit tested in tests/source-params.test.ts. What this
    adds is the page: that the startup load reads the fragment at all, that a
    second link in the same tab loads even though a fragment change does not
    reload the page, and that ExportDialog's button writes a link that loads.

    Entity counts name the blueprint: one chest, two, or three.
*/

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

type Page = import('@playwright/test').Page

const VERSION = version(2, 0, 55)
const ICONS = [{ index: 1, signal: { type: 'item', name: 'steel-chest' } }]

function chests(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        entity_number: i + 1,
        name: 'steel-chest',
        position: { x: i + 0.5, y: 0.5 },
    }))
}

const ONE = encode({ item: 'blueprint', version: VERSION, icons: ICONS, entities: chests(1) })
const TWO = encode({ item: 'blueprint', version: VERSION, icons: ICONS, entities: chests(2) })

/** Entry i holds i+1 chests, and the book is saved open on the third. */
const BOOK = encodeBook({
    item: 'blueprint-book',
    version: VERSION,
    active_index: 2,
    blueprints: [0, 1, 2].map(index => ({
        index,
        blueprint: {
            item: 'blueprint',
            version: VERSION,
            icons: ICONS,
            entities: chests(index + 1),
        },
    })),
})

/** Opens `path` as a fresh page load and waits for the startup load to finish. */
async function openFresh(page: Page, path: string): Promise<void> {
    await page.goto(path)
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
}

const entityCount = (page: Page) => page.evaluate(() => window.__fbe_test.entityContainerCount())

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
})

test('a fragment link loads its blueprint', async ({ page }) => {
    await openFresh(page, `/#source=${TWO}`)
    expect(await entityCount(page)).toBe(2)
})

test('a book link opens on the page it was saved on', async ({ page }) => {
    await openFresh(page, `/#source=${BOOK}`)
    expect(await entityCount(page)).toBe(3)
})

test('the query wins over the fragment', async ({ page }) => {
    await openFresh(page, `/?source=${encodeURIComponent(ONE)}#source=${TWO}`)
    expect(await entityCount(page)).toBe(1)
})

test('a second link in the same tab loads without a reload', async ({ page }) => {
    await openFresh(page, `/#source=${ONE}`)
    expect(await entityCount(page)).toBe(1)
    // A marker that a reload would wipe, so a pass cannot come from one.
    await page.evaluate(() => ((window as any).__share_link_same_document = true))

    await page.evaluate(bp => (window.location.hash = `source=${bp}`), TWO)
    await page.waitForFunction(() => window.__fbe_test.entityContainerCount() === 2)
    expect(await page.evaluate(() => (window as any).__share_link_same_document)).toBe(true)
})

test("Export's Copy link button copies a link that loads the blueprint", async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(page, TWO)
    await page.evaluate(() => navigator.clipboard.writeText('before'))

    await page.evaluate(() => window.__fbe_test.openExportDialog())
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    await page.mouse.click(
        dialog.x + PADDING + ROW_BUTTON_WIDTH / 2,
        dialog.y + LINK_Y + ROW_BUTTON_HEIGHT / 2
    )
    await page.waitForFunction(() => navigator.clipboard.readText().then(t => t !== 'before'))

    const link = await page.evaluate(() => navigator.clipboard.readText())
    const url = new URL(link)
    expect(url.origin).toBe(new URL(page.url()).origin)
    expect(url.search).toBe('')
    expect(url.hash.startsWith('#source=0')).toBe(true)
    expect(
        decodeBlueprintString(url.hash.slice('#source='.length)).blueprint.entities
    ).toHaveLength(2)

    const fresh = await page.context().newPage()
    await suppressOverlays(fresh)
    await openFresh(fresh, link)
    expect(await entityCount(fresh)).toBe(2)
})

test('an empty blueprint gives no link', async ({ page }) => {
    await waitForEditor(page)
    await page.evaluate(() => navigator.clipboard.writeText('before'))
    expect(await page.evaluate(() => window.__fbe_test.copyShareLink())).toBeUndefined()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before')
})
