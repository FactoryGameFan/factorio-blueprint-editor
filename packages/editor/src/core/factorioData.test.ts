import { describe, expect, it } from 'vite-plus/test'
import { RecipePrototype } from 'factorio:prototype'
import { recipeIngredients, recipeResults } from './factorioData'

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
