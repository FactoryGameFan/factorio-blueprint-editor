import { describe, expect, it } from 'vite-plus/test'
import { ScheduleData } from '../types'
import {
    describeWaitCondition,
    moreLines,
    normaliseSchedule,
    scheduleLines,
    truncateLines,
} from './trainSchedule'

/*
    The text behind the locomotive's schedule lines in the entity info panel
    (issue #346).

    `MEASURED` is the `schedule` of the first case's `blueprintSchedules` in
    tools/oracle/fixtures/copy-settings-schedule.json, verbatim - what Factorio
    itself wrote into a blueprint. `LEGACY` is the same two stops in the pre-2.0
    flat shape, which `blueprintSchema.json` still describes.
*/

const MEASURED: ScheduleData = {
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

const LEGACY: ScheduleData = [
    { station: 'Alpha', wait_conditions: [{ type: 'time', compare_type: 'and', ticks: 600 }] },
    { station: 'Beta', wait_conditions: [{ type: 'full', compare_type: 'and' }] },
]

describe('normaliseSchedule', () => {
    it('reads the 2.0 shape the game writes', () => {
        const s = normaliseSchedule(MEASURED)
        expect(s.group).toBe('Ore Run')
        expect(s.stops.map(r => r.station)).toEqual(['Alpha', 'Beta'])
        expect(s.interrupts).toHaveLength(1)
        expect(s.interrupts[0].name).toBe('Refuel')
        expect(s.interrupts[0].targets.map(t => t.station)).toEqual(['Depot'])
    })

    it('reads the pre-2.0 flat list as the same stops with no group or interrupts', () => {
        const legacy = normaliseSchedule(LEGACY)
        const modern = normaliseSchedule(MEASURED)
        expect(legacy.stops).toEqual(modern.stops)
        expect(legacy.group).toBeUndefined()
        expect(legacy.interrupts).toEqual([])
    })

    it('treats an empty Lua table in place of a list as empty', () => {
        // The probe behind the fixture dumps an empty schedule's records as {}.
        const empty = { records: {}, interrupts: {} } as unknown as ScheduleData
        expect(normaliseSchedule(empty)).toEqual({
            group: undefined,
            stops: [],
            interrupts: [],
        })
    })
})

describe('describeWaitCondition', () => {
    it('labels the four 2.0 names the fixture observed', () => {
        expect(describeWaitCondition({ type: 'time', ticks: 600 })).toBe('Time passed 10 s')
        expect(describeWaitCondition({ type: 'inactivity', ticks: 300 })).toBe('Inactivity 5 s')
        expect(describeWaitCondition({ type: 'full' })).toBe('Full cargo')
        expect(describeWaitCondition({ type: 'passenger_not_present' })).toBe(
            'Passenger not present'
        )
    })

    it('labels names seen in the corpus, with the station they name', () => {
        // Verbatim from the schedules in test-blueprints/EARN.
        expect(describeWaitCondition({ type: 'not_empty', compare_type: 'or' })).toBe(
            'Cargo not empty'
        )
        expect(
            describeWaitCondition({
                type: 'at_station',
                compare_type: 'and',
                station: '[D] [item=train-stop] Depot 1-X',
            })
        ).toBe('At station [D] [item=train-stop] Depot 1-X')
    })

    it('shows the raw type and its condition for a circuit-style condition', () => {
        expect(
            describeWaitCondition({
                type: 'fuel_item_count_any',
                compare_type: 'and',
                condition: { first_signal: { name: 'coal' }, constant: 40, comparator: '<' },
            })
        ).toBe('fuel_item_count_any (coal < 40)')
    })

    it('shows the raw type for a name it has no label for', () => {
        expect(describeWaitCondition({ type: 'item_count' })).toBe('item_count')
        // Not an inherited property of the label table either.
        expect(describeWaitCondition({ type: 'toString' })).toBe('toString')
    })

    it('leaves the hyphenated schema spelling raw, since no game writes it', () => {
        expect(describeWaitCondition({ type: 'passenger-not-present' })).toBe(
            'passenger-not-present'
        )
    })
})

describe('scheduleLines', () => {
    it('writes one line per stop, then the interrupts', () => {
        expect(scheduleLines(MEASURED)).toEqual([
            'Schedule (group Ore Run):',
            '1. Alpha: Time passed 10 s',
            '2. Beta: Full cargo',
            'Interrupts:',
            'Refuel - when Passenger not present',
            '  -> Depot: Inactivity 5 s',
        ])
    })

    it('writes the same stops for the pre-2.0 shape', () => {
        expect(scheduleLines(LEGACY)).toEqual([
            'Schedule:',
            '1. Alpha: Time passed 10 s',
            '2. Beta: Full cargo',
        ])
    })

    it('joins conditions by the compare type of the later one', () => {
        const lines = scheduleLines({
            records: [
                {
                    station: 'Mixed',
                    wait_conditions: [
                        { type: 'full', compare_type: 'or' },
                        { type: 'time', compare_type: 'or', ticks: 1800 },
                        { type: 'inactivity', compare_type: 'and', ticks: 120 },
                    ],
                },
            ],
        })
        expect(lines[1]).toBe('1. Mixed: Full cargo or Time passed 30 s and Inactivity 2 s')
    })

    it('says so for a locomotive on no schedule, or a schedule with no stops', () => {
        expect(scheduleLines(undefined)).toEqual(['Schedule: none'])
        expect(scheduleLines({ records: [] })).toEqual(['Schedule:', '  no stops'])
    })
})

describe('truncateLines', () => {
    /*
        A stand-in for the panel's word wrap: every `WIDTH` characters of a line
        is one row, and a text fits in `rows` rows. `measured` adds up how many
        lines each call was handed, which is what a real wrap costs.
    */
    const WIDTH = 20
    const rowsOf = (shown: readonly string[]): number =>
        shown.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / WIDTH)), 0)
    function panel(rows: number) {
        const counter = { calls: 0, measured: 0 }
        const fits = (shown: readonly string[]): boolean => {
            counter.calls++
            counter.measured += shown.length
            return rowsOf(shown) <= rows
        }
        return { fits, counter }
    }

    /** The loop this replaced: drop one line, re-measure everything, repeat. */
    function oneAtATime(lines: readonly string[], rows: number): string[] {
        let shown = [...lines]
        for (let kept = lines.length - 1; kept > 0 && rowsOf(shown) > rows; kept--) {
            shown = [...lines.slice(0, kept), moreLines(lines.length - kept)]
        }
        return shown
    }

    const stops = (n: number): string[] => [
        'Schedule:',
        ...Array.from({ length: n }, (_, i) => `${i + 1}. Stop ${i + 1}`),
    ]

    it('returns lines that fit as they are', () => {
        const { fits } = panel(12)
        expect(truncateLines(stops(11), fits)).toEqual(stops(11))
    })

    it('keeps the first lines of a long schedule and counts the rest', () => {
        const { fits, counter } = panel(12)
        const shown = truncateLines(stops(200), fits)
        expect(shown).toEqual([...stops(10), '... 190 more lines'])
        // One full-length measurement, then short ones: not one per dropped line.
        expect(counter.calls).toBeLessThanOrEqual(10)
        expect(counter.measured).toBeLessThan(201 + 12 * 10)
    })

    it('says "1 more line" when only the last line is dropped', () => {
        /*
            Swapping the last line for the count is the same number of lines, so
            dropping exactly one only frees room when the last line wraps - a
            long station name as the final stop.
        */
        const lines = [...stops(9), `10. ${'Long station name '.repeat(3)}`]
        expect(rowsOf(lines)).toBe(13)
        const { fits } = panel(12)
        expect(truncateLines(lines, fits)).toEqual([...stops(9), '... 1 more line'])
    })

    it('keeps the first line even when nothing fits', () => {
        const { fits } = panel(1)
        expect(truncateLines(stops(5), fits)).toEqual(['Schedule:', '... 5 more lines'])
        expect(truncateLines(['Schedule: none'], panel(0).fits)).toEqual(['Schedule: none'])
    })

    it('cuts exactly where dropping one line at a time did', () => {
        // Every length against every panel height, with a wrapped line every
        // few stops so the cut does not fall on a regular grid.
        for (let n = 0; n <= 60; n++) {
            const lines = stops(n).map((line, i) =>
                i % 7 === 3 ? `${line} ${'x'.repeat(15 + (i % 3) * 20)}` : line
            )
            for (let rows = 0; rows <= 30; rows++) {
                expect(truncateLines(lines, panel(rows).fits), `${n} lines, ${rows} rows`).toEqual(
                    oneAtATime(lines, rows)
                )
            }
        }
    })
})
