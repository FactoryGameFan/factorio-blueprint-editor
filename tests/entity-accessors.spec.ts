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

    So this walks every blueprint in every test book and tallies, per accessor,
    how many entities return a value, an empty list, or nothing. A getter that
    starts returning [] where it used to return undefined moves a number here.

    The counts are a fixed point, not a snapshot to refresh. A diff means
    behaviour changed; that may be correct, but review it as a behaviour change
    rather than re-recording it blind.

    Entity needs FD loaded from data.json, so this is Playwright rather than
    vitest - see CLAUDE.md for the two servers that have to be up.
*/

const TALLIED = [
    'recipe',
    'directionType',
    'railLayer',
    'filters',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'moduleSlots',
    'combinatorConditions',
    'inserterStackSize',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

type Tally = { value: number; empty: number; nothing: number; threw: number }

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
        async ({ strings, accessors }: { strings: string[]; accessors: string[] }) => {
            const api = (window as any).__fbe_test
            const out: Record<string, Tally> = {}
            const bump = (key: string, field: keyof Tally): void => {
                out[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
                out[key][field] += 1
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
                        for (const key of accessors) {
                            let v: unknown
                            try {
                                v = e[key]
                            } catch {
                                // some accessors throw on pre-2.0 shapes; that is behaviour too
                                bump(key, 'threw')
                                continue
                            }
                            if (v === undefined || v === null) bump(key, 'nothing')
                            else if (Array.isArray(v) && v.length === 0) bump(key, 'empty')
                            else bump(key, 'value')
                        }
                    }
                }
            }

            return { entityCount, blueprintCount, accessors: out }
        },
        { strings: sources, accessors: [...TALLIED] }
    )

    expect(tally).toEqual(EXPECTED)
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    Captured from the accessors as they behaved before the strictNullChecks
    cleanup, across all 578 blueprints in wormeyman-tests/. Treat as a fixed
    point: see the note at the top of this file before changing any of it.
*/
const EXPECTED: {
    entityCount: number
    blueprintCount: number
    accessors: Record<string, Tally>
} = {
    entityCount: 408290,
    blueprintCount: 578,
    accessors: {
        acceptedFilters: {
            value: 59504,
            empty: 348786,
            nothing: 0,
            threw: 0,
        },
        acceptedModules: {
            value: 22073,
            empty: 386217,
            nothing: 0,
            threw: 0,
        },
        acceptedRecipes: {
            value: 15927,
            empty: 392363,
            nothing: 0,
            threw: 0,
        },
        assemblerHasFluidInputs: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        canBeRotated: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        combinatorConditions: {
            value: 2363,
            empty: 0,
            nothing: 405927,
            threw: 0,
        },
        constantCombinatorFilters: {
            value: 944,
            empty: 407346,
            nothing: 0,
            threw: 0,
        },
        directionType: {
            value: 49792,
            empty: 0,
            nothing: 358498,
            threw: 0,
        },
        displayPanelIcon: {
            value: 355,
            empty: 0,
            nothing: 407935,
            threw: 0,
        },
        filterMode: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        filterSlots: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        filters: {
            value: 12786,
            empty: 4427,
            nothing: 391077,
            threw: 0,
        },
        generateConnector: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        inserterStackSize: {
            value: 50564,
            empty: 0,
            nothing: 357726,
            threw: 0,
        },
        maxWireDistance: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        mayCraftWithFluid: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        moduleSlots: {
            value: 408290,
            empty: 0,
            nothing: 0,
            threw: 0,
        },
        modules: {
            value: 21201,
            empty: 387089,
            nothing: 0,
            threw: 0,
        },
        possibleRotations: {
            value: 318719,
            empty: 89571,
            nothing: 0,
            threw: 0,
        },
        railLayer: {
            value: 749,
            empty: 0,
            nothing: 407541,
            threw: 0,
        },
        recipe: {
            value: 10455,
            empty: 0,
            nothing: 397835,
            threw: 0,
        },
        splitterInputPriority: {
            value: 226,
            empty: 0,
            nothing: 408064,
            threw: 0,
        },
        splitterOutputPriority: {
            value: 2114,
            empty: 0,
            nothing: 406176,
            threw: 0,
        },
        station: {
            value: 215,
            empty: 0,
            nothing: 408075,
            threw: 0,
        },
        trainStopColor: {
            value: 5800,
            empty: 0,
            nothing: 402490,
            threw: 0,
        },
    },
}
