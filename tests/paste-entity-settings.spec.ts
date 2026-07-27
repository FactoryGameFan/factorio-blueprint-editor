import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    decodeBlueprintString as decode,
    packVersion as version,
} from './helpers/encode-blueprint'

/*
    The same-type half of #94: the settings `pasteSettings` did not carry.

    That TODO listed eight things and was written in 2019. Rather than implement
    from the list, each pair was put to the game - a configured source and a
    blank target placed headless, `LuaEntity.copy_settings(source)` called (the
    same operation this gesture performs), and the pair blueprinted afterwards.
    `tools/oracle/probe-copy-settings.mjs`, captured with provenance in
    `tools/oracle/fixtures/copy-settings.json`. The values asserted below are the
    ones that came back.

    Two things the list was wrong about, both found that way:

      - `manual_trains_limit` and `use_transitional_requests` are copied by the
        game and are not in the TODO.
      - The rocket silo's flag was renamed. Pre-2.0 `auto_launch` no longer
        exists on `LuaEntity` at all, which read as "the feature is gone" until
        the 2.0 name `launch_to_orbit_automatically` turned up in the editor's
        own `IEntity`.

    Asserted twice over, and the second is the point: through the model, and
    through the **serialized** blueprint. A wagon nests `bar` and `filters` under
    `inventory` where a chest carries `bar` at the top level, so a setter writing
    the right value into the wrong shape reads back correctly from the model it
    just wrote and still exports a blueprint Factorio would not honour.

    The corpus cannot supply any of it - it has train stops and speakers, but no
    pair of them the spec can name, and no rolling stock at all. Every case here
    is synthetic.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

const RED = { r: 0.9, g: 0.1, b: 0.1, a: 0.5 }

const WAGON_INVENTORY = {
    bar: 10,
    filters: [
        { index: 1, name: 'iron-plate', quality: 'normal', comparator: '=' },
        { index: 2, name: 'copper-plate', quality: 'normal', comparator: '=' },
    ],
}

/**
 * One pair per blueprint - entity 1 the configured source, entity 2 the blank
 * target, `gap` tiles apart.
 *
 * A pair per blueprint rather than all six in one, because the editor centres
 * the view on what it loads and the gesture needs both entities on screen: a
 * first draft stacked the pairs down one blueprint and the two furthest from
 * the centre silently pasted nothing, since a click outside the canvas hovers
 * nothing and paste-settings needs EDIT. The gap is per pair because a rocket
 * silo is 9x9 and a chest is 1x1.
 */
const pair = (
    name: string,
    settings: Record<string, unknown>,
    gap: number,
    extra: Record<string, unknown> = {}
): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            { entity_number: 1, name, position: { x: 0.5, y: 0.5 }, ...extra, ...settings },
            { entity_number: 2, name, position: { x: 0.5 + gap, y: 0.5 }, ...extra },
        ],
    })

const TRAIN_STOPS = pair(
    'train-stop',
    { station: 'Iron Pickup', color: RED, manual_trains_limit: 3 },
    6
)
const SPEAKERS = pair(
    'programmable-speaker',
    {
        parameters: {
            playback_volume: 0.8,
            playback_mode: 'global',
            allow_polyphony: true,
            volume_controlled_by_signal: false,
        },
        alert_parameters: {
            show_alert: true,
            show_on_map: true,
            icon_signal_id: { type: 'item', name: 'iron-plate' },
            alert_message: 'Probe alert',
        },
    },
    6
)
const CHESTS = pair('steel-chest', { bar: 4 }, 6)
const LOCOMOTIVES = pair('locomotive', { color: RED }, 12, { orientation: 0.25 })
const WAGONS = pair('cargo-wagon', { inventory: WAGON_INVENTORY }, 12, { orientation: 0.25 })
const SILOS = pair(
    'rocket-silo',
    { launch_to_orbit_automatically: true, use_transitional_requests: true },
    14
)

async function openEditor(page: Page, source: string): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.locator(CANVAS).waitFor()
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
}

