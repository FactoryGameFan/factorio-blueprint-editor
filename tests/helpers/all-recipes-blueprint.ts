import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

/*
    Builds a blueprint holding one assembling machine per recipe in data.json, so
    every recipe's ingredient and result lists reach the code that reads them.

    The curated blueprints in test-blueprints/ only carry the recipes their authors
    used, and the shapes that break these readers are rare ones: the ten
    parameter-N placeholders omit both lists, and recipe-unknown and biter-egg hold
    `{}` rather than `[]`. Walking FD.recipes reaches all of them.

    The machine is assembling-machine-3 throughout. Entity.recipe does not check
    the recipe against the machine's crafting categories, and the readers under
    test do not either, so one machine type covers every recipe.
*/

const DATA_JSON = path.resolve(process.cwd(), 'packages/exporter/data/output/data.json')

/** Matches the version the test blueprints carry, so it parses as post-2.0. */
const FACTORIO_VERSION = 562949957025792

const MACHINE = 'assembling-machine-3'
/** Wider than the 3x3 machine so nothing overlaps. */
const STRIDE = 5
const PER_ROW = 26

export interface AllRecipesBlueprint {
    /** The encoded blueprint string, ready for getBlueprintOrBookFromSource */
    source: string
    /** Every recipe name placed in it, in the order they were placed */
    recipes: string[]
}

export function buildAllRecipesBlueprint(): AllRecipesBlueprint {
    const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8')) as {
        recipes: Record<string, unknown>
    }
    const recipes = Object.keys(data.recipes).sort()

    const entities = recipes.map((recipe, i) => ({
        entity_number: i + 1,
        name: MACHINE,
        // assembling-machine-3 is 3x3, so it sits on a tile centre
        position: {
            x: (i % PER_ROW) * STRIDE + 0.5,
            y: Math.floor(i / PER_ROW) * STRIDE + 0.5,
        },
        recipe,
    }))

    const json = JSON.stringify({
        blueprint: {
            item: 'blueprint',
            label: 'all recipes',
            entities,
            version: FACTORIO_VERSION,
        },
    })
    const source =
        '0' + zlib.deflateSync(Buffer.from(json, 'utf-8'), { level: 9 }).toString('base64')
    return { source, recipes }
}
