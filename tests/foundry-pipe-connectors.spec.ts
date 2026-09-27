import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    The foundry's four fluid boxes all set `pipe_picture` to
    `__core__/graphics/empty.png`. Its pipe connectors live in two named
    working visualisations, `output-pipe` and `input-pipe`, which each fluid
    box switches on through `enable_working_visualisations`, and nothing read
    them, so every foundry drew with no connectors at all (issue #372).

    namedPipeLayers draws them, gated the way pipe_picture is: a recipe with a
    fluid ingredient draws `input-pipe`, one with a fluid result draws
    `output-pipe`, and a recipe with neither (or no recipe) draws neither. Each
    visualisation is one sprite per facing covering both pipes on that side,
    so each adds exactly one layer. The four blank pipe_pictures are still
    drawn, one per kept connection, and are in the counts below with the pipe
    covers.

    Every guard in namedPipeLayers returns nothing, so a regression drops the
    connectors with no error; this counts layers per facing to catch it. The
    order - the far-side connector before the body, the near one after - is
    in the sprite-data fixture's hash, not here.
*/

const FACINGS = [0, 4, 8, 12] as const

/**
 * Body and shadow, then per kept connection (two a side) a blank pipe_picture
 * and a pipe cover - there is no grid, so nothing is connected.
 */
const WITHOUT_CONNECTORS = {
    none: 2,
    'casting-iron': 6,
    'molten-iron': 6,
    'molten-iron-from-lava': 10,
} as const

/** What namedPipeLayers adds. A silent drop reads as 0. */
const CONNECTOR_LAYERS = {
    none: 0,
    /** input-pipe */
    'casting-iron': 1,
    /** output-pipe */
    'molten-iron': 1,
    /** both */
    'molten-iron-from-lava': 2,
} as const

const RECIPES = Object.keys(WITHOUT_CONNECTORS) as (keyof typeof WITHOUT_CONNECTORS)[]

/** One foundry per facing, all on `recipe`. */
function foundries(recipe: (typeof RECIPES)[number]): string {
    return encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: FACINGS.map((direction, i) => ({
            entity_number: i + 1,
            name: 'foundry',
            position: { x: i * 10 + 0.5, y: 0.5 },
            direction,
            ...(recipe === 'none' ? {} : { recipe }),
        })),
    })
}

test('the foundry draws a pipe connector for each fluid side of its recipe', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    for (const recipe of RECIPES) {
        await loadBlueprint(page, foundries(recipe))
        const digests = await page.evaluate(() =>
            window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
        )
        const drawn = (digests.foundry ?? []).map(d => d.split(':')[0])
        // All four facings draw the same number of layers, so the facing each
        // digest came from does not matter.
        const total = WITHOUT_CONNECTORS[recipe] + CONNECTOR_LAYERS[recipe]
        expect(
            drawn,
            `${recipe}: expected every facing at ${total} layers ` +
                `(${CONNECTOR_LAYERS[recipe]} of them connectors)`
        ).toEqual(FACINGS.map(() => String(total)))
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
