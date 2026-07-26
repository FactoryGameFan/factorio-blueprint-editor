import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { buildAllRecipesBlueprint } from './helpers/all-recipes-blueprint'
import { loadBlueprint, waitForEditor, RecipeShapeTally } from './helpers/fbe-test-api'

/*
    Coverage net for the readers of a recipe's ingredient and result lists, ahead
    of clearing EntityInfoPanel's strictNullChecks errors (issue #22).

    The two fields arrive in three runtime shapes while typed-factorio describes
    two: a populated array, nothing at all, or `{}`. The last is how the exporter
    writes an empty Lua table, which JSON cannot distinguish from an empty map -
    and it is neither undefined nor iterable, so it walks through a `!== undefined`
    guard and a `?? []` alike and throws in the first for-of downstream.

    The three readers each defend against a different subset:

      - Entity.assemblerHasFluidInputs/Outputs guard `!recipe.ingredients`, which
        catches the missing shape and not `{}`
      - OverlayContainer.createEntityInfo does `?? []`, same
      - EntityInfoPanel reads both fields bare, so every shape but an array throws

    Only the last is user-visible as a crash; the other two sit under a try/catch
    or degrade quietly, which is why this pins values rather than just absence.

    None of the existing specs reach this. They walk the entities of real bases and
    of the synthetic all-entities blueprint, and the recipes carrying the awkward
    shapes are ones no real base contains and no entity carries by default: the ten
    parameter-N placeholders that a parametrised blueprint uses, recipe-unknown,
    and Space Age's biter-egg.

    The fixture is a fixed point, not a snapshot to regenerate. A THREW turning
    into a value is this bug being fixed; a value turning into THREW, or a value
    changing, is a regression - review it either way. Run with UPDATE_RECIPE_SHAPES=1
    to rewrite it deliberately.
*/

const FIXTURE = resolve(process.cwd(), 'tests/__fixtures__/recipe-shapes.json')

/** The placeholders a parametrised blueprint sets its machines to. */
const PARAMETER_RECIPES = Array.from({ length: 10 }, (_, i) => `parameter-${i}`)

test('every recipe shape reaches its readers the same way it did before', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const { source, recipes } = buildAllRecipesBlueprint()
    expect(recipes.length).toBeGreaterThan(500)

    /*
        Decoded but never loaded. loadBp renders, and rendering asks every crafting
        machine for assemblerHasFluidInputs from inside EntityContainer's
        constructor, so on the `{}` recipes the load itself dies before any reader
        can be tallied one at a time. That crash is the same bug and is asserted
        separately, once it is fixed.
    */
    const tally: RecipeShapeTally = await page.evaluate(async (src: string) => {
        const decoded = await window.__fbe_test.getBlueprintOrBookFromSource(src)
        return window.__fbe_test.recipeShapeTally(decoded)
    }, source)

    /*
        Exact, and it is worth keeping exact. This count was `recipes.length - 2`
        while the name migrations ran unconditionally (issue #40): the blueprint
        declares a 2.0 version, and "stack-inserter" and "fusion-reactor-equipment"
        were still being rewritten to "bulk-inserter" and
        "fission-reactor-equipment", which are recipes of their own, so two of the
        placed machines came back merged into another entry. Every recipe arriving
        under the name it was placed with is what says the migrations are gated.
    */
    expect(Object.keys(tally).length).toBe(recipes.length)

    // The shapes this exists for. If the corpus ever stops carrying them the
    // fixture would still pass while testing nothing.
    for (const name of [...PARAMETER_RECIPES, 'recipe-unknown', 'biter-egg']) {
        expect(tally, `${name} missing from the tally`).toHaveProperty([name])
    }

    if (process.env.UPDATE_RECIPE_SHAPES) {
        writeFileSync(FIXTURE, `${JSON.stringify(sorted(tally), null, 4)}\n`)
    }
    expect(sorted(tally)).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf-8')))

    /*
        Not asserted empty: the readers under test are reached directly here, and
        a throw inside one is the recorded behaviour rather than a page error. Any
        page error would be something else going wrong, so it is still reported.
    */
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    The severe half of the same bug, and the reason the tally above decodes rather
    than loads. Rendering asks every crafting machine for assemblerHasFluidInputs
    from inside EntityContainer's constructor, so before the fix a blueprint
    holding a machine set to recipe-unknown or biter-egg took the whole load down
    with it - not a missing overlay or a blank panel, no blueprint at all.

    Asserted rather than tallied because there is only one outcome worth having.
*/
test('a blueprint whose machines carry every recipe loads', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const { source, recipes } = buildAllRecipesBlueprint()
    await loadBlueprint(page, source)

    const loaded = await page.evaluate(() => window.__fbe_test.recipeShapeTally())
    expect(Object.keys(loaded).length).toBeGreaterThanOrEqual(recipes.length - 2)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

function sorted(tally: RecipeShapeTally): RecipeShapeTally {
    return Object.fromEntries(Object.entries(tally).sort(([a], [b]) => a.localeCompare(b)))
}
