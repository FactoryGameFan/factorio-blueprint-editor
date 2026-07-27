import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    The logistic chest editor (issue #87).

    `ChestEditor` was commented out of `UI/editors/factory.ts` under
    `// TODO: update using sections`, so clicking a storage, requester or buffer
    chest opened nothing and there was no way to set a filter, change a request
    count or toggle "request from buffers" in the UI at all. Paste-settings was
    the only route to any of it.

    The TODO was about the setter rather than the editor: `Entity.set
    logisticChestFilters` was an unconditional throw (#64), so the dialog would
    have crashed the moment a slot was touched. With that written against
    `request_filters.sections`, the editor works as it was.

    What is covered here is the editor - that it opens for each of the three
    chests, is built differently for each, and that a real click on a real slot
    reaches the entity. What the setter does with the value once it arrives is
    `tests/chest-filters.spec.ts`, which does not go through any UI.

    The last group is the filter grid's size and shape (issue #93), which nothing
    else can see: `Entity.filterSlots` is a plain number, so a spec that read it
    would agree with itself no matter what the dialog actually drew. Every test
    there works by clicking a screen position that only exists under the intended
    layout, so a grid that is narrower or shorter than it should be fails by
    clicking nothing at all.

    Locating controls: the dialog is drawn with pixi, so there is no selector
    for a filter slot. `topDialogBounds` gives where the dialog sits and the
    constants below mirror `ChestEditor`/`Filters` - if that layout moves, these
    move with it. That is the trade for being able to click the thing a user
    clicks.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/*
    ChestEditor puts its Filters component here, and Filters lays its slots out
    on a 38px pitch, each slot 36px square.

    FILTER_COLUMNS is the game's own `logistic_slots_per_row`, which ChestEditor
    passes to Filters - six is only the default that the inserter dialog still
    takes. FILTER_ROWS is the floor `Entity.filterSlots` answers for a chest that
    declares no capacity, so an empty requester or buffer chest has exactly
    FILTER_COLUMNS * FILTER_ROWS slots.
*/
const FILTERS_X = 208
const FILTERS_Y = 45
const SLOT_PITCH = 38
const SLOT_CENTRE = 18
const FILTER_COLUMNS = 10
const FILTER_ROWS = 3

/** What ChestEditor widens to so a ten-wide grid fits, and its width otherwise. */
const WIDE_DIALOG = FILTERS_X + FILTER_COLUMNS * SLOT_PITCH + 12
const BASE_DIALOG = 446

const CHESTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'storage-chest' } }],
    entities: [
        {
            entity_number: 1,
            name: 'storage-chest',
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
                                count: 1,
                            },
                        ],
                    },
                ],
            },
        },
        { entity_number: 2, name: 'requester-chest', position: { x: 1.5, y: 0.5 } },
        { entity_number: 3, name: 'buffer-chest', position: { x: 2.5, y: 0.5 } },
        { entity_number: 4, name: 'wooden-chest', position: { x: 3.5, y: 0.5 } },
    ],
})

/*
    A buffer chest whose one request sits well past the grid's floor of 30, which
    is what `filterSlots` raises the floor for. 45 is arbitrary except in being
    over 30 and under the per-section cap of 1000; it lands in the fifth row.
*/
const FAR_FILTER_INDEX = 45

const FAR_FILTER = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'buffer-chest' } }],
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
                                index: FAR_FILTER_INDEX,
                                name: 'iron-plate',
                                quality: 'normal',
                                comparator: '=',
                                count: 10,
                            },
                        ],
                    },
                ],
            },
        },
    ],
})

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

const loadChests = (page: Page): Promise<string[]> => load(page, CHESTS)

/*
    Hovers the entity and left clicks, which is the `openEntityGUI` action.

    Steps away from the entity first: hovering is driven by GridData's
    `update32`, which only fires when the pointer crosses a tile boundary, so
    moving to a point the pointer already occupies emits nothing and leaves the
    mode at NONE. Same reason as in tests/text-input.spec.ts.
*/
async function openEditorOn(page: Page, entityNumber: number): Promise<void> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)

    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')

    await page.mouse.down()
    await page.mouse.up()
}

const dialogCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.openDialogCount())

/** Where filter slot `index` (0-based) sits on screen, from the dialog's own corner. */
async function filterSlotAt(page: Page, index: number): Promise<{ x: number; y: number }> {
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    return {
        x: dialog.x + FILTERS_X + (index % FILTER_COLUMNS) * SLOT_PITCH + SLOT_CENTRE,
        y: dialog.y + FILTERS_Y + Math.floor(index / FILTER_COLUMNS) * SLOT_PITCH + SLOT_CENTRE,
    }
}

