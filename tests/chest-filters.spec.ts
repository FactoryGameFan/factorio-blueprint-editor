import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    decodeBlueprintString as decode,
    packVersion as version,
} from './helpers/encode-blueprint'
import type { TestFilterSlot } from './helpers/fbe-test-api'

/*
    Writing a logistic chest's filters (issue #64).

    `Entity.set logisticChestFilters` was an unconditional throw with the whole
    pre-2.0 implementation commented out beneath it. The getter had been
    rewritten for the 2.0 `request_filters.sections` shape and the setter had
    not, so chests displayed their filters and any write threw.

    The live route in is paste-settings - shift + right click to copy, shift +
    left click to paste - which `Entity.pasteSettings` runs through
    `this.filters = sourceEntity.filters`, and `set filters` routes storage,
    requester and buffer chests to the logistic setter. That is what the first
    two tests drive, with real pointer input.

    The rest go through the `setEntityFilters` hook, because paste cannot say
    what they need to say: it always sends a full list copied off another
    entity, so it can neither clear a chest nor send the partial slot lists the
    chest editor sends. Those two now have a UI route as well - #87 put
    `ChestEditor` back in the factory and `tests/chest-editor.spec.ts` clicks
    real slots - but this stays separate on purpose: it says the value directly,
    where the other has to go through a dialog layout to say anything at all.

    The shapes here are the ones the corpus actually holds. Measured over
    wormeyman-tests/: 4631 entities carry a `request_filters` object, every
    section is at index 1 (not 0), all 3461 filters carry `quality` and
    `comparator` as well as index/name/count, 433 objects carry
    `request_from_buffers` and 54 `trash_not_requested`, and 14 have a second
    section. Those last three are why this spec asserts on preservation rather
    than only on the filters themselves: the setter writes the whole
    `request_filters` object, so anything it does not carry over is destroyed on
    every filter edit - and none of it is visible through `Entity.filters`,
    which reads section 0 and nothing else.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

/*
    Four chests in a row at the origin, 1x1 each so hovering one is unambiguous.

    1 is the paste source: one filter, in the full shape Factorio writes.
    2 is the paste target, with no request_filters at all - the field is absent
      rather than empty, which is what a freshly placed chest looks like.
    3 carries the two things a filter write must not destroy: a second section,
      and the top-level request_from_buffers/trash_not_requested flags.
    4 is a storage chest, whose max_logistic_slots is 1 where a buffer or
      requester chest has none and falls to the name-based branch's 30.
    5 and 6 are the request-from-buffers pair: a source with the flag set and no
      filters, and a target with no request_filters field at all.
    7 and 8 are the quality pair (#88): a source whose one filter carries every
      field `IFilter` did not used to model, and an empty target.
*/
const CHESTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'buffer-chest',
            position: { x: 0.5, y: 0.5 },
            request_filters: {
                sections: [
                    {
                        index: 1,
                        filters: [
                            {
                                index: 1,
                                name: 'iron-plate',
                                quality: 'normal',
                                comparator: '=',
                                count: 200,
                            },
                            {
                                index: 2,
                                name: 'copper-plate',
                                quality: 'normal',
                                comparator: '=',
                                count: 50,
                            },
                        ],
                    },
                ],
            },
        },
        { entity_number: 2, name: 'buffer-chest', position: { x: 1.5, y: 0.5 } },
        {
            entity_number: 3,
            name: 'requester-chest',
            position: { x: 2.5, y: 0.5 },
            request_filters: {
                sections: [
                    {
                        index: 1,
                        filters: [
                            {
                                index: 1,
                                name: 'iron-gear-wheel',
                                quality: 'normal',
                                comparator: '=',
                                count: 100,
                            },
                        ],
                    },
                    { index: 2, group: 'my-group' },
                ],
                request_from_buffers: true,
                trash_not_requested: true,
            },
        },
        { entity_number: 4, name: 'storage-chest', position: { x: 3.5, y: 0.5 } },
        {
            entity_number: 5,
            name: 'requester-chest',
            position: { x: 4.5, y: 0.5 },
            request_filters: { sections: [{ index: 1 }], request_from_buffers: true },
        },
        { entity_number: 6, name: 'requester-chest', position: { x: 5.5, y: 0.5 } },
        {
            entity_number: 7,
            name: 'buffer-chest',
            position: { x: 6.5, y: 0.5 },
            request_filters: {
                sections: [
                    {
                        index: 1,
                        filters: [
                            {
                                index: 1,
                                name: 'iron-plate',
                                quality: 'rare',
                                comparator: '>',
                                count: 10,
                                max_count: 400,
                            },
                        ],
                    },
                ],
            },
        },
        { entity_number: 8, name: 'buffer-chest', position: { x: 7.5, y: 0.5 } },
    ],
})

