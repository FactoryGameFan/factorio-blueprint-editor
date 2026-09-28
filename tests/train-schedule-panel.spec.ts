import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    What the info panel says about a locomotive (issue #346): its schedule, read
    only, one line per stop.

    The text itself is unit tested in `packages/editor/src/core/trainSchedule.test.ts`.
    What that cannot cover is the path from a blueprint string to the panel: a
    schedule is not on the locomotive at all but in the blueprint's top-level
    `schedules` list, found by entity number, so this loads real blueprints in
    both shapes and reads the panel through `entityInfoText`, the same
    `updateVisualization` a hover calls.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/** The schedule Factorio itself wrote, from tools/oracle/fixtures/copy-settings-schedule.json. */
const MEASURED = {
    records: [
        { station: 'Alpha', wait_conditions: [{ type: 'time', compare_type: 'and', ticks: 600 }] },
        { station: 'Beta', wait_conditions: [{ type: 'full', compare_type: 'and' }] },
    ],
    group: 'Ore Run',
    interrupts: [
        {
            name: 'Refuel',
            conditions: [{ type: 'passenger_not_present', compare_type: 'and' }],
            targets: [
                {
                    station: 'Depot',
                    wait_conditions: [{ type: 'inactivity', compare_type: 'and', ticks: 300 }],
                },
            ],
            inside_interrupt: false,
        },
    ],
}

const locomotive = (n: number) => ({
    entity_number: n,
    name: 'locomotive',
    position: { x: 0.5 + (n - 1) * 12, y: 0.5 },
    orientation: 0.25,
})

async function load(page: Page, src: string): Promise<void> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (s: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(s))
    }, src)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
}

const infoText = (page: Page, ...n: number[]): Promise<string> =>
    page.evaluate((e: number[]) => window.__fbe_test.entityInfoText(...e), n)

const MEASURED_LINES = [
    'Schedule (group Ore Run):',
    '1. Alpha: Time passed 10 s',
    '2. Beta: Full cargo',
    'Interrupts:',
    'Refuel - when Passenger not present',
    '  -> Depot: Inactivity 5 s',
].join('\n')

/** Puts the pointer on an entity and waits until the editor agrees it is hovered. */
async function hoverEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    await page.mouse.move(at.x, at.y)
    await page.waitForFunction(n => window.__fbe_test.hoveredEntityNumber() === n, entityNumber, {
        timeout: 10_000,
    })
}

const liveText = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => window.__fbe_test.entityInfoPanelText())

test('a locomotive shows its 2.0 schedule, and one on none says so', async ({ page }) => {
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [locomotive(1), locomotive(2), locomotive(3)],
            // Entities 1 and 3 share one entry, the way the game writes it.
            schedules: [{ locomotives: [1, 3], schedule: MEASURED }],
        })
    )

    expect(await infoText(page, 1)).toBe(MEASURED_LINES)
    expect(await infoText(page, 3)).toBe(MEASURED_LINES)
    expect(await infoText(page, 2)).toBe('Schedule: none')
})

test('a locomotive shows a pre-2.0 schedule the same way', async ({ page }) => {
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(1, 1, 110),
            entities: [locomotive(1)],
            schedules: [
                {
                    locomotives: [1],
                    schedule: [
                        {
                            station: 'Iron Load',
                            wait_conditions: [{ type: 'full', compare_type: 'or' }],
                        },
                        {
                            station: 'Iron Drop',
                            wait_conditions: [
                                { type: 'empty', compare_type: 'or' },
                                { type: 'time', compare_type: 'or', ticks: 1800 },
                            ],
                        },
                    ],
                },
            ],
        })
    )

    expect(await infoText(page, 1)).toBe(
        [
            'Schedule:',
            '1. Iron Load: Full cargo',
            '2. Iron Drop: Empty cargo or Time passed 30 s',
        ].join('\n')
    )
})

test('a schedule too long for the panel is cut short and counted', async ({ page }) => {
    /*
        The panel is a fixed 270 px square. Forty stops cannot fit, so the text
        keeps the first ones in order and says how many it left out - and the
        count has to add up to what was dropped.
    */
    const records = Array.from({ length: 40 }, (_, i) => ({
        station: `Stop ${i + 1}`,
        wait_conditions: [{ type: 'inactivity', compare_type: 'and', ticks: 300 }],
    }))
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [locomotive(1)],
            schedules: [{ locomotives: [1], schedule: { records } }],
        })
    )

    const shown = (await infoText(page, 1)).split('\n')
    const last = shown.at(-1) ?? ''
    const match = /^\.\.\. (\d+) more lines$/.exec(last)
    expect(match, `last line: ${last}`).not.toBeNull()

    const kept = shown.slice(0, -1)
    expect(kept[0]).toBe('Schedule:')
    expect(kept[1]).toBe('1. Stop 1: Inactivity 5 s')
    // One header line plus 40 stops in all.
    expect(kept.length - 1 + Number(match?.[1])).toBe(40)
})

