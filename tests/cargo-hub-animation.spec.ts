import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    Two entities carry `graphics_set.animation` beside `graphics_set.picture`,
    and both draw functions used to return the picture alone (issue #364).
    Swept over every entity in `data.json` those two are the only ones with both
    keys; the other 22 with an `animation` have no `picture` next to it, so
    their own draw functions already read it.

    What the animation holds differs between them, and only one of the two is a
    hole in the art:

    - `cargo-landing-pad` gets one layer, `planet-hub-turbine.png`. The picture
      draws the turbine's cowling with nothing inside it, so before this the pad
      rendered a dark ring - the same shape of defect as the open hatches of
      #377, not a missing detail. Scored against Factorio 2.0.77's own render,
      over the fan's own pixels, mean per-channel error falls from 30.7 to 20.9
      at frame 0.
    - `space-platform-hub` gets 22 tiny additive `draw_as_glow` sprites, the
      cockpit's lit screens. The cockpit body is in `picture` and was always
      drawn, so the issue's "the whole cockpit missing" overstates it: they move
      3.4% of the hub's pixels by a mean of 9.2.

    graphicsSetAnimationLayers returns an empty array on each of its guards - a
    missing `animation`, a `layers` that is not an array, a bare sprite with no
    `filename`. So a regression is silent: each entity drops back to exactly the
    layers it had before and looks like an entity that never had an animation.
    The sprite-data fixture would move, but its own header says a diff there
    means "the sprites for that entity changed", which is how a silent drop gets
    re-recorded rather than investigated. This spec is the loud version.

    It asserts the split, not just the total, so a failure says which half
    moved. `tests/cargo-hatches.spec.ts` pins the same totals from the hatch
    side; that is deliberate, and the two disagree usefully - if the exporter
    ever ships a cockpit with a different number of layers, the hatch spec fails
    with a bare wrong number while this one still passes.
*/

/** Picture layers plus the hatch layers that survive the shadow filter. */
const WITHOUT_ANIMATION = {
    /** 13 picture + 4 giga hatch. */
    'cargo-landing-pad': 17,
    /** 15 picture + 7 across two giga hatches. */
    'space-platform-hub': 22,
} as const

/** What `graphics_set.animation` adds. A silent drop reads as 0. */
const ANIMATION_LAYERS = {
    'cargo-landing-pad': 1,
    'space-platform-hub': 22,
} as const

/*
    Far enough apart that no footprint touches another, so each entity is judged
    on its own layers. Neither reads the position grid for its animation, but
    both do for their connection sprites, and a neighbour would add those.
*/
const HUBS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'cargo-landing-pad', position: { x: 0, y: 0 } },
        { entity_number: 2, name: 'space-platform-hub', position: { x: 60, y: 0 } },
    ],
})

test('the landing pad and the platform hub draw graphics_set.animation', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, HUBS)

    const digests = await page.evaluate(() =>
        window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
    )

    for (const name of Object.keys(WITHOUT_ANIMATION) as (keyof typeof WITHOUT_ANIMATION)[]) {
        expect(digests[name], `${name} drew nothing`).toHaveLength(1)
        expect(
            digests[name].filter(d => d === 'FAILED'),
            `${name} failed to generate`
        ).toEqual([])

        const drawn = Number(digests[name][0].split(':')[0])
        expect(
            drawn - WITHOUT_ANIMATION[name],
            `${name} animation layers (0 means the animation was dropped)`
        ).toBe(ANIMATION_LAYERS[name])
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('the animation does not depend on a position grid or on facing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    /*
        The paint preview draws from a bare `{ name, direction }` - no Entity, no
        position, no grid. That is the only caller reaching
        EntitySprite.getDrawData's defaults, so a read that came to depend on an
        Entity would pass the test above and fail here.

        Neither prototype has a directional graphics set and an animation frame
        carries no runtime state, so every facing must come out identical.
    */
    const digests = await page.evaluate(() =>
        window.__fbe_test.paintPreviewTally([0, 4, 8, 12, undefined])
    )

    for (const name of Object.keys(WITHOUT_ANIMATION) as (keyof typeof WITHOUT_ANIMATION)[]) {
        const total = WITHOUT_ANIMATION[name] + ANIMATION_LAYERS[name]
        expect(digests[name], `${name} drew nothing`).toHaveLength(5)
        expect(
            digests[name].filter(d => d === 'FAILED'),
            `${name} failed to generate`
        ).toEqual([])
        expect(
            digests[name].every(d => d.startsWith(`${total}:`)),
            `${name} expected every facing at ${total} layers, got ${digests[name].join(' ')}`
        ).toBe(true)
        expect(new Set(digests[name]).size, `${name} differs by facing`).toBe(1)
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
