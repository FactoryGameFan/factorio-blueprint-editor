import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    decodeBlueprintString as decode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { suppressToasts } from './helpers/toasts'

/*
    The cross-type half of #94: pasting settings between entities of different
    types, which `canPasteSettings` refused outright.

    It was `sourceEntity.type === this.type`, so an assembling machine could
    never be pasted onto a requester chest - the case the issue calls the most
    used of the lot. Which pairs the gate should now allow came from the game
    rather than from the TODO: `LuaEntity.copy_settings` across types, probed in
    `tools/oracle/probe-copy-settings-cross-type.mjs` and captured in
    `tools/oracle/fixtures/copy-settings-cross-type.json`.

    **The formula in the issue is wrong.** It records

        min(amount, ceil(amount * craftingSpeed / energy_required))

    and the game does

        floor(30 * amount * craftingSpeed / energy_required)

    - thirty seconds of production per ingredient. They disagree on every case
    measured: for an assembling-machine-2 making electronic circuits the issue's
    rule asks for 1 iron plate and the game asks for 45. The numbers asserted
    below are the game's.

    Three things the probe settled that no amount of reading would have:

      - It floors rather than rounds (4.5 -> 4, 7.5 -> 7).
      - Modules count - the same machine with two speed modules asks for 62 where
        the arithmetic says 63, which is float error in the game's own
        multiplication and comes out the same here.
      - Fluid ingredients are left out, not requested at zero.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

const RED = { r: 0.9, g: 0.1, b: 0.1, a: 0.5 }

/** Entity 1 is the source, entity 2 the target, `gap` tiles to its right. */
const pairOf = (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    gap = 8
): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            { entity_number: 1, position: { x: 0.5, y: 0.5 }, ...source },
            { entity_number: 2, position: { x: 0.5 + gap, y: 0.5 }, ...target },
        ],
    })

const MACHINE_TO_REQUESTER = pairOf(
    { name: 'assembling-machine-2', recipe: 'electronic-circuit' },
    { name: 'requester-chest' }
)
const SLOW_MACHINE_TO_REQUESTER = pairOf(
    { name: 'assembling-machine-1', recipe: 'electronic-circuit' },
    { name: 'requester-chest' }
)
const FLUID_RECIPE_TO_REQUESTER = pairOf(
    { name: 'assembling-machine-2', recipe: 'processing-unit' },
    { name: 'requester-chest' }
)
const MODULED_MACHINE_TO_REQUESTER = pairOf(
    {
        name: 'assembling-machine-2',
        recipe: 'electronic-circuit',
        items: [
            {
                id: { name: 'speed-module' },
                items: {
                    in_inventory: [
                        { inventory: 4, stack: 0 },
                        { inventory: 4, stack: 1 },
                    ],
                },
            },
        ],
    },
    { name: 'requester-chest' }
)
const MACHINE_TO_INSERTER = pairOf(
    { name: 'assembling-machine-2', recipe: 'electronic-circuit' },
    { name: 'fast-inserter' }
)
const MACHINE_TO_PLAIN_CHEST = pairOf(
    { name: 'assembling-machine-2', recipe: 'electronic-circuit' },
    { name: 'steel-chest' }
)
const STOP_TO_LOCOMOTIVE = pairOf(
    { name: 'train-stop', color: RED, station: 'Iron Pickup' },
    { name: 'locomotive', orientation: 0.25 },
    12
)
const LOCOMOTIVE_TO_STOP = pairOf(
    { name: 'locomotive', orientation: 0.25, color: RED },
    { name: 'train-stop' },
    12
)

async function openEditor(page: Page, source: string): Promise<void> {
    await suppressToasts(page)
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

/** Waits for the editor to report the hover, so the click cannot outrun it - see #113. */
async function hoverEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await screenOf(page, entityNumber)
    /*
        Step off the target first. The editor re-evaluates the hover on a grid
        update, so a move to coordinates the pointer already occupies changes
        nothing - and the pointer does already occupy them when a second
        blueprint is loaded into the same page and puts an entity in the same
        place, which is what the cursor-box test below does. Without this the
        wait times out on a hover that is correct but never recomputed.
    */
    await page.mouse.move(at.x + 60, at.y + 60)
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

async function serialized(page: Page, entityNumber: number): Promise<any> {
    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decode(encoded).blueprint.entities as any[]
    const entity = entities.find(e => e.entity_number === entityNumber)
    if (!entity) throw new Error(`entity ${entityNumber} is not in the serialized blueprint`)
    return entity
}

/** A chest's requests as name -> count, from section 0 of the serialized entity. */
async function requestsOf(page: Page, entityNumber: number): Promise<Record<string, number>> {
    const entity = await serialized(page, entityNumber)
    const filters = entity.request_filters?.sections?.[0]?.filters ?? []
    return Object.fromEntries(filters.map((f: any) => [f.name, f.count]))
}

test('an assembling machine asks a requester chest for its ingredients', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditor(page, MACHINE_TO_REQUESTER)
    await pasteSettings(page, 1, 2)
    expect(errors).toEqual([])

    /*
        assembling-machine-2 is 0.75/s and electronic-circuit takes 0.5s, so
        thirty seconds is 45 crafts: 1 iron plate and 3 copper cable each.
        The issue's formula would give 1 and 3.
    */
    expect(await requestsOf(page, 2)).toEqual({ 'iron-plate': 45, 'copper-cable': 135 })
})