test('a schedule cut by one line says "1 more line"', async ({ page }) => {
    /*
        Swapping the last line for the count leaves the same number of lines,
        so dropping exactly one only makes room when the last line wraps - a
        long station name on the final stop. How many short stops put that case
        in reach depends on the font, so each locomotive here gets one more
        short stop than the last, all ending on the same long one, and the sweep
        has to pass through it: at some count everything fits, at the next the
        long stop alone is dropped.
    */
    const LONG = `Terminus ${'with a very long station name '.repeat(3)}`
    const short = (i: number) => ({
        station: `Stop ${i + 1}`,
        wait_conditions: [{ type: 'inactivity', compare_type: 'and', ticks: 300 }],
    })
    const count = 16
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: Array.from({ length: count }, (_, i) => locomotive(i + 1)),
            schedules: Array.from({ length: count }, (_, i) => ({
                locomotives: [i + 1],
                schedule: {
                    records: [
                        ...Array.from({ length: i }, (_, j) => short(j)),
                        { station: LONG, wait_conditions: [] },
                    ],
                },
            })),
        })
    )

    const endings: string[] = []
    for (let i = 0; i < count; i++) {
        const shown = (await infoText(page, i + 1)).split('\n')
        const total = i + 2 // the header, i short stops, the long one
        const last = shown.at(-1) ?? ''
        const match = /^\.\.\. (\d+) more (lines?)$/.exec(last)
        if (match === null) {
            expect(shown, `locomotive ${i + 1} shown whole`).toHaveLength(total)
            expect(last).toBe(`${i + 1}. ${LONG}`)
            endings.push('whole')
            continue
        }
        const dropped = Number(match[1])
        expect(match[2], `"${last}"`).toBe(dropped === 1 ? 'line' : 'lines')
        expect(shown.length - 1 + dropped, `locomotive ${i + 1}`).toBe(total)
        endings.push(last)
    }

    const one = endings.indexOf('... 1 more line')
    expect(one, endings.join(' | ')).toBeGreaterThan(0)
    // Every schedule shorter than that one fits; the one cut by one is the
    // first that does not.
    expect(
        endings.slice(0, one).every(e => e === 'whole'),
        endings.join(' | ')
    ).toBe(true)
})

test('an entity with no detail line does not keep the schedule shown before it', async ({
    page,
}) => {
    /*
        The panel is updated in place, not rebuilt, so every branch has to
        replace the detail line or clear it. A chest writes none of its own,
        and without the clear it went on showing the locomotive's schedule
        under "Name: Steel chest".
    */
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [
                locomotive(1),
                { entity_number: 2, name: 'steel-chest', position: { x: 0.5, y: 6.5 } },
            ],
            schedules: [{ locomotives: [1], schedule: MEASURED }],
        })
    )

    expect(await infoText(page, 1)).toBe(MEASURED_LINES)
    expect(await infoText(page, 1, 2)).toBe('')
})

test('the live panel follows a schedule pasted onto the hovered locomotive, and its undo', async ({
    page,
}) => {
    /*
        A paste lands on the entity under the pointer, so the panel is already
        showing that locomotive when its schedule changes - no hover comes
        after to redraw it. `Blueprint.setSchedule` emits `schedule` from its
        history entry, which is what makes the undo and the redo refresh too.
    */
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await suppressOverlays(page)
    await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [locomotive(1), locomotive(2)],
            schedules: [{ locomotives: [1], schedule: MEASURED }],
        })
    )

    await hoverEntity(page, 2)
    expect(await liveText(page)).toBe('Schedule: none')

    // Shift+right-click copies from the source, Shift+click pastes on the target.
    await hoverEntity(page, 1)
    await page.keyboard.down('Shift')
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await hoverEntity(page, 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Shift')

    expect(await liveText(page)).toBe(MEASURED_LINES)

    await page.keyboard.press('Control+KeyZ')
    expect(await liveText(page)).toBe('Schedule: none')

    await page.keyboard.press('Control+KeyY')
    expect(await liveText(page)).toBe(MEASURED_LINES)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