/*
    Where the inventory's first item sits. InventoryDialog puts its items
    container at (12, 126) and lays the buttons out on the same 38px pitch, ten
    to a row, so the first one's centre is one half-slot in from that corner.
*/
async function firstInventoryItem(page: Page): Promise<{ x: number; y: number }> {
    const dialog = await page.evaluate(() => window.__fbe_test.topDialogBounds())
    return { x: dialog.x + 12 + SLOT_CENTRE, y: dialog.y + 126 + SLOT_CENTRE }
}

const filtersOf = (page: Page, entityNumber: number): Promise<unknown> =>
    page.evaluate((n: number) => window.__fbe_test.entityFilters(n), entityNumber)

/*
    The DOM inputs TextInput has put on the page, told apart from the settings
    pane's own by having an inline style - TextInput writes `_input_style` onto
    the element and nothing else on the page does. Borrowed from
    tests/text-input.spec.ts.
*/
const textInputValues = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[])
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )

for (const [entityNumber, name] of [
    [1, 'storage-chest'],
    [2, 'requester-chest'],
    [3, 'buffer-chest'],
] as [number, string][]) {
    test(`clicking a ${name} opens its editor`, async ({ page }) => {
        const errors = await loadChests(page)
        expect(await dialogCount(page)).toBe(0)

        await openEditorOn(page, entityNumber)

        expect(await dialogCount(page)).toBe(1)
        expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    })
}

test('a chest with no editor opens nothing', async ({ page }) => {
    /*
        The control for the three above. A wooden chest falls to the factory's
        default arm and answers undefined, which `UIContainer.createEditor`
        treats as "no dialog" rather than as a failure - so the click has to be
        a no-op rather than an error.
    */
    const errors = await loadChests(page)

    await openEditorOn(page, 4)

    expect(await dialogCount(page)).toBe(0)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the count controls are built for chests that request an amount, and not for storage', async ({
    page,
}) => {
    /*
        `m_Amount` is `name !== 'storage-chest'`, and it decides whether the
        editor gets the count label, slider and textbox at all - the constructor
        returns early without them for a storage chest, whose single slot has no
        amount to request.

        Asserted through the DOM because the textbox is a `TextInput`, the one
        control in UI/ that appends a real <input> rather than drawing itself.
        It is the only part of this dialog visible from outside the canvas, and
        it happens to be the exact part that tells the two layouts apart.
    */
    await loadChests(page)

    await openEditorOn(page, 1)
    expect(await textInputValues(page)).toEqual([])

    await page.keyboard.press('Escape')
    await openEditorOn(page, 2)
    expect(await textInputValues(page)).toEqual(['10'])
})

