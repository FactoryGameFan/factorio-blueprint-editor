import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    decodeBlueprintString as decode,
    packVersion as version,
} from './helpers/encode-blueprint'

/*
    The two places in Blueprint.ts that rewrite a pre-2.0 shape into a 2.0
    `LogisticSections` object (issue #89):

        Blueprint.ts:247  control_behavior.filters -> control_behavior.sections
                          (constant combinators)
        Blueprint.ts:316  request_filters as a flat array -> request_filters.sections
                          (logistic chests)

    Neither had any coverage at all before this spec, and the corpus cannot give
    it any: measured over wormeyman-tests/, no blueprint carries
    `control_behavior.filters` and none carries `request_filters` as an array -
    every one of them is 2.0.45 or later and already in the new shape. So both
    migrations were dead code as far as the suite was concerned, and could have
    been broken or deleted with everything green.

    Note the two are gated differently, which is easy to misread:

    - the chest one is version-gated, and *throws* if it meets an array in a
      blueprint that is not pre-2.0
    - the combinator one is shape-gated only, on `filters` being present and
      `sections` absent, so it runs at any declared version

    Both are asserted twice over - against the serialized output, which is the
    only place the section's own `index` is visible, and against the model,
    since a migration that produces a well-formed object no reader can use is
    no better than one that produces nothing.
*/

const PRE_2_0 = version(1, 1, 109)

/** A pre-2.0 constant combinator, holding its signals in the old flat `filters`. */
const OLD_COMBINATOR = encode({
    item: 'blueprint',
    version: PRE_2_0,
    icons: [{ index: 1, signal: { type: 'item', name: 'constant-combinator' } }],
    entities: [
        {
            entity_number: 1,
            name: 'constant-combinator',
            position: { x: 0.5, y: 0.5 },
            control_behavior: {
                filters: [
                    { index: 1, count: 5, signal: { type: 'item', name: 'iron-plate' } },
                    { index: 2, count: -3, signal: { type: 'virtual', name: 'signal-A' } },
                ],
            },
        },
    ],
})

/** A pre-2.0 requester chest, holding its requests in the old flat array. */
const OLD_CHEST = encode({
    item: 'blueprint',
    version: PRE_2_0,
    icons: [{ index: 1, signal: { type: 'item', name: 'requester-chest' } }],
    entities: [
        {
            entity_number: 1,
            name: 'requester-chest',
            position: { x: 0.5, y: 0.5 },
            request_filters: [
                { index: 1, name: 'iron-plate', count: 50 },
                { index: 2, name: 'copper-plate' },
            ],
            request_from_buffers: true,
        },
    ],
})

type Page = import('@playwright/test').Page

/*
    Page exceptions only, deliberately not console output. The console carries
    WebGL driver chatter on every run, so a spec asserting on it would be
    asserting on the graphics stack; what a migration can realistically do wrong
    and still look loaded is throw, and the model assertions cover the rest.
*/
async function load(page: Page, source: string): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
    return errors
}

/** The raw entity the loaded blueprint would serialize. */
async function serializedEntity(page: Page, entityNumber: number): Promise<any> {
    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decode(encoded).blueprint.entities as any[]
    const entity = entities.find(e => e.entity_number === entityNumber)
    if (!entity) throw new Error(`entity ${entityNumber} is not in the serialized blueprint`)
    return entity
}

test('a pre-2.0 constant combinator keeps its signals through the migration', async ({ page }) => {
    const errors = await load(page, OLD_COMBINATOR)

    // The model half. constantCombinatorFilters is the only reader of
    // control_behavior.sections, so this is what "the migration worked" means.
    expect(await page.evaluate(() => window.__fbe_test.constantCombinatorFilters(1))).toEqual([
        'iron-plate',
        'signal-A',
    ])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])

    const cb = (await serializedEntity(page, 1)).control_behavior
    expect(cb.filters).toBeUndefined()
    expect(cb.sections.sections[0].filters).toEqual([
        { index: 1, type: 'item', name: 'iron-plate', count: 5 },
        { index: 2, type: 'virtual', name: 'signal-A', count: -3 },
    ])
})

test('a pre-2.0 logistic chest keeps its requests through the migration', async ({ page }) => {
    const errors = await load(page, OLD_CHEST)

    expect(await page.evaluate(() => window.__fbe_test.entityFilters(1))).toEqual([
        { index: 1, name: 'iron-plate', count: 50 },
        // The old array made `count` optional and the new LogisticFilter
        // requires it, so the migration defaults it - to 1, same as the setter.
        { index: 2, name: 'copper-plate', count: 1 },
    ])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])

    const raw = (await serializedEntity(page, 1)).request_filters
    expect(Array.isArray(raw)).toBe(false)
    // request_from_buffers was a sibling field pre-2.0 and moves inside.
    expect(raw.request_from_buffers).toBe(true)
    expect((await serializedEntity(page, 1)).request_from_buffers).toBeUndefined()
})

test('a migrated section is numbered the way Factorio numbers sections', async ({ page }) => {
    /*
        Issue #89. Both migrations hard-coded `index: 0`, and nothing noticed
        because every reader in this editor is *positional* - `sections[0]` is
        the first element of the array, not the section whose index is 0 - so a
        0 round-trips through the editor perfectly and only shows up in
        Factorio.

        1 is what the corpus says: measured over wormeyman-tests/, all 4645
        `request_filters` sections are at index 1 or 2, and all 1452
        `control_behavior` sections run 1 through 15, contiguous from 1. Nothing
        anywhere is at 0.

        Factorio has since been asked directly (#91), and the answer is stronger
        than "1 is tidier": a section at index 0 makes **the whole blueprint
        string fail to import** - `import_stack` answers -1 and no entities
        arrive at all. Not the section dropped, not the entity dropped, the
        string refused. So before this was fixed, any pre-2.0 blueprint with a
        logistic chest or a constant combinator became, on export, a string the
        game would not take.

        Measured with tools/oracle/, recorded in
        tools/oracle/fixtures/section-index.json against Factorio 2.1.12.
    */
    await load(page, OLD_COMBINATOR)
    const cb = (await serializedEntity(page, 1)).control_behavior
    expect(cb.sections.sections[0].index).toBe(1)

    await load(page, OLD_CHEST)
    const raw = (await serializedEntity(page, 1)).request_filters
    expect(raw.sections[0].index).toBe(1)
})

test('the combinator migration is shape-gated, not version-gated', async ({ page }) => {
    /*
        Worth pinning because the two migrations differ here and the difference
        is invisible at the call site. The chest one asks `pre_2_0` and throws
        on an array in a 2.0 blueprint; this one only asks whether `filters` is
        present and `sections` is not, so it also fires on a blueprint declaring
        2.0 - which is what makes it reachable by anything hand-built or
        exported by an older third-party tool.
    */
    const errors = await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            icons: [{ index: 1, signal: { type: 'item', name: 'constant-combinator' } }],
            entities: [
                {
                    entity_number: 1,
                    name: 'constant-combinator',
                    position: { x: 0.5, y: 0.5 },
                    control_behavior: {
                        filters: [
                            { index: 1, count: 7, signal: { type: 'item', name: 'copper-plate' } },
                        ],
                    },
                },
            ],
        })
    )

    expect(await page.evaluate(() => window.__fbe_test.constantCombinatorFilters(1))).toEqual([
        'copper-plate',
    ])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