interface Filter {
    index: number
    name: string
    count?: number
}

async function openEditorWithChests(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.locator(CANVAS).waitFor()
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, CHESTS)
}

/** Where an entity of the loaded blueprint sits, in client coordinates. */
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

const setFilters = (
    page: Page,
    entityNumber: number,
    list: TestFilterSlot[] | undefined
): Promise<void> =>
    page.evaluate(
        ([n, l]) =>
            window.__fbe_test.setEntityFilters(n as number, l as TestFilterSlot[] | undefined),
        [entityNumber, list] as const
    )

/** The raw `request_filters` the loaded blueprint would serialize, by entity number. */
async function serializedRequestFilters(page: Page, entityNumber: number): Promise<any> {
    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decode(encoded).blueprint.entities as any[]
    const entity = entities.find(e => e.entity_number === entityNumber)
    if (!entity) throw new Error(`entity ${entityNumber} is not in the serialized blueprint`)
    return entity.request_filters
}

/** Copies settings off one entity and pastes them onto another, with real input. */
async function pasteSettings(page: Page, from: number, to: number): Promise<void> {
    const source = await screenOf(page, from)
    const target = await screenOf(page, to)

    // shift + right click on the source, then shift + left click on the target.
    // Both need EDIT, which only a hover gives.
    await page.mouse.move(source.x, source.y)
    await page.keyboard.down('Shift')
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')
}