/**
 * Puts the pointer on an entity and waits until the editor agrees it is hovered.
 *
 * The wait is the point. Paste-settings only fires in EDIT, which a hover gives,
 * and the editor picks the hover up on its own frame - so a click dispatched
 * immediately after the move can arrive first and be ignored, leaving a target
 * that looks exactly like a broken setter. Measured: the cargo wagon test failed
 * this way roughly one full run in two before this wait existed, and passed on
 * its own every time.
 *
 * It also turns the other way of getting nothing into a named failure. An entity
 * off screen hovers nothing at all, which is what a first draft of this spec did
 * by stacking six pairs down one blueprint.
 */
async function hoverEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await screenOf(page, entityNumber)
    await page.mouse.move(at.x, at.y)
    await page.waitForFunction(n => window.__fbe_test.hoveredEntityNumber() === n, entityNumber, {
        timeout: 10_000,
    })
}

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/** Copies settings off one entity onto another with real input, as #64's spec does. */
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

/** The raw entity the loaded blueprint would serialize, by entity number. */
async function serialized(page: Page, entityNumber: number): Promise<any> {
    const encoded = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decode(encoded).blueprint.entities as any[]
    const entity = entities.find(e => e.entity_number === entityNumber)
    if (!entity) throw new Error(`entity ${entityNumber} is not in the serialized blueprint`)
    return entity
}

test('a train stop carries its name, colour and trains limit', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditor(page, TRAIN_STOPS)
    await pasteSettings(page, 1, 2)
    expect(errors).toEqual([])

    const target = await serialized(page, 2)
    expect(target.station).toBe('Iron Pickup')
    expect(target.color).toEqual(RED)
    // Not in the TODO. The game copies it, so the editor does too.
    expect(target.manual_trains_limit).toBe(3)
})

test('a speaker carries its parameters and its alert parameters', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await openEditor(page, SPEAKERS)
    await pasteSettings(page, 1, 2)
    expect(errors).toEqual([])

    const target = await serialized(page, 2)
    expect(target.parameters).toEqual({
        playback_volume: 0.8,
        playback_mode: 'global',
        allow_polyphony: true,
        volume_controlled_by_signal: false,
    })
    expect(target.alert_parameters).toEqual({
        show_alert: true,
        show_on_map: true,
        icon_signal_id: { type: 'item', name: 'iron-plate' },
        alert_message: 'Probe alert',
    })
})

test('a chest carries its inventory limit', async ({ page }) => {
    await openEditor(page, CHESTS)
    await pasteSettings(page, 1, 2)

    expect((await serialized(page, 2)).bar).toBe(4)
})

test('a locomotive carries its colour', async ({ page }) => {
    await openEditor(page, LOCOMOTIVES)
    await pasteSettings(page, 1, 2)

    expect((await serialized(page, 2)).color).toEqual(RED)
})

test('a cargo wagon carries its inventory limit and slot filters together', async ({ page }) => {
    await openEditor(page, WAGONS)
    await pasteSettings(page, 1, 2)

    const target = await serialized(page, 2)
    /*
        Under `inventory`, not at the top level - the shape a chest uses. This is
        the assertion the model alone could not make.
    */
    expect(target.bar).toBeUndefined()
    expect(target.inventory).toEqual(WAGON_INVENTORY)
})

test('a rocket silo carries its automatic launch settings', async ({ page }) => {
    await openEditor(page, SILOS)
    await pasteSettings(page, 1, 2)

    const target = await serialized(page, 2)
    expect(target.launch_to_orbit_automatically).toBe(true)
    // Copied by the game alongside the launch flag, and not in the TODO either.
    expect(target.use_transitional_requests).toBe(true)
})

test('the target holds its own copy of a pasted settings object', async ({ page }) => {
    /*
        `pasteSettings` reads straight off the source's raw data, so assigning
        that object would leave both entities pointing at one - editing either
        would edit both, and undo would restore an object the other still holds.
        Nothing about a single paste can show that, which is why this changes the
        target afterwards and then looks at the source.
    */
    await openEditor(page, WAGONS)
    await pasteSettings(page, 1, 2)

    await page.evaluate(() => window.__fbe_test.setWagonInventory(2, { bar: 2, filters: [] }))

    expect((await serialized(page, 1)).inventory).toEqual(WAGON_INVENTORY)
})
