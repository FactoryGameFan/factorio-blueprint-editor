import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    railgun-turret is the one turret Space Age lets you face diagonally, and its
    base_visualisation / folded_animation are 8-way maps keyed north, north_east,
    east ... . draw_railgun_turret indexed them with util.getDirName, which is
    cardinals only and throws outright on 2, 6, 10 and 14 - so getSpriteData's
    try/catch swallowed it and the four diagonal facings rendered the
    SPRITE_GENERATION_FAILED placeholder.

    sprite-data.spec.ts's own header records why nothing there caught it: its
    DIRECTIONS are [0, 4, 8, 12], and the committed corpus only ever places a
    railgun at direction 8. This is that gap, closed with the four facings the
    fixture cannot carry.
*/

const DIAGONALS = [2, 6, 10, 14] as const

const RAILGUNS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: DIAGONALS.map((direction, i) => ({
        entity_number: i + 1,
        name: 'railgun-turret',
        position: { x: i * 4, y: 0 },
        direction,
    })),
})

test('a railgun turret renders at every diagonal facing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, RAILGUNS)

    const digests = await page.evaluate(
        () => window.__fbe_test.spriteDataTally()['railgun-turret'] ?? []
    )

    // One per placement, none the FAILED placeholder, and each facing its own
    // 8-layer draw (3 base + 5 folded) rather than all collapsing to one.
    expect(digests).toHaveLength(DIAGONALS.length)
    expect(digests.filter(d => d === 'FAILED')).toEqual([])
    expect(digests.every(d => d.startsWith('8:'))).toBe(true)
    expect(new Set(digests).size).toBe(DIAGONALS.length)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
