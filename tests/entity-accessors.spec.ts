import { test, expect } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    Characterization test for Entity's accessor surface.

    Most of Entity is getters over m_rawEntity, and the blueprint format has most
    of those fields optional. The getters did not say so, which is what issue #22
    is fixing here. Widening a return type to `| undefined` is meant to be a
    type-level change, but it is easy to "fix" one by returning [] or 0 instead,
    which silently changes what every caller sees - and Entity has no other
    coverage that would notice.

    So this walks every blueprint in every test book and records, per accessor,
    what came back. It does that in two records, because one instrument does not
    fit all twenty-five accessors.

    `shape` holds the eleven whose value set is open, tallied into four buckets:
    a value, an empty list, nothing, or threw. That is what catches a getter
    returning [] where it used to return undefined, and it is what this file has
    always done.

    `values` holds the fourteen whose value set is small and closed, recorded as
    exact histograms keyed by the stringified value (issue #189). A bucket tally
    cannot see a value, so 0 and 9 both read as `value` and a wholesale swap of
    left and right moves no number; and eight of these accessors are total
    functions, whose four-bucket tally was pinned at exactly entityCount and so
    could not move at all. That is the structural reason #186's splitter bug
    survived the corpus.

    Both records are a fixed point, not a snapshot to refresh. A diff means
    behaviour changed; that may be correct, but review it as a behaviour change
    rather than re-recording it blind. The one sanctioned way to move a `values`
    histogram is to prove it folds back into the four buckets committed before
    the change - see the provenance note at the foot of this file.

    Entity needs FD loaded from data.json, so this is Playwright rather than
    vitest - see CLAUDE.md for the two servers that have to be up.
*/

/*
    Eleven accessors whose value set is open, so only the shape of what they
    answer can be pinned. Measured 2026-08-10 across the corpus: `filters` takes
    1018 distinct values, `recipe` 264, `combinatorConditions` 228. The three
    `accepted*` lists have few distinct values but enormous keys - one
    `acceptedFilters` value serializes to roughly 54,000 characters - and the
    only compact key for those is a hash, which names nothing when it moves.
*/
const TALLIED_SHAPE = [
    'recipe',
    'filters',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'combinatorConditions',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
] as const

/*
    Fourteen accessors whose value set is small and closed, recorded exactly.

    This is issue #189. The four-bucket tally cannot see a value, so 0 and 9 both
    read as `value` - which is the structural reason #186's splitter bug survived
    a 578-blueprint corpus. Worse, eight of these are total functions (never
    undefined, never throwing, never an array), so their old tally was pinned at
    exactly entityCount and could not move at all.

    Measured maximum is 10 distinct values (`inserterStackSize`); the whole group
    is 52 fixture entries, replacing the 56 bucket numbers it used to occupy.

    `possibleRotations` is here despite being an array because its keys are short
    and readable, unlike the `accepted*` lists above. The line between the two
    lists is "small closed value set", which only measurement establishes - note
    `recipe` is a scalar and belongs in the other list.
*/
const TALLIED_VALUES = [
    'directionType',
    'railLayer',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'moduleSlots',
    'inserterStackSize',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

type Tally = { value: number; empty: number; nothing: number; threw: number }
type Histogram = Record<string, number>

test('Entity accessors report the same shape across every test blueprint', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const sources = files.map(f => readBlueprintString(f.filePath))

    const tally = await page.evaluate(
        async ({
            strings,
            shapeKeys,
            valueKeys,
        }: {
            strings: string[]
            shapeKeys: string[]
            valueKeys: string[]
        }) => {
            const api = (window as any).__fbe_test
            const shape: Record<string, Tally> = {}
            const values: Record<string, Histogram> = {}

            const bumpShape = (key: string, field: keyof Tally): void => {
                shape[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
                shape[key][field] += 1
            }

            const bumpValue = (key: string, bucket: string): void => {
                values[key] ??= {}
                values[key][bucket] = (values[key][bucket] ?? 0) + 1
            }

            /*
                One key function for every recorded accessor. `undefined` and
                `null` are distinct on purpose - inserterStackSize answers null
                where every other optional answers undefined, and collapsing them
                would hide a getter changing which one it uses.
            */
            const keyOf = (v: unknown): string => {
                if (v === undefined) return 'undefined'
                if (v === null) return 'null'
                if (typeof v === 'object') return JSON.stringify(v)
                return String(v as string | number | boolean | symbol | bigint)
            }

            let entityCount = 0
            let blueprintCount = 0

            for (const str of strings) {
                const loaded = await api.getBlueprintOrBookFromSource(str)
                const isBook = typeof loaded.selectBlueprint === 'function'
                const count = isBook ? loaded.lastBookIndex + 1 : 1

                for (let i = 0; i < count; i++) {
                    const bp = isBook ? loaded.selectBlueprint(i) : loaded
                    blueprintCount += 1
                    for (const e of bp.entities.values()) {
                        entityCount += 1

                        for (const key of shapeKeys) {
                            let v: unknown
                            try {
                                v = e[key]
                            } catch {
                                // some accessors throw on pre-2.0 shapes; that is behaviour too
                                bumpShape(key, 'threw')
                                continue
                            }
                            if (v === undefined || v === null) bumpShape(key, 'nothing')
                            else if (Array.isArray(v) && v.length === 0) bumpShape(key, 'empty')
                            else bumpShape(key, 'value')
                        }

                        for (const key of valueKeys) {
                            let v: unknown
                            try {
                                v = e[key]
                            } catch {
                                bumpValue(key, 'THREW')
                                continue
                            }
                            bumpValue(key, keyOf(v))
                        }
                    }
                }
            }

            return { entityCount, blueprintCount, shape, values }
        },
        { strings: sources, shapeKeys: [...TALLIED_SHAPE], valueKeys: [...TALLIED_VALUES] }
    )

    /*
        Four guards on the histograms, before the fixture comparison so that a
        structural problem is named rather than arriving as a diff.

        The first is static and needs no tally: TALLIED_VALUES and EXPECTED.values
        must declare the same keys. The fixture is an independent artifact that
        does not move when the list does, so this is the one that catches an
        accessor removed from (or added to) TALLIED_VALUES outright, before any
        histogram is read.

        The second checks that every accessor in TALLIED_VALUES was recorded at
        all, against the list itself rather than the fixture - comparing the
        fixture to itself would prove nothing. That catches an accessor that
        stays declared in TALLIED_VALUES but is skipped by the collection loop,
        so it never appears as a key in tally.values for the loop below to see.
        It does not catch removing the accessor from TALLIED_VALUES itself -
        that also removes it from the collection loop's own input, so both sides
        of this check drop it together, which is why the static check above it
        exists.

        Every histogram that IS recorded must account for every entity. That is
        free and always true, and it catches a recording bug that silently
        under-counts an accessor for some entities - which the toEqual would
        otherwise report as an unexplained diff in a fixture nobody wants to
        re-record.

        And no histogram may exceed 16 distinct keys. The measured maximum is 10
        (inserterStackSize). An accessor that turns open-set - which is what
        would happen if one of these started answering a name or a recipe - then
        fails by name here instead of dumping a thousand-line toEqual diff and
        inviting someone to paste it in.
    */
    expect(
        [...TALLIED_VALUES].sort(),
        'TALLIED_VALUES and EXPECTED.values disagree - an accessor was\n' +
            'added or removed without the fixture following'
    ).toEqual(Object.keys(EXPECTED.values).sort())

    const recorded = Object.keys(tally.values).sort()
    expect(
        recorded,
        'every TALLIED_VALUES accessor must be recorded - a missing one\n' +
            'is a dropped accessor, not a changed fixture'
    ).toEqual([...TALLIED_VALUES].sort())

    for (const [key, hist] of Object.entries(tally.values)) {
        const total = Object.values(hist).reduce((a, b) => a + b, 0)
        expect(total, `${key} histogram does not cover every entity`).toBe(tally.entityCount)
        expect(
            Object.keys(hist).length,
            `${key} has more distinct values than a closed set should - ` +
                `move it to TALLIED_SHAPE or find out why it changed`
        ).toBeLessThanOrEqual(16)
    }

    expect(tally).toEqual(EXPECTED)
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The original fixed point here was captured from the accessors as they
    behaved before the strictNullChecks cleanup (issue #22), against the
    578-blueprint wormeyman-tests/ corpus. That corpus is gone: it was
    replaced by the 367-blueprint test-blueprints/ (issue #186), which did not
    exist at cleanup time, so the counts below are not "before cleanup"
    values - they are a live capture, taken 2026-08-05 by a throwaway recorder
    run against test-blueprints/ with the accessors as they behave today,
    after the recorder had first proved it reproduced the old fixture byte for
    byte against the old corpus. The recorder has since been deleted; git
    history at 13caa953 is the recipe if the corpus moves again. Treat as a
    fixed point: see the note at the top of this file before changing any of
    it - with the recorder gone, a diff here can only be reviewed as a
    behaviour change, never blindly re-recorded.

    The eleven `shape` tallies below are that 2026-08-05 capture, unchanged.

    The fourteen `values` histograms were recaptured on 2026-08-10 (issue #189).
    That recapture is not a blind re-record, which the rule above forbids: each
    histogram folds back into the four buckets this file committed before the
    change - undefined/null to `nothing`, THREW to `threw`, [] to `empty`,
    everything else to `value` - and all fourteen reproduce the committed numbers
    exactly. splitterOutputPriority's {left:726, right:874} folds to value 1600
    against a committed value of 1600; inserterStackSize's null:302999 folds to
    nothing 302999 against a committed 302999. So these are the same fixed point
    at higher resolution, not a new snapshot.
*/
const EXPECTED: {
    entityCount: number
    blueprintCount: number
    shape: Record<string, Tally>
    values: Record<string, Histogram>
} = {
    entityCount: 347725,
    blueprintCount: 367,
    shape: {
        acceptedFilters: { value: 54004, empty: 293721, nothing: 0, threw: 0 },
        acceptedModules: { value: 18771, empty: 328954, nothing: 0, threw: 0 },
        acceptedRecipes: { value: 14366, empty: 333359, nothing: 0, threw: 0 },
        combinatorConditions: { value: 2656, empty: 0, nothing: 345069, threw: 0 },
        constantCombinatorFilters: { value: 988, empty: 346737, nothing: 0, threw: 0 },
        displayPanelIcon: { value: 523, empty: 0, nothing: 347202, threw: 0 },
        filters: { value: 16605, empty: 4258, nothing: 326862, threw: 0 },
        modules: { value: 17476, empty: 330249, nothing: 0, threw: 0 },
        recipe: { value: 9345, empty: 0, nothing: 338380, threw: 0 },
        station: { value: 195, empty: 0, nothing: 347530, threw: 0 },
        trainStopColor: { value: 2717, empty: 0, nothing: 345008, threw: 0 },
    },
    values: {
        assemblerHasFluidInputs: { false: 344517, true: 3208 },
        canBeRotated: { false: 103215, true: 244510 },
        directionType: { input: 14246, output: 14265, undefined: 319214 },
        filterMode: { blacklist: 139, whitelist: 347586 },
        filterSlots: { '0': 293721, '1': 5910, '5': 44861, '30': 3233 },
        generateConnector: { false: 314925, true: 32800 },
        inserterStackSize: {
            '1': 408,
            '2': 28,
            '3': 30441,
            '4': 8,
            '5': 1,
            '7': 444,
            '8': 113,
            '10': 4,
            '12': 13279,
            null: 302999,
        },
        mayCraftWithFluid: { false: 342259, true: 5466 },
        maxWireDistance: {
            '0': 118354,
            '7.5': 1178,
            '9': 225198,
            '10': 8,
            '18': 1513,
            '32': 1474,
        },
        moduleSlots: { '0': 330249, '2': 10337, '3': 1718, '4': 5167, '5': 221, '8': 33 },
        possibleRotations: {
            '[]': 90879,
            '[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]': 4621,
            '[0,2,4,6,8,10,12,14]': 39730,
            '[0,4]': 517,
            '[0,4,8,12]': 211978,
        },
        railLayer: { elevated: 749, undefined: 346976 },
        splitterInputPriority: { left: 164, right: 129, undefined: 347432 },
        splitterOutputPriority: { left: 726, right: 874, undefined: 346125 },
    },
}