test('picking an item in a filter slot sets the filter on the chest', async ({ page }) => {
    /*
        The whole point of the issue, end to end and through real input: click
        the slot, which opens the inventory dialog, then click an item in it.

        The inventory is found the same pixi-blind way as the slot - it is now
        the topmost dialog, and InventoryDialog lays its items out on the same
        36px grid from its own top-left. Asserting the *entity* rather than the
        slot's appearance is deliberate: a slot that redrew without writing
        through would look right and change nothing.
    */
    const errors = await loadChests(page)
    await openEditorOn(page, 3)
    expect(await filtersOf(page, 3)).toEqual([])

    const slot = await filterSlotAt(page, 0)
    await page.mouse.move(slot.x, slot.y)
    await page.mouse.down()
    await page.mouse.up()

    // The chest editor plus the inventory it just opened.
    expect(await dialogCount(page)).toBe(2)

    const item = await firstInventoryItem(page)
    await page.mouse.move(item.x, item.y)
    await page.mouse.down()
    await page.mouse.up()

    /*
        Which item is first depends on FD.inventoryLayout and so is not this
        spec's to pin - what matters is that a pick reached the entity, landed
        in slot 1, and brought a count with it. `Filters` sets that count from
        the item's own stack_size, so anything above zero means it read the
        item rather than defaulting.
    */
    const filters = (await filtersOf(page, 3)) as { index: number; name: string; count: number }[]
    expect(filters).toHaveLength(1)
    expect(filters[0].index).toBe(1)
    expect(filters[0].name).toBeTruthy()
    expect(filters[0].count).toBeGreaterThan(0)

    // Picking closes the inventory, leaving the chest editor behind it.
    expect(await dialogCount(page)).toBe(1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('right clicking a filled slot clears the filter', async ({ page }) => {
    /*
        The other half of `Filters.onSlotPointerDown`, and the cheaper one to
        drive: it needs no inventory, just a slot that already holds something.
        Entity 1 is the storage chest, whose one slot arrives holding iron-plate.

        This is the path that made #64 user-visible - clearing a slot writes
        `this.m_Entity.filters` exactly the way picking one does.
    */
    const errors = await loadChests(page)
    await openEditorOn(page, 1)
    // The precondition rather than the thing under test. quality and comparator
    // are here because #88 made Entity.filters carry them.
    expect(await filtersOf(page, 1)).toEqual([
        {
            index: 1,
            name: 'iron-plate',
            count: 1,
            quality: 'normal',
            comparator: '=',
            max_count: undefined,
        },
    ])

    const slot = await filterSlotAt(page, 0)
    await page.mouse.move(slot.x, slot.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })

    expect(await filtersOf(page, 1)).toEqual([])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The filter grid's size and shape - issue #93.

    `Entity.filterSlots` used to answer a bare 30 under a "find a way to fix this
    properly" TODO, drawn six to a row like every other filter dialog. There is no
    number to find: a 2.0 logistic section holds as many filters as it likes and
    no prototype states a row count for the game's own section GUI. What is read
    from the data now is the *width* - `logistic_slots_per_row`, which is 10 - and
    the three rows are a chosen default that happens to land on the same 30.

    Each test below clicks a screen position that exists only under the intended
    layout. That is the point of driving them through the pointer: reading
    `filterSlots` would agree with itself whatever the dialog drew, and a grid
    laid out six to a row puts every one of these positions over empty canvas.
*/

/** Picks the inventory's first item, with the inventory already open. */
async function pickFirstItem(page: Page): Promise<void> {
    const item = await firstInventoryItem(page)
    await page.mouse.move(item.x, item.y)
    await page.mouse.down()
    await page.mouse.up()
}

/** Clicks a filter slot, which opens the item picker when the slot is empty. */
async function clickSlot(page: Page, index: number, button?: 'right'): Promise<void> {
    const slot = await filterSlotAt(page, index)
    await page.mouse.move(slot.x, slot.y)
    await page.mouse.down(button === undefined ? {} : { button })
    await page.mouse.up(button === undefined ? {} : { button })
}

const dialogWidth = async (page: Page): Promise<number> =>
    (await page.evaluate(() => window.__fbe_test.topDialogBounds())).width

test('the logistic filter grid is ten wide, the width the game draws logistic slots at', async ({
    page,
}) => {
    /*
        Slot 10 is the last of the first row at ten wide. At six it is the fourth
        slot of the second row, and the position asserted here - one row up and
        past x=436 - falls outside a dialog that would still be 446 wide.
    */
    const errors = await load(page, CHESTS)
    await openEditorOn(page, 2)
    expect(await dialogWidth(page)).toBe(WIDE_DIALOG)

    await clickSlot(page, FILTER_COLUMNS - 1)
    expect(await dialogCount(page)).toBe(2)
    await pickFirstItem(page)

    const filters = (await filtersOf(page, 2)) as { index: number }[]
    expect(filters).toHaveLength(1)
    expect(filters[0].index).toBe(FILTER_COLUMNS)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('an empty logistic chest gets three rows of them', async ({ page }) => {
    /*
        The floor, from the far corner: the last slot of the third row is the
        highest index the grid offers with nothing in the chest. Two rows, or a
        floor left at some smaller number, leaves this position over the count
        controls or off the dialog entirely.
    */
    const errors = await load(page, CHESTS)
    await openEditorOn(page, 3)

    const last = FILTER_COLUMNS * FILTER_ROWS - 1
    await clickSlot(page, last)
    expect(await dialogCount(page)).toBe(2)
    await pickFirstItem(page)

    const filters = (await filtersOf(page, 3)) as { index: number }[]
    expect(filters).toHaveLength(1)
    expect(filters[0].index).toBe(last + 1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a chest holding a filter past the floor draws enough slots to reach it', async ({ page }) => {
    /*
        The `Math.max` half of `filterSlots`, and the reason the floor is a floor
        rather than a size. A blueprint is free to arrive with a request at any
        index - nothing in 2.0 caps a section below 1000 - and a fixed grid would
        hide it, leaving a filter that serializes back out but cannot be seen or
        cleared.

        Clearing it is what is asserted, rather than the slot merely drawing: a
        slot that rendered the icon without being wired to that filter would look
        right and change nothing.
    */
    const errors = await load(page, FAR_FILTER)
    await openEditorOn(page, 1)

    expect((await filtersOf(page, 1)) as { index: number }[]).toMatchObject([
        { index: FAR_FILTER_INDEX, name: 'iron-plate' },
    ])

    await clickSlot(page, FAR_FILTER_INDEX - 1, 'right')

    expect(await filtersOf(page, 1)).toEqual([])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a storage chest, whose single slot needs no room, keeps the standard dialog width', async ({
    page,
}) => {
    /*
        The control for the widening. `ChestEditor` sizes itself from the columns
        it actually draws, so widening is something the grid causes rather than
        something applied to every chest - a storage chest declares
        `max_logistic_slots: 1` and stays where it was.
    */
    const errors = await load(page, CHESTS)
    await openEditorOn(page, 1)

    expect(await dialogWidth(page)).toBe(BASE_DIALOG)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
