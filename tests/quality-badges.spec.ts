import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

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
    await suppressOverlays(page)
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

for (const name of ['steel-chest', 'small-lamp', 'accumulator']) {
    test(`${name}'s live quality overlay follows a drag, undo and redo`, async ({ page }) => {
        await loadBlueprint(
            page,
            encodeBlueprint({
                item: 'blueprint',
                version: VERSION,
                entities: [
                    { entity_number: 1, name, position: { x: 0, y: 0 }, quality: 'legendary' },
                ],
            })
        )
        expect(await frames(page, 1)).toHaveLength(1)
        const origin = await page.evaluate(() => window.__fbe_test.entityPosition(1))
        const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(1))
        if (!origin || !at) throw new Error('missing test entity')
        const tile = 32 * (await page.evaluate(() => window.__fbe_test.viewportScale()))
        const expectOverlayAt = async (position: { x: number; y: number }) => {
            expect(await page.evaluate(() => window.__fbe_test.entityPosition(1))).toEqual(position)
            expect(await page.evaluate(() => window.__fbe_test.liveOverlayPosition(1))).toEqual({
                x: position.x * 32,
                y: position.y * 32,
            })
        }
        await expectOverlayAt(origin)
        await page.mouse.move(at.x - 4, at.y - 4)
        await page.keyboard.down('Alt')
        await page.mouse.down()
        await page.mouse.move(at.x + 4, at.y + 4)
        await page.mouse.up()
        await page.keyboard.up('Alt')
        expect(await page.evaluate(() => window.__fbe_test.selectedEntityNumbers())).toEqual([1])
        await page.mouse.move(at.x, at.y)
        await page.mouse.down()
        await page.mouse.move(at.x, at.y + 3 * tile, { steps: 4 })
        await page.mouse.up()
        const moved = { x: origin.x, y: origin.y + 3 }
        await expectOverlayAt(moved)
        await page.keyboard.down('Control')
        await page.keyboard.press('KeyZ')
        await expectOverlayAt(origin)
        await page.keyboard.press('KeyY')
        await page.keyboard.up('Control')
        await expectOverlayAt(moved)
    })
}

for (const quality of ['constructor', 'toString', '__proto__']) {
    test(`unknown quality ${quality} preserves recipe and module overlays`, async ({ page }) => {
        await loadBlueprint(
            page,
            encodeBlueprint({
                item: 'blueprint',
                version: VERSION,
                entities: [
                    {
                        entity_number: 1,
                        name: 'assembling-machine-3',
                        position: { x: 0.5, y: 0.5 },
                        quality,
                        recipe: 'iron-gear-wheel',
                        items: modules(quality),
                    },
                ],
            })
        )
        expect(await frames(page, 1)).toEqual([])
        expect(await page.evaluate(() => window.__fbe_test.entityInfoVisible(1))).toBe(true)
        expect(await page.evaluate(() => window.__fbe_test.overlayInfoTally())).toEqual({
            'assembling-machine-3': [2],
        })
    })
}

/*
    Recipe and filter icons (#503). Measured the same way but read by matching
    the game's own quality-legendary.png against the screenshot over a range of
    sizes, which fits to a pixel; see ICON_BADGE_SCALE in qualityBadge.ts. The
    expected frames are the game's best fits.
*/
const filters = (count: number, quality: string) =>
    ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'steel-plate']
        .slice(0, count)
        .map((name, i) => ({ index: i + 1, name, quality, comparator: '=' }))

