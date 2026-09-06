import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    Three entities draw a hole in their base art and cover it with a cargo
    hatch: cargo-bay with a plain `hatch_definitions` entry, cargo-landing-pad
    and space-platform-hub with a `giga_hatch_definitions` one. Before
    cargoHatchLayers and gigaCargoHatchLayers the hole was all you saw - a black
    notch ringed with red indicator lights on the bay, an open pit several tiles
    across on the other two.

    Both helpers bail to an empty array on every guard: a missing definitions
    array, a definition with no graphics, an animation with no layers. So a
    regression is silent - each entity drops back to exactly the layers it had
    before and looks like an entity that never had a hatch. The sprite-data
    fixture would move, but its own header says a diff there means "the sprites
    for that entity changed", which is how a silent drop gets re-recorded rather
    than investigated.

    This spec is the loud version, and it is a layer-count check on purpose. The
    fixture already covers placement, because its hash covers the fields that
    decide where each layer lands - so a hatch drawn at the wrong offset moves a
    digest there. What the fixture cannot say is which layers were meant to be
    present, and that is what these counts pin.

    Counts are base layers plus the hatch layers that survive the
    `draw_as_shadow` filter, since `EntitySprite.getParts` drops shadows at
    render time and both helpers drop them at build time to match.
*/

const HATCHES = {
    /** 5 picture layers + lid + emission. Without the hatch: 5. */
    'cargo-bay': 7,
    /** 13 picture layers + back, back emission, front emission, front. Without: 13. */
    'cargo-landing-pad': 17,
    /** 15 picture layers + 7 across two giga hatches. Without: 15. */
    'space-platform-hub': 22,
} as const

/*
    A lone cargo bay draws the *most* connection sprites, not the fewest: with a
    position grid and nothing adjacent, all four walls and all four outer
    corners apply, which is 37 layers on top of the 7 below. So the counts above
    are the grid-free ones, and the bay's grid-backed total is pinned separately.
*/
const BAY_ALONE_WITH_GRID = 44

/*
    Placed far enough apart that no footprint touches another, so every entity
    is judged on its own layers. The bay is 4x4, the landing pad 8x8 and the hub
    24x24, and only the bay reads the position grid at all.
*/
const HATCH_ENTITIES = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'cargo-bay', position: { x: 0, y: 0 } },
        { entity_number: 2, name: 'cargo-landing-pad', position: { x: 40, y: 0 } },
        { entity_number: 3, name: 'space-platform-hub', position: { x: 100, y: 0 } },
    ],
})

test('cargo bay, landing pad and platform hub all draw their hatch', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, HATCH_ENTITIES)

    const digests = await page.evaluate(() =>
        window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
    )

    for (const [name, layers] of Object.entries(HATCHES)) {
        expect(digests[name], `${name} drew nothing`).toHaveLength(1)
        expect(
            digests[name].filter(d => d === 'FAILED'),
            `${name} failed to generate`
        ).toEqual([])
        expect(digests[name][0].split(':')[0], `${name} layer count`).toBe(String(layers))
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('the bay draws its hatch on top of its connection sprites, not instead of them', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, HATCH_ENTITIES)

    /*
        draw_cargo_bay composes `[...connections, ...base, ...hatch]`, and the
        hatch is the only one of the three that does not depend on the grid.
        Appending rather than splicing is what keeps the hatch above the
        occluder the picture ends with, which is the engine's order - both sit
        on the `cargo-hatch` render layer.
    */
    const digests = await page.evaluate(() => window.__fbe_test.spriteDataTally())

    expect(digests['cargo-bay'], 'cargo-bay drew nothing').toHaveLength(1)
    expect(digests['cargo-bay'][0].split(':')[0], 'cargo-bay with grid').toBe(
        String(BAY_ALONE_WITH_GRID)
    )

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('the hatch does not depend on the position grid or on facing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    /*
        The paint preview draws from a bare `{ name, direction }` with no Entity,
        no position and no grid - the one caller that reaches
        EntitySprite.getDrawData's defaults. A hatch carries no runtime state and
        none of these three has a directional graphics set, so every facing must
        come out identical, and must match the grid-free counts in the first
        test.

        Worth having as its own test because it is a different code path, not a
        rephrasing of the first one: the preview never builds an Entity, so a
        hatch read that came to depend on one would pass there and fail here.
    */
    const digests = await page.evaluate(() =>
        window.__fbe_test.paintPreviewTally([0, 4, 8, 12, undefined])
    )

    for (const [name, layers] of Object.entries(HATCHES)) {
        expect(digests[name], `${name} drew nothing`).toHaveLength(5)
        expect(
            digests[name].filter(d => d === 'FAILED'),
            `${name} failed to generate`
        ).toEqual([])
        expect(
            digests[name].every(d => d.startsWith(`${layers}:`)),
            `${name} expected every facing at ${layers} layers, got ${digests[name].join(' ')}`
        ).toBe(true)
        expect(new Set(digests[name]).size, `${name} differs by facing`).toBe(1)
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