test('pasting settings copies a logistic chest filter onto another chest', async ({ page }) => {
    /*
        The bug itself. Before the fix the paste throws out of the setter, the
        target keeps no filters, and the transaction pasteSettings opened is
        never committed.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditorWithChests(page)
    expect(await filtersOf(page, 2)).toEqual([])

    await pasteSettings(page, 1, 2)

    /*
        Asserted before the filters themselves, and deliberately: an empty
        target is equally what a paste gesture that never fired would leave, so
        checking the filters first would fail with "[] is not the two filters"
        whether the setter threw or the shift-click missed. This way the failure
        names the throw and so proves the gesture arrived.
    */
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    /*
        quality and comparator are here because #88 made `Entity.filters` carry
        them; before that the getter rebuilt each filter as index/name/count and
        a paste dropped them. `max_count` is undefined rather than absent
        because the getter names every field it reads, the same way `count` has
        always come back undefined for a filter without one.
    */
    expect(await filtersOf(page, 2)).toEqual([
        {
            index: 1,
            name: 'iron-plate',
            count: 200,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
        {
            index: 2,
            name: 'copper-plate',
            count: 50,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
    ])
})

test('a pasted filter survives being serialized and read back', async ({ page }) => {
    /*
        The setter writes a shape the schema has to accept: LogisticFilter
        requires both `index` and `count`, and LogisticSections is
        additionalProperties:false, so a filter written without a count or a
        section written with a stray key would encode fine here and be rejected
        on load. Reloading the encoded string runs it back through AJV, which is
        the only thing that checks that.
    */
    await openEditorWithChests(page)
    await pasteSettings(page, 1, 2)

    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, encoded)

    expect(await filtersOf(page, 2)).toEqual([
        {
            index: 1,
            name: 'iron-plate',
            count: 200,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
        {
            index: 2,
            name: 'copper-plate',
            count: 50,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
    ])
})

test('a filter write keeps the flags and sections it does not own', async ({ page }) => {
    /*
        `request_from_buffers` has a setter of its own writing to the same field,
        and `trash_not_requested` has no reader at all - so a setter that
        replaced the whole request_filters object would turn "request from
        buffers" off on any filter edit and drop the other flag with no way back.
        The second section is the same hazard: `Entity.filters` reads section 0
        only, so section 1 is invisible to the model and would vanish silently.
    */
    await openEditorWithChests(page)

    await setFilters(page, 3, [{ index: 1, name: 'steel-plate', count: 25 }])

    expect(await filtersOf(page, 3)).toEqual([{ index: 1, name: 'steel-plate', count: 25 }])

    const raw = await serializedRequestFilters(page, 3)
    expect(raw.request_from_buffers).toBe(true)
    expect(raw.trash_not_requested).toBe(true)
    expect(raw.sections[1]).toEqual({ index: 2, group: 'my-group' })
    // Section 0 keeps its own index - real blueprints number sections from 1.
    expect(raw.sections[0].index).toBe(1)
})

test('clearing a chest leaves it with no filters', async ({ page }) => {
    /*
        What `pasteSettings` sends when the source has none: `this.filters = []`,
        which `set filters` turns into undefined before the chest ever sees it.
    */
    await openEditorWithChests(page)
    expect(await filtersOf(page, 1)).toHaveLength(2)

    await setFilters(page, 1, undefined)

    expect(await filtersOf(page, 1)).toEqual([])
    const raw = await serializedRequestFilters(page, 1)
    expect(raw?.sections?.[0]?.filters ?? []).toEqual([])
})

test('an empty slot in the middle of the list is not written', async ({ page }) => {
    /*
        The chest editor's shape: one entry per slot, so a cleared slot arrives
        with no name and a kept one keeps its index. `set filters` drops the
        nameless entries, and the indices of the survivors have to come through
        unchanged - renumbering them would move a filter to a different slot.
    */
    await openEditorWithChests(page)

    await setFilters(page, 1, [
        { index: 1, name: undefined },
        { index: 2, name: 'copper-plate', count: 50 },
    ])

    expect(await filtersOf(page, 1)).toEqual([
        {
            index: 2,
            name: 'copper-plate',
            count: 50,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
    ])
})

test('undo puts a chest filter back', async ({ page }) => {
    /*
        The reason the setter goes through `history.updateValue` rather than
        assigning to the raw entity. Nothing else here would notice the
        difference: every other test reads the value straight back, and a plain
        assignment satisfies all of them - it just leaves the change permanent
        and, worse, silently shifts what the *next* undo reverts. Verified to
        fail by swapping the updateValue call for a direct write.
    */
    await openEditorWithChests(page)
    expect(await filtersOf(page, 2)).toEqual([])

    await pasteSettings(page, 1, 2)
    expect(await filtersOf(page, 2)).toHaveLength(2)

    await page.keyboard.press('Control+KeyZ')

    expect(await filtersOf(page, 2)).toEqual([])
})

test('a slot that did not change keeps the fields the editor does not model', async ({ page }) => {
    /*
        `IFilter` is index/name/count, but every one of the 3461 filters in the
        corpus also carries `quality` and `comparator`, and 90 carry `max_count`.
        The chest editor rewrites the whole list on any slot change, reading it
        back through the getter that drops those - so a setter that built each
        entry from scratch would strip quality off every untouched slot as a side
        effect of editing a different one.

        Only preserved where the slot still holds the same item: slot 2 below
        changes hands, and comes back as the three fields the editor does model.
        Pasting cannot carry quality across at all, since it travels as IFilter -
        that is a real limitation, and out of this issue's scope.
    */
    await openEditorWithChests(page)

    await setFilters(page, 1, [
        { index: 1, name: 'iron-plate', count: 200 },
        { index: 2, name: 'steel-plate', count: 5 },
    ])

    const raw = await serializedRequestFilters(page, 1)
    expect(raw.sections[0].filters).toEqual([
        { index: 1, name: 'iron-plate', quality: 'normal', comparator: '=', count: 200 },
        { index: 2, name: 'steel-plate', count: 5 },
    ])
})

test('a filter sent with no count is written with one', async ({ page }) => {
    /*
        `IFilter.count` is optional but the schema's LogisticFilter requires it,
        so a filter written straight through would encode without a count and be
        rejected by AJV on the way back in - which the reload here is what
        catches. 1 is what the pre-2.0 migration in Blueprint.ts defaults to.
    */
    await openEditorWithChests(page)

    await setFilters(page, 4, [{ index: 1, name: 'iron-ore' }])

    expect((await serializedRequestFilters(page, 4)).sections[0].filters).toEqual([
        { index: 1, name: 'iron-ore', count: 1 },
    ])

    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, encoded)

    expect(await filtersOf(page, 4)).toEqual([{ index: 1, name: 'iron-ore', count: 1 }])
})

test('pasting a request-from-buffers chest that has no filters', async ({ page }) => {
    /*
        The same paste, one line further on. After the filters,
        `Entity.pasteSettings` copies `requestFromBufferChest`, whose setter
        starts `util.duplicate(this.m_rawEntity.request_filters) || {}` - and
        `duplicate` is `JSON.parse(JSON.stringify(x))`, which throws on undefined
        rather than returning it, so the `|| {}` never runs. A target with no
        request_filters at all is therefore the crashing case, and a source with
        no filters is what leaves it that way: the filter write above has nothing
        to do and creates nothing.

        Entity 5 is that source and 6 that target - a pair this blueprint carries
        only for this test, since chest 3 has filters and would mask it.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditorWithChests(page)

    await pasteSettings(page, 5, 6)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect((await serializedRequestFilters(page, 6))?.request_from_buffers).toBe(true)
})

test('pasting carries a filter quality, comparator and max_count across (#88)', async ({
    page,
}) => {
    /*
        Issue #88. Every one of the 3461 filters in the corpus carries `quality`
        and `comparator`, and 90 carry `max_count`, but `IFilter` was
        index/name/count - so the getter built fresh objects that dropped them
        and a paste silently downgraded a rare-quality request to no quality at
        all, which Factorio reads as "any quality" rather than as normal.

        Asserted against the serialized output because that is where the fields
        end up; the model half is the next test.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditorWithChests(page)

    await pasteSettings(page, 7, 8)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect((await serializedRequestFilters(page, 8)).sections[0].filters).toEqual([
        {
            index: 1,
            name: 'iron-plate',
            quality: 'rare',
            comparator: '>',
            count: 10,
            max_count: 400,
        },
    ])
})

test('the model reports a filter quality rather than hiding it', async ({ page }) => {
    /*
        The other half: the fields have to reach `Entity.filters`, not merely
        survive in the raw entity. If the getter kept dropping them the paste
        above could still pass by copying the raw object wholesale, and every
        reader - the chest editor included - would go on seeing an unqualified
        filter.
    */
    await openEditorWithChests(page)

    expect(await filtersOf(page, 7)).toEqual([
        {
            index: 1,
            name: 'iron-plate',
            quality: 'rare',
            comparator: '>',
            count: 10,
            max_count: 400,
        },
    ])
})

test("an incoming filter's own quality wins over the one the slot held", async ({ page }) => {
    /*
        The setter preserves the fields `IFilter` could not carry when a slot
        keeps the same item, which is what stops a partial write stripping them.
        Now that it can carry them, an incoming value has to beat the preserved
        one - otherwise the preservation would make quality permanently
        unchangeable the moment anything gains a way to set it.
    */
    await openEditorWithChests(page)

    await setFilters(page, 7, [{ index: 1, name: 'iron-plate', count: 10, quality: 'legendary' }])

    expect((await serializedRequestFilters(page, 7)).sections[0].filters[0]).toMatchObject({
        quality: 'legendary',
        // Untouched by this write, so still preserved from what was there.
        comparator: '>',
        max_count: 400,
    })
})

test('a storage chest takes a filter through its single slot', async ({ page }) => {
    /*
        The other branch of `filterSlots`: storage-chest declares
        max_logistic_slots 1, while buffer and requester chests declare none and
        fall through to the name-based 30. A chest that started with no
        request_filters field at all also makes the setter build the object from
        nothing rather than editing one.
    */
    await openEditorWithChests(page)

    await setFilters(page, 4, [{ index: 1, name: 'iron-ore', count: 1 }])

    expect(await filtersOf(page, 4)).toEqual([{ index: 1, name: 'iron-ore', count: 1 }])
    const raw = await serializedRequestFilters(page, 4)
    expect(raw.sections).toHaveLength(1)
    expect(raw.sections[0].filters).toEqual([{ index: 1, name: 'iron-ore', count: 1 }])
})
