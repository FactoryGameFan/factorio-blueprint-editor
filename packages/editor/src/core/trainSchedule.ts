import { ICondition, IScheduleWaitCondition, ScheduleData } from '../types'

/*
    A train schedule as text, for the read-only lines the entity info panel shows
    on a locomotive (issue #346).

    A blueprint carries a schedule in one of two shapes - the pre-2.0 flat list
    of `{station, wait_conditions}`, and 2.0's `{records, group, interrupts}` -
    and the editor keeps whichever it was given verbatim. `normaliseSchedule`
    folds both into the 2.0 one so the text is written once.

    Every list is read through `Array.isArray` rather than trusted. The 2.0 shape
    is checked no further than "an object" by `blueprintSchema.json`, and an
    empty Lua table comes out as `{}` - the probe behind
    `tools/oracle/fixtures/copy-settings-schedule.json` dumps an empty schedule's
    `records` exactly that way.
*/

export interface ScheduleStop {
    station?: string
    conditions: IScheduleWaitCondition[]
    temporary: boolean
}

export interface ScheduleInterrupt {
    name?: string
    conditions: IScheduleWaitCondition[]
    targets: ScheduleStop[]
}

export interface NormalisedSchedule {
    group?: string
    stops: ScheduleStop[]
    interrupts: ScheduleInterrupt[]
}

const list = <T>(value: readonly T[] | undefined): readonly T[] =>
    Array.isArray(value) ? value : []

function toStop(record: {
    station?: string
    wait_conditions?: readonly IScheduleWaitCondition[]
    temporary?: boolean
}): ScheduleStop {
    return {
        station: typeof record.station === 'string' ? record.station : undefined,
        conditions: [...list(record.wait_conditions)],
        temporary: record.temporary === true,
    }
}

export function normaliseSchedule(schedule: ScheduleData): NormalisedSchedule {
    if (Array.isArray(schedule)) {
        return { stops: schedule.map(toStop), interrupts: [] }
    }
    return {
        group:
            typeof schedule.group === 'string' && schedule.group !== ''
                ? schedule.group
                : undefined,
        stops: list(schedule.records).map(toStop),
        interrupts: list(schedule.interrupts).map(i => ({
            name: typeof i.name === 'string' ? i.name : undefined,
            conditions: [...list(i.conditions)],
            targets: list(i.targets).map(toStop),
        })),
    }
}

const seconds = (ticks: number | undefined): string =>
    typeof ticks === 'number' ? ` ${Math.round((ticks / 60) * 100) / 100} s` : ''

/*
    Labels for the condition names that are known. Every 2.0 name here was
    observed in a game-written blueprint: `time`, `inactivity`, `full` and
    `passenger_not_present` in `copy-settings-schedule.json`, the rest in the
    schedules of the committed corpus (test-blueprints/EARN). The hyphenated ones
    are the pre-2.0 schema's own enum (`WaitConditionType`), which spells
    `passenger-not-present` where 2.0 writes `passenger_not_present`.

    Anything else shows its raw type rather than a guessed label, and so do the
    ones that carry a circuit condition (`circuit`, `item_count`, `fluid_count`,
    `fuel_item_count_any` and their like), with that condition after it.
*/
const LABELS: Record<string, (c: IScheduleWaitCondition) => string> = {
    time: c => `Time passed${seconds(c.ticks)}`,
    inactivity: c => `Inactivity${seconds(c.ticks)}`,
    full: () => 'Full cargo',
    empty: () => 'Empty cargo',
    not_empty: () => 'Cargo not empty',
    passenger_present: () => 'Passenger present',
    passenger_not_present: () => 'Passenger not present',
    at_station: c => `At station ${c.station ?? '?'}`,
    not_at_station: c => `Not at station ${c.station ?? '?'}`,
    specific_destination_not_full: c => `Destination not full ${c.station ?? '?'}`,
    destination_full_or_no_path: () => 'Destination full or no path',
    'passenger-present': () => 'Passenger present',
    'passenger-not-present': () => 'Passenger not present',
}

const operand = (c: ICondition): string => {
    const second = c.second_signal?.name
    return second ?? (typeof c.constant === 'number' ? String(c.constant) : '0')
}

export function describeWaitCondition(condition: IScheduleWaitCondition): string {
    const label = Object.hasOwn(LABELS, condition.type) ? LABELS[condition.type] : undefined
    if (label) return label(condition)

    const c = condition.condition
    if (c?.first_signal?.name === undefined) return String(condition.type)
    return `${condition.type} (${c.first_signal.name} ${c.comparator ?? '<'} ${operand(c)})`
}

/**
 * The conditions joined the way the game reads them: each one's `compare_type`
 * says how it combines with the conditions before it, so the first one's is
 * never shown.
 */
export function describeWaitConditions(conditions: readonly IScheduleWaitCondition[]): string {
    return conditions
        .map((c, i) =>
            i === 0
                ? describeWaitCondition(c)
                : `${c.compare_type === 'or' ? 'or' : 'and'} ${describeWaitCondition(c)}`
        )
        .join(' ')
}

function stopLine(stop: ScheduleStop): string {
    const name = stop.station ?? '(rail)'
    const temporary = stop.temporary ? ' (temporary)' : ''
    const conditions = describeWaitConditions(stop.conditions)
    return conditions === '' ? `${name}${temporary}` : `${name}${temporary}: ${conditions}`
}

/** One line per stop, then the interrupts, headed by the group when there is one. */
export function scheduleLines(schedule: ScheduleData | undefined): string[] {
    if (schedule === undefined) return ['Schedule: none']

    const s = normaliseSchedule(schedule)
    const lines = [s.group === undefined ? 'Schedule:' : `Schedule (group ${s.group}):`]
    if (s.stops.length === 0) lines.push('  no stops')
    for (const [i, stop] of s.stops.entries()) {
        lines.push(`${i + 1}. ${stopLine(stop)}`)
    }

    if (s.interrupts.length > 0) {
        lines.push('Interrupts:')
        for (const interrupt of s.interrupts) {
            const when = describeWaitConditions(interrupt.conditions)
            const name = interrupt.name ?? '(unnamed)'
            lines.push(when === '' ? name : `${name} - when ${when}`)
            for (const target of interrupt.targets) {
                lines.push(`  -> ${stopLine(target)}`)
            }
        }
    }
    return lines
}
