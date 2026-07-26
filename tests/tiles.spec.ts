import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    That tiles actually render, which nothing asserted.

    blueprint-round-trip checksums tile positions in the *model*, and
    unknown-prototypes covers tiles being stripped before they get that far, but
    nothing looked at whether a tile that survives produces a sprite. So the
    whole of TileContainer.generateSprite could stop drawing and the suite would
    stay green - the load succeeds either way, the floor is just empty.

    Both branches of that function are covered here, because they read entirely
    different prototype fields and only one of them can fail: of the 22 tiles in
    data.json, 16 carry `variants.material_background` and 6 do not and fall back
    to picking a single-tile entry out of `variants.main`.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

const tilesAt = (
    name: string,
    count: number
): { name: string; position: { x: number; y: number } }[] =>
    [...Array(count).keys()].map(i => ({ name, position: { x: i, y: 0 } }))

const tileSpriteCount = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.tileSpriteCount())

async function load(page: Page, source: string): Promise<string[]> {
    const warnings: string[] = []
    page.on('console', m => {
        if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text())
    })
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
    return warnings
}

test('a tile taking the material_background branch draws one sprite each', async ({ page }) => {
    // concrete is one of the 16 that carry material_background.
    const warnings = await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [],
            tiles: tilesAt('concrete', 5),
        })
    )

    expect(await tileSpriteCount(page)).toBe(5)
    expect(warnings.join(' | ')).not.toContain('leaving it blank')
})

test('a tile falling back to variants.main draws one sprite each', async ({ page }) => {
    /*
        stone-path is one of the 6 with no material_background, so it takes the
        branch that searches `main` for a single-tile variant and reads `picture`
        and `count` off it. That is the branch with something to fail at, and the
        one that would take the whole load down if it threw rather than degraded
        - see issue #54.
    */
    const warnings = await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [],
            tiles: tilesAt('stone-path', 4),
        })
    )

    expect(await tileSpriteCount(page)).toBe(4)
    expect(warnings.join(' | ')).not.toContain('leaving it blank')
})

test('both branches draw side by side in one blueprint', async ({ page }) => {
    const warnings = await load(
        page,
        encode({
            item: 'blueprint',
            version: version(2, 0, 55),
            entities: [],
            tiles: [
                ...tilesAt('concrete', 3),
                { name: 'stone-path', position: { x: 0, y: 1 } },
                { name: 'space-platform-foundation', position: { x: 1, y: 1 } },
                { name: 'refined-concrete', position: { x: 2, y: 1 } },
            ],
        })
    )

    expect(await tileSpriteCount(page)).toBe(6)
    expect(warnings.join(' | ')).not.toContain('leaving it blank')
})
