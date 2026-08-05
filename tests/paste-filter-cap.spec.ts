import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    How many filters a paste-settings carries onto a logistic chest (issue #93).

    `Entity.pasteSettings` sliced the incoming list at `Entity.filterSlots`,
    which is how many slots the *dialog draws* - and for requester and buffer
    chests that is a hardcoded 30 with a `// TODO: find a way to fix this
    properly` against it. A UI layout constant was deciding how much data
    survived a copy: a chest holding 35 requests pasted onto another arrived
    with 30, silently.

    The cap that belongs there is the game's, and it is not 30. Asked of the
    real binary rather than assumed, because #93 is about a guessed number and
    replacing it with another guess would not be an improvement -
    `tools/oracle/probe-filter-count-cap.mjs`, captured in
    `tools/oracle/fixtures/filter-count-cap.json`:

      - `max_logistic_filter_count` is 1000, and it is enforced **per section**,
        not per entity. Two sections of 1000 on one chest import cleanly.
      - Exceeding it is not survivable. A single section of 1001 filters makes
        `import_stack` return -1 and **the whole blueprint string is refused** -
        the same failure shape as the index-0 section in #91, not a truncated
        chest. That is why the write path still holds a cap at all rather than
        passing everything through.

    The corpus cannot test any of this: measured over test-blueprints/, 5995
    entities carry `request_filters` and the largest section-0 filter list in
    all 367 blueprints is **19**. Still under the old 30-slot cap and 50x under
    the real 1000, so both cases here are synthetic - but note that number went
    5 -> 19 when the corpus went public (#186), so it is closer to the old cap
    than it reads, and a corpus addition could cross it.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page
type Filter = { index: number; name: string; count?: number }

/*
    Distinct base-game item names. Distinct matters for the 35 case: the game
    keeps one filter per item name within a section (the last by index), so a
    list that repeated an item would be measuring the editor's model against a
    number the game would collapse anyway. The 1000 case cycles them, which is
    fine - nothing there asserts what Factorio would keep, only what the editor
    refuses to write past.
*/
const ITEMS = [
    'iron-plate',
    'copper-plate',
    'steel-plate',
    'iron-gear-wheel',
    'copper-cable',
    'electronic-circuit',
    'advanced-circuit',
    'processing-unit',
    'coal',
    'stone',
    'iron-ore',
    'copper-ore',
    'stone-brick',
    'concrete',
    'pipe',
    'pipe-to-ground',
    'transport-belt',
    'fast-transport-belt',
    'express-transport-belt',
    'underground-belt',
    'splitter',
    'inserter',
    'fast-inserter',
    'long-handed-inserter',
    'bulk-inserter',
    'burner-inserter',
    'small-electric-pole',
    'medium-electric-pole',
    'big-electric-pole',
    'substation',
    'assembling-machine-1',
    'assembling-machine-2',
    'assembling-machine-3',
    'electric-furnace',
    'steel-furnace',
    'stone-furnace',
    'radar',
    'accumulator',
    'solar-panel',
    'battery',
]

/** `n` filters in the full shape Factorio writes, numbered from 1. */
const filtersOfLength = (n: number): Filter[] =>
    Array.from({ length: n }, (_, i) => ({
        index: i + 1,
        name: ITEMS[i % ITEMS.length],
        quality: 'normal',
        comparator: '=',
        count: 1,
    }))

/**
 * Two requester chests side by side: entity 1 holds `count` filters, entity 2
 * holds none - the field absent rather than empty, which is what a freshly
 * placed chest looks like.
 */
const twoChests = (count: number): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            {
                entity_number: 1,
                name: 'requester-chest',
                position: { x: 0.5, y: 0.5 },
                request_filters: {
                    sections: [{ index: 1, filters: filtersOfLength(count) }],
                },
            },
            { entity_number: 2, name: 'requester-chest', position: { x: 2.5, y: 0.5 } },
        ],
    })

async function openEditorWith(page: Page, source: string): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.locator(CANVAS).waitFor()
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
}

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

const filtersOf = (page: Page, entityNumber: number): Promise<Filter[] | undefined> =>
    page.evaluate((n: number) => window.__fbe_test.entityFilters(n), entityNumber)

/** Copies settings off one entity onto another with real input, as #64's spec does. */
async function pasteSettings(page: Page, from: number, to: number): Promise<void> {
    const source = await screenOf(page, from)
    const target = await screenOf(page, to)

    await page.mouse.move(source.x, source.y)
    await page.keyboard.down('Shift')
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
}

test('a paste carries every filter the source had, not the 30 the dialog draws', async ({
    page,
}) => {
    /*
        35 is chosen to sit just past the old cap: enough that the truncation is
        unambiguous, few enough that every filter is a distinct item and so
        would survive in the game as well as in the model.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditorWith(page, twoChests(35))
    expect(await filtersOf(page, 1)).toHaveLength(35)
    expect(await filtersOf(page, 2)).toEqual([])

    await pasteSettings(page, 1, 2)

    /*
        The error check comes first for the reason #64's spec gives: an empty
        target is equally what a shift-click that missed would leave, so a
        filter assertion alone cannot tell a broken paste from a gesture that
        never landed.
    */
    expect(errors).toEqual([])

    const pasted = await filtersOf(page, 2)
    expect(pasted).toHaveLength(35)
    // and they are the source's, in order, rather than 35 of something
    expect(pasted?.map(f => f.name)).toEqual(filtersOfLength(35).map(f => f.name))
    expect(pasted?.map(f => f.index)).toEqual(filtersOfLength(35).map(f => f.index))
})

test('a paste stops at the per-section cap Factorio enforces', async ({ page }) => {
    /*
        1005 in, 1000 out. The cap is real and the consequence of breaking it is
        the whole exported string being refused on import, so this is the one
        place the editor should still be dropping data on the floor.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditorWith(page, twoChests(1005))
    expect(await filtersOf(page, 1)).toHaveLength(1005)

    await pasteSettings(page, 1, 2)

    expect(errors).toEqual([])
    expect(await filtersOf(page, 2)).toHaveLength(1000)
})
