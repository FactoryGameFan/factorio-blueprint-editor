import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    A crafting machine's unconditional working visualisation - `always_draw`,
    no `name`, no `enabled_by_name`, no tint - is part of its body, and
    restingCoreLayers draws it. It used to return early for anything but the
    electromagnetic plant (#356), so the cryogenic plant never drew its glass
    dome, `cryogenic-plant-glass.png` (issue #373).

    The cryogenic plant has six `always_draw` visualisations and the glass is
    the only one without a tint. The other five are `apply_recipe_tint` masks,
    and the predicate uses `find`, so without the tint guard the first of them
    (wv[3]) would be drawn in place of the glass - still one layer, so this
    counts layers and the sprite-data fixture's hash is what tells the two
    apart.

    restingCoreLayers returns an empty array on every guard, so a regression
    drops each machine back to its idle animation with no error. The
    electromagnetic plant is here so a change aimed at the glass cannot quietly
    move its core.
*/

/** Idle (or main) animation layers alone. */
const WITHOUT_CORE = {
    /** main, shadow and five animation bases. */
    'cryogenic-plant': 7,
    /** base and shadow. */
    'electromagnetic-plant': 2,
} as const

/** What restingCoreLayers adds. A silent drop reads as 0. */
const CORE_LAYERS = {
    /** The glass. */
    'cryogenic-plant': 1,
    /** The core and its shadow. */
    'electromagnetic-plant': 2,
} as const

const NAMES = Object.keys(WITHOUT_CORE) as (keyof typeof WITHOUT_CORE)[]

/* No recipe, so neither machine draws pipe connections. */
const PLANTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'cryogenic-plant', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'electromagnetic-plant', position: { x: 20, y: 0 } },
    ],
})

test('the cryogenic plant draws its glass beside the electromagnetic core', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, PLANTS)

    const digests = await page.evaluate(() =>
        window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
    )

    for (const name of NAMES) {
        expect(digests[name], `${name} drew nothing`).toHaveLength(1)
        expect(digests[name][0], `${name} failed to generate`).not.toBe('FAILED')
        const drawn = Number(digests[name][0].split(':')[0])
        expect(
            drawn - WITHOUT_CORE[name],
            `${name} core layers (0 means restingCoreLayers dropped it)`
        ).toBe(CORE_LAYERS[name])
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('the glass does not depend on a position grid or on facing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    // The paint preview's bare `{ name, direction }`, with the last entry
    // omitting `direction` to reach getDrawData's default.
    const digests = await page.evaluate(() =>
        window.__fbe_test.paintPreviewTally([0, 4, 8, 12, undefined])
    )

    for (const name of NAMES) {
        const total = WITHOUT_CORE[name] + CORE_LAYERS[name]
        expect(digests[name], `${name} drew nothing`).toHaveLength(5)
        expect(
            digests[name].every(d => d.startsWith(`${total}:`)),
            `${name} expected every facing at ${total} layers, got ${digests[name].join(' ')}`
        ).toBe(true)
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