test('the request counts follow the machine, not the recipe alone', async ({ page }) => {
    /*
        The same recipe on a slower machine. If the counts were a property of the
        recipe - or of any rule that ignores crafting speed - this would match
        the test above rather than being two thirds of it.
    */
    await openEditor(page, SLOW_MACHINE_TO_REQUESTER)
    await pasteSettings(page, 1, 2)

    expect(await requestsOf(page, 2)).toEqual({ 'iron-plate': 30, 'copper-cable': 90 })
})

test('a fluid ingredient is left out, and a fractional count is floored', async ({ page }) => {
    /*
        processing-unit on an assembling-machine-2: 20 electronic circuits, 2
        advanced circuits and 5 sulfuric acid over 10 seconds. Thirty seconds is
        2.25 crafts, so 45 and 4.5 - and the game asks for 4.

        The fluid has no business in a chest and the game omits it rather than
        requesting zero, which is a different thing from a filter with count 0.
    */
    await openEditor(page, FLUID_RECIPE_TO_REQUESTER)
    await pasteSettings(page, 1, 2)

    const requests = await requestsOf(page, 2)
    expect(requests).toEqual({ 'electronic-circuit': 45, 'advanced-circuit': 4 })
    expect(requests['sulfuric-acid']).toBeUndefined()
})

test("a machine's modules change what it asks for", async ({ page }) => {
    /*
        Two speed modules in an assembling-machine-2: 0.75 * 1.4. The exact
        figure is 63 and the game asks for 62, because 0.75 * 1.4 is a hair under
        1.05 in floating point - which JavaScript reproduces as long as the terms
        are multiplied in the same order. Asserting 62 rather than 63 is
        deliberate: it is what the game does, and it is the case that shows
        modules are read at all.
    */
    await openEditor(page, MODULED_MACHINE_TO_REQUESTER)
    await pasteSettings(page, 1, 2)

    expect(await requestsOf(page, 2)).toEqual({ 'iron-plate': 62, 'copper-cable': 188 })
})

test('an assembling machine sets an inserter to filter its ingredients', async ({ page }) => {
    await openEditor(page, MACHINE_TO_INSERTER)
    await pasteSettings(page, 1, 2)

    const target = await serialized(page, 2)
    expect(target.filters?.map((f: any) => f.name)).toEqual(['iron-plate', 'copper-cable'])
    // Names only - an inserter filter has nowhere to put the count a chest gets.
    expect(target.filters?.every((f: any) => f.count === undefined)).toBe(true)
})

test('the editor offers the paste only for the pairs it can act on', async ({ page }) => {
    /*
        The copy cursor box is the one thing `canPasteSettings` shows before a
        click, so it is the only way to tell "refused" from "accepted and writes
        nothing" - and without it, adding a type to CROSS_TYPE_PASTE that does no
        work would pass every other test here while promising the user a paste
        that does nothing. Checked: it does.
    */
    const offered = async (source: string): Promise<boolean> => {
        await openEditor(page, source)
        await hoverEntity(page, 1)
        await page.keyboard.down('Shift')
        await page.mouse.down({ button: 'right' })
        await page.mouse.up({ button: 'right' })

        /*
            Shift stays down. `copySettingsActive` is set by the modifier being
            held and cleared when it is released, and the box is hidden with it -
            so asking after releasing Shift answers false for every pair,
            including the ones that work. That is how a first draft of this test
            failed.
        */
        await hoverEntity(page, 2)
        const visible = await page.evaluate(() => window.__fbe_test.copyCursorBoxVisible())
        await page.keyboard.up('Shift')
        return visible
    }

    expect(await offered(MACHINE_TO_REQUESTER)).toBe(true)
    expect(await offered(MACHINE_TO_PLAIN_CHEST)).toBe(false)
})

test('an assembling machine does nothing to a plain container', async ({ page }) => {
    /*
        The gate has to stay closed somewhere, and this is where: a steel chest
        holds no requests, and the game leaves it untouched. A paste that reached
        it would be the editor inventing behaviour.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditor(page, MACHINE_TO_PLAIN_CHEST)
    await pasteSettings(page, 1, 2)
    expect(errors).toEqual([])

    const target = await serialized(page, 2)
    expect(target.request_filters).toBeUndefined()
    expect(target.filters).toBeUndefined()
})

test('a train stop and a locomotive trade colour, and nothing else', async ({ page }) => {
    await openEditor(page, STOP_TO_LOCOMOTIVE)
    await pasteSettings(page, 1, 2)

    const locomotive = await serialized(page, 2)
    expect(locomotive.color).toEqual(RED)
    // The stop's name is not part of this pair.
    expect(locomotive.station).toBeUndefined()
})

test('the colour goes the other way too', async ({ page }) => {
    await openEditor(page, LOCOMOTIVE_TO_STOP)
    await pasteSettings(page, 1, 2)

    expect((await serialized(page, 2)).color).toEqual(RED)
})
