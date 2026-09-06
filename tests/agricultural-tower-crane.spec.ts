import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    The agricultural tower's base sprite ends in an open-topped mast; the crane
    that closes it is nine 3D parts the engine poses and projects. Only the hub
    can be drawn from prototype data, and craneHubLayers draws it - see
    spriteDataBuilder.ts.

    That draw is guarded five ways (missing crane, missing rotated_sprite,
    missing filenames / lines_per_file / line_length / width / height, and a
    file index past the end of filenames), and every one of those guards returns
    an empty array. So a regression here is silent: the tower drops back to its
    two base layers and looks exactly like a tower that never had a crane. The
    sprite-data fixture would move, but its own header says a diff there means
    "the sprites for that entity changed" - which is how a silent drop gets
    re-recorded rather than investigated.

    This spec is the loud version. The tower is not in the committed corpus, so
    the fixture's `real` and `noGridReal` sections cannot cover it at all.
*/

const TOWER = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [{ entity_number: 1, name: 'agricultural-tower', position: { x: 0.5, y: 0.5 } }],
})

/** base + base shadow + the crane hub. */
const EXPECTED_LAYERS = 3

test('an agricultural tower draws its crane hub, not just its base', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, TOWER)

    const digests = await page.evaluate(
        () => window.__fbe_test.spriteDataTally()['agricultural-tower'] ?? []
    )

    expect(digests).toHaveLength(1)
    expect(digests.filter(d => d === 'FAILED')).toEqual([])
    // A dropped hub reads as `2:`, which is what every guard in craneHubLayers
    // falls back to.
    expect(digests.every(d => d.startsWith(`${EXPECTED_LAYERS}:`))).toBe(true)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('the crane hub is parked at one orientation for every facing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    /*
        A blueprint carries no crane state, so CRANE_RESTING_ORIENTATION is a
        fixed frame and the tower must draw identically whichever way it is
        turned - including the entry that omits `direction` altogether. If this
        ever splits into distinct digests, the hub frame has picked up a
        dependency on facing that nothing in the prototype justifies.
    */
    const digests = await page.evaluate(
        () =>
            window.__fbe_test.paintPreviewTally([0, 4, 8, 12, undefined])['agricultural-tower'] ??
            []
    )

    expect(digests).toHaveLength(5)
    expect(digests.filter(d => d === 'FAILED')).toEqual([])
    expect(digests.every(d => d.startsWith(`${EXPECTED_LAYERS}:`))).toBe(true)
    expect(new Set(digests).size).toBe(1)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
