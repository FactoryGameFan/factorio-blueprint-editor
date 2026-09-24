import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    The quality badge on an entity and on its module icons - issue #348.

    The expected frames below are what Factorio 2.0.77 drew, not what the
    editor computes. They were read off alt-mode screenshots of legendary
    entities at 128 px per tile, by keying on the badge's fill colour and
    converting its extent back to the 64 px icon frame; see
    packages/editor/src/core/qualityBadge.ts for the method.

    The two tolerances are the error of that reading, and they differ. A corner
    is read to about one pixel, 0.008 tiles: every entity corner came back
    within 0.003 of its selection box. A size is read from the fill's height,
    which loses the anti-aliased edge and reads 2 to 6% small - a quarter-tile
    badge came back 0.245. The position tolerance is also what separates the
    module row fix from the row it replaced, which was 0.023 to 0.030 out.

    Frames are in tiles from the entity's centre, `x`,`y` the top-left corner.
*/

const VERSION = packVersion(2, 0, 55)
const POSITION_TOLERANCE = 0.012
const SIZE_TOLERANCE = 0.03

const modules = (quality: string | undefined) => [
    {
        id:
            quality === undefined
                ? { name: 'speed-module-3' }
                : { name: 'speed-module-3', quality },
        items: { in_inventory: [0, 1, 2, 3].map(stack => ({ inventory: 4, stack })) },
    },
]

const BLUEPRINT = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        {
            entity_number: 1,
            name: 'assembling-machine-3',
            position: { x: 0.5, y: 0.5 },
            quality: 'legendary',
            recipe: 'iron-gear-wheel',
            items: modules('legendary'),
        },
        // The control: the same machine at normal quality, with normal modules.
        {
            entity_number: 2,
            name: 'assembling-machine-3',
            position: { x: 10.5, y: 0.5 },
            recipe: 'iron-gear-wheel',
            items: modules(undefined),
        },
        // A normal machine holding rare modules: badges on the modules only.
        {
            entity_number: 3,
            name: 'assembling-machine-3',
            position: { x: 20.5, y: 0.5 },
            recipe: 'iron-gear-wheel',
            items: modules('rare'),
        },
        {
            entity_number: 4,
            name: 'boiler',
            position: { x: 30, y: 0.5 },
            direction: 4,
            quality: 'rare',
        },
        {
            entity_number: 5,
            name: 'small-lamp',
            position: { x: 40.5, y: 0.5 },
            quality: 'uncommon',
        },
        { entity_number: 6, name: 'stone-furnace', position: { x: 50, y: 1 }, quality: 'epic' },
        // A quality this editor has no art for: nothing drawn, nothing thrown.
        { entity_number: 7, name: 'steel-chest', position: { x: 60.5, y: 0.5 }, quality: 'mythic' },
    ],
})

async function frames(page: import('@playwright/test').Page, entityNumber: number) {
    const out = await page.evaluate(n => window.__fbe_test.qualityBadgeFrames(n), entityNumber)
    if (out === undefined) throw new Error(`no entity ${entityNumber}`)
    return out
}

function expectFrame(
    actual: { quality: string; x: number; y: number; size: number },
    expected: { quality: string; left: number; bottom: number; size: number }
) {
    expect(actual.quality).toBe(expected.quality)
    expect(Math.abs(actual.size - expected.size)).toBeLessThan(SIZE_TOLERANCE)
    expect(Math.abs(actual.x - expected.left)).toBeLessThan(POSITION_TOLERANCE)
    expect(Math.abs(actual.y + actual.size - expected.bottom)).toBeLessThan(POSITION_TOLERANCE)
}

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(page, BLUEPRINT)
})

test('a legendary machine gets a half-tile badge at its selection box corner', async ({ page }) => {
    const all = await frames(page, 1)
    const entity = all.filter(f => f.size > 0.4)
    expect(entity).toHaveLength(1)
    // Game: frame 0.500 tiles, bottom-left on the 3x3 selection box's corner.
    expectFrame(entity[0], { quality: 'legendary', left: -1.5, bottom: 1.5, size: 0.5 })
})

/*
    Game: each module badge's frame sat on its icon's bottom-left, 0.235 tiles
    across, measured in a window per module: left -1.077, -0.522, 0.025 and
    0.580, bottom 0.944. That is a row centred on the entity, which the editor
    did not quite draw until this change - see the moduleInfo comment in
    OverlayContainer.ts.
*/
test("each module icon gets a badge at its own corner, in the module's quality", async ({
    page,
}) => {
    const moduleBadges = (await frames(page, 1)).filter(f => f.size < 0.4).sort((a, b) => a.x - b.x)
    expect(moduleBadges).toHaveLength(4)
    const lefts = [-1.077, -0.522, 0.025, 0.58]
    for (const [i, f] of moduleBadges.entries()) {
        expectFrame(f, { quality: 'legendary', left: lefts[i], bottom: 0.944, size: 0.235 })
    }
})

test('normal quality draws no badge anywhere', async ({ page }) => {
    expect(await frames(page, 2)).toEqual([])
})

test('a normal machine with rare modules badges the modules and not itself', async ({ page }) => {
    const all = await frames(page, 3)
    expect(all.map(f => f.quality)).toEqual(['rare', 'rare', 'rare', 'rare'])
    expect(all.every(f => f.size < 0.4)).toBe(true)
})

test('a boiler facing east puts a third-tile badge on its rotated box', async ({ page }) => {
    // Game: 0.327 across, on the corner of the east-facing box, -1..1 by -1.5..1.5.
    const [f, ...rest] = await frames(page, 4)
    expect(rest).toEqual([])
    expectFrame(f, { quality: 'rare', left: -1, bottom: 1.5, size: 1 / 3 })
})

test('a 1x1 entity gets a quarter-tile badge', async ({ page }) => {
    // Game: 0.245 across on a small-lamp, on its -0.5..0.5 box.
    const [f, ...rest] = await frames(page, 5)
    expect(rest).toEqual([])
    expectFrame(f, { quality: 'uncommon', left: -0.5, bottom: 0.5, size: 0.25 })
})

test("a stone furnace's badge follows its narrower selection box", async ({ page }) => {
    // Game: the 2-tile size, with its left edge on the selection box at -0.797.
    const [f, ...rest] = await frames(page, 6)
    expect(rest).toEqual([])
    expectFrame(f, { quality: 'epic', left: -0.797, bottom: 1, size: 1 / 3 })
})

test('a quality the editor has no art for draws nothing and throws nothing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    expect(await frames(page, 7)).toEqual([])
    expect(errors).toEqual([])
})
