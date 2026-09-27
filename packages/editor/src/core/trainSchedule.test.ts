import { describe, expect, it } from 'vite-plus/test'
import { ScheduleData } from '../types'
import { describeWaitCondition, normaliseSchedule, scheduleLines } from './trainSchedule'

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
