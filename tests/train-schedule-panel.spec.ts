import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

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

const infoText = (page: Page, n: number): Promise<string> =>
    page.evaluate((e: number) => window.__fbe_test.entityInfoText(e), n)

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

    const lines = [
        'Schedule (group Ore Run):',
        '1. Alpha: Time passed 10 s',
        '2. Beta: Full cargo',
        'Interrupts:',
        'Refuel - when Passenger not present',
        '  -> Depot: Inactivity 5 s',
    ].join('\n')
    expect(await infoText(page, 1)).toBe(lines)
    expect(await infoText(page, 3)).toBe(lines)
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