const ICON_BLUEPRINT = encodeBlueprint({
    item: 'blueprint',
    version: VERSION,
    entities: [
        {
            entity_number: 1,
            name: 'assembling-machine-3',
            position: { x: 0.5, y: 0.5 },
            recipe: 'iron-gear-wheel',
            recipe_quality: 'legendary',
        },
        {
            entity_number: 2,
            name: 'electromagnetic-plant',
            position: { x: 10, y: 0 },
            recipe: 'productivity-module-3',
            recipe_quality: 'legendary',
        },
        ...[1, 2, 3, 4].map(count => ({
            entity_number: 2 + count,
            name: 'bulk-inserter',
            position: { x: 20.5 + 4 * count, y: 0.5 },
            use_filters: true,
            filters: filters(count, 'legendary'),
        })),
        {
            entity_number: 7,
            name: 'splitter',
            position: { x: 50, y: 0.5 },
            filter: { name: 'iron-plate', quality: 'legendary' },
            output_priority: 'right',
        },
        {
            entity_number: 8,
            name: 'requester-chest',
            position: { x: 60.5, y: 0.5 },
            request_filters: {
                sections: [
                    {
                        index: 1,
                        filters: [
                            {
                                index: 1,
                                name: 'iron-plate',
                                quality: 'legendary',
                                comparator: '=',
                                count: 10,
                            },
                        ],
                    },
                ],
            },
        },
        // The control: a recipe and a filter set to normal quality.
        {
            entity_number: 9,
            name: 'assembling-machine-3',
            position: { x: 70.5, y: 0.5 },
            recipe: 'iron-gear-wheel',
            recipe_quality: 'normal',
        },
        {
            entity_number: 10,
            name: 'bulk-inserter',
            position: { x: 80.5, y: 0.5 },
            use_filters: true,
            filters: filters(1, 'normal'),
        },
    ],
})

test.describe('recipe and filter icons', () => {
    test.beforeEach(async ({ page }) => {
        await loadBlueprint(page, ICON_BLUEPRINT)
    })

    const sorted = async (page: import('@playwright/test').Page, n: number) =>
        (await frames(page, n)).sort((a, b) => a.y - b.y || a.x - b.x)

    test('a recipe icon gets a badge from recipe_quality', async ({ page }) => {
        // Game: 0.445 across; top-right on the icon's centre, 0.3 above the machine's.
        const [am3, ...rest] = await sorted(page, 1)
        expect(rest).toEqual([])
        expectFrame(am3, { quality: 'legendary', left: -0.445, bottom: 0.148, size: 0.445 })
        // Game: 0.453 across, the icon 0.25 above the plant's centre.
        const [emp, ...rest2] = await sorted(page, 2)
        expect(rest2).toEqual([])
        expectFrame(emp, { quality: 'legendary', left: -0.453, bottom: 0.203, size: 0.453 })
    })

    test('each inserter filter gets a badge, at one to four filters', async ({ page }) => {
        // Game: 29 px at 128 px per tile, the icons a quarter tile either side of centre.
        const corners = [
            [[-0.227, 0.227]],
            [
                [-0.477, 0.227],
                [0.023, 0.227],
            ],
            [
                [-0.477, -0.023],
                [0.023, -0.023],
                [-0.477, 0.477],
            ],
            [
                [-0.477, -0.023],
                [0.023, -0.023],
                [-0.477, 0.477],
                [0.023, 0.477],
            ],
        ]
        for (const [i, expected] of corners.entries()) {
            const got = await sorted(page, 3 + i)
            expect(got).toHaveLength(expected.length)
            for (const [j, [left, bottom]] of expected.entries()) {
                expectFrame(got[j], { quality: 'legendary', left, bottom, size: 0.227 })
            }
        }
    })

    test("a splitter's filter icon gets a badge", async ({ page }) => {
        // Game: the icon half a tile right of centre, for output priority right.
        const [f, ...rest] = await sorted(page, 7)
        expect(rest).toEqual([])
        expectFrame(f, { quality: 'legendary', left: 0.273, bottom: 0.227, size: 0.227 })
    })

    test('a requester chest gets no request badge, as in the game', async ({ page }) => {
        // 2.0.77 drew no request icons on it at all, though the request read back.
        expect(await frames(page, 8)).toEqual([])
    })

    test('a normal recipe or filter draws no badge', async ({ page }) => {
        expect(await frames(page, 9)).toEqual([])
        expect(await frames(page, 10)).toEqual([])
    })
})
