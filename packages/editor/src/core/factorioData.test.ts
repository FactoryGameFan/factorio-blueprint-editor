import { describe, expect, it, vi } from 'vite-plus/test'
import { RecipePrototype } from 'factorio:prototype'
import FD, { loadData, localisedName, recipeIngredients, recipeResults } from './factorioData'

/*
    recipeIngredients/recipeResults exist because the two fields arrive in three
    runtime shapes while typed-factorio describes two of them. These pin the three
    shapes; that data.json still holds all three, and what each consumer does with
    them, is pinned in tests/recipe-shapes.spec.ts, which has FD loaded.
*/

/** The helpers only read the two fields; nothing else of a recipe is involved. */
const recipe = (fields: Partial<RecipePrototype>): RecipePrototype =>
    ({ type: 'recipe', name: 'test', ...fields }) as RecipePrototype

describe('recipeIngredients / recipeResults', () => {
    it('passes a populated list through unchanged', () => {
        const ingredients = [{ type: 'item', name: 'iron-plate', amount: 2 }]
        const results = [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
        const r = recipe({ ingredients, results } as Partial<RecipePrototype>)

        expect(recipeIngredients(r)).toBe(ingredients)
        expect(recipeResults(r)).toBe(results)
    })

    it('answers an empty list for an omitted field, as the parameter-N recipes have', () => {
        const r = recipe({})

        expect(recipeIngredients(r)).toEqual([])
        expect(recipeResults(r)).toEqual([])
    })

    it('answers an empty list for `{}`, which is how an empty Lua table encodes', () => {
        // Neither undefined nor an array, so `!== undefined` and `?? []` both let it
        // through - this is the shape that threw "ingredients is not iterable".
        const r = recipe({ ingredients: {}, results: {} } as unknown as Partial<RecipePrototype>)

        expect(recipeIngredients(r)).toEqual([])
        expect(recipeResults(r)).toEqual([])
    })

    it('answers an empty list independently per field, as biter-egg needs', () => {
        const results = [{ type: 'item', name: 'biter-egg', amount: 5 }]
        const r = recipe({ ingredients: {}, results } as unknown as Partial<RecipePrototype>)

        expect(recipeIngredients(r)).toEqual([])
        expect(recipeResults(r)).toBe(results)
    })
})

/*
    localisedName covers the same kind of gap one field over: typed-factorio types
    localised_name as the nested LocalisedString Factorio resolves at runtime,
    while the exporter resolves it first, so every one of the 1352 in data.json is
    a plain string. The four readers were split between assigning it to a pixi
    Text (a type error), interpolating it into a template literal (silently
    "[object Object]" for any other shape) and an `as string` cast.
*/
describe('localisedName', () => {
    it('passes the resolved string every prototype in data.json actually carries', () => {
        expect(localisedName({ localised_name: 'Iron plate' })).toBe('Iron plate')
    })

    it('answers an empty string where the optional field is absent', () => {
        expect(localisedName({})).toBe('')
    })

    it('renders the nested form rather than dropping it', () => {
        // The shape Factorio itself uses. Nothing in data.json has it today, and
        // the point of joining rather than returning '' is that one arriving
        // later looks wrong on screen instead of vanishing.
        expect(localisedName({ localised_name: ['item-name.iron-plate'] })).toBe(
            'item-name.iron-plate'
        )
    })

    it('flattens a nested form with substitutions', () => {
        expect(localisedName({ localised_name: ['item-name.plate', ['metal.iron'], 'x2'] })).toBe(
            'item-name.plate metal.iron x2'
        )
    })

    it('stringifies the number and boolean forms LocalisedString allows', () => {
        expect(localisedName({ localised_name: 42 })).toBe('42')
        expect(localisedName({ localised_name: false })).toBe('false')
    })
})

/*
    Reading FD before loadData has run - issue #109.

    An unloaded FD used to be silent. Every property was simply absent, so the
    first read answered undefined and the failure surfaced wherever that undefined
    was next indexed: the reported shape was `Cannot read properties of undefined
    (reading 'requester-chest')` thrown inside an AJV custom keyword, in a spec
    that had nothing to do with the change being made. Nothing in that message
    names FD, loadData, or data.json, so it reads as a regression in whatever code
    happens to be nearby.

    One test rather than four, walking the lifecycle in order, because the guards
    are one-shot and the module instance is shared: loadData replaces them, so a
    separate "it" asserting the throw would pass or fail on whether the one
    calling loadData had run first. Isolating them would need vi.resetModules and
    a dynamic import, which this package's tsconfig does not allow.
*/
describe('FD before loadData', () => {
    /** Every property loadData fills in, which is every property FD has. */
    const KEYS = [
        'items',
        'fluids',
        'signals',
        'recipes',
        'entities',
        'tiles',
        'inventoryLayout',
        'utilitySprites',
        'utilityConstants',
        'guiStyle',
        'defines',
        'getModulesFor',
    ] as const

    it('names the property and the cause, then gets out of the way once loaded', () => {
        // Unloaded. Every property says why it has nothing, naming itself.
        for (const key of KEYS) {
            expect(() => FD[key], `FD.${key} answered instead of throwing`).toThrow(
                new RegExp(`FD\\.${key} was read before data\\.json was loaded`)
            )
        }
        expect(() => FD.entities).toThrow(/loadData/)

        // Enough of a data.json for loadData to copy; it reads only `entities`.
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        loadData(JSON.stringify(Object.fromEntries(KEYS.map(k => [k, {}]))))
        log.mockRestore()

        for (const key of KEYS) {
            expect(() => FD[key], `FD.${key} still throws after loadData`).not.toThrow()
        }
        expect(FD.entities).toEqual({})

        /*
            And left plain data properties behind. This is the reason the guard is
            an accessor pair rather than a Proxy, and the reason loadData needed no
            changes to adopt it: the setter swaps itself for a data property on the
            first write. One that stayed an accessor would put a call on every FD
            read in the editor's hottest paths.
        */
        for (const key of KEYS) {
            const d = Object.getOwnPropertyDescriptor(FD, key)
            expect(d, `FD.${key} has no own property after loadData`).toBeDefined()
            expect(d !== undefined && 'value' in d, `FD.${key} is still an accessor`).toBe(true)
            expect(d?.writable, `FD.${key} is not writable`).toBe(true)
            expect(d?.enumerable, `FD.${key} is not enumerable`).toBe(true)
        }
    })
})
