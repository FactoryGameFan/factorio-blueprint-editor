import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    Placement half of issue #378. tests/cargo-bay-connections.test.ts pins the
    rule - which pieces a cell draws - against Factorio's own table. This pins
    the other half: that the rule is applied per 2x2 cell and each piece is
    offset to its cell, so bays placed against each other join into one
    structure instead of rendering as separate islands.

    Layer counts are the instrument because they are what changes. Before the
    fix every arrangement drew the same 37 connection layers stacked on the
    entity centre, so a lone bay and a bay in the middle of a field were
    identical. Now the count falls as neighbours are added, which is the whole
    point: a covered edge draws nothing.

    Counts are connection layers plus the 7 the entity draws regardless - 5
    picture layers and 2 hatch layers.
*/

const BASE_LAYERS = 7

const bays = (positions: [number, number][]): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: positions.map(([x, y], i) => ({
            entity_number: i + 1,
            name: 'cargo-bay',
            position: { x, y },
        })),
    })

async function layerCounts(page: import('@playwright/test').Page): Promise<number[]> {
    const digests = await page.evaluate(
        () => window.__fbe_test.spriteDataTally()['cargo-bay'] ?? []
    )
    expect(
        digests.filter(d => d === 'FAILED'),
        'a bay failed to generate'
    ).toEqual([])
    return digests.map(d => Number(d.split(':')[0])).sort((a, b) => a - b)
}

test('a lone bay is four corner cells, and every neighbour takes layers away', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /*
        A bay is 2x2 cells, so a lone one is four outer corners and no walls at
        all - 19 connection layers. Adding neighbours can only cover edges, so
        no arrangement may exceed the lone count, and the busiest bay in a 2x2
        block must come in well under it.
    */
    await loadBlueprint(page, bays([[0, 0]]))
    const lone = await layerCounts(page)
    expect(lone).toEqual([BASE_LAYERS + 19])

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 0],
        ])
    )
    const row2 = await layerCounts(page)
    expect(row2, 'two bays side by side each shed a covered edge').toEqual([25, 26])

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [0, 4],
        ])
    )
    expect(await layerCounts(page), 'stacked is the same shape as side by side').toEqual([25, 26])

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 0],
            [0, 4],
            [4, 4],
        ])
    )
    const block = await layerCounts(page)
    expect(block, 'every bay in a 2x2 block is covered on two sides').toEqual([19, 21, 21, 22])
    expect(Math.max(...block)).toBeLessThan(lone[0])

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('an L keeps its outer bay at the lone count', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /*
        Five bays: a 2x2 block with one more on the end of the bottom row. That
        last bay touches the block on one side only, so it keeps the same 19
        connection layers a lone bay has while the block's four are all reduced.

        This is the arrangement that would survive an entity-wide mask being
        reintroduced - it is also the only committed shape that produces an
        inner corner, where the L bends.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 0],
            [0, 4],
            [4, 4],
            [8, 4],
        ])
    )
    expect(await layerCounts(page)).toEqual([19, 21, 21, 22, 26])

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('a bay joins to a landing pad and to a platform hub, not just to a bay', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /*
        isCargoBayLike decides what counts as a neighbour. It used to name only
        cargo-bay and cargo-landing-pad, so a bay against a platform hub drew a
        full exterior wall on the shared edge (issue #364). All three carry a
        CargoBayConnectableGraphicsSet and join in game.

        A bay touching either of them must therefore come in under the lone
        count, and the hub - which drew no connection sprites at all before -
        must now draw some.
    */
    const withPad = encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            { entity_number: 1, name: 'cargo-landing-pad', position: { x: 0, y: 0 } },
            { entity_number: 2, name: 'cargo-bay', position: { x: 6, y: -2 } },
        ],
    })
    await loadBlueprint(page, withPad)
    const padTally = await page.evaluate(() => window.__fbe_test.spriteDataTally())
    const bayNextToPad = Number(padTally['cargo-bay'][0].split(':')[0])
    expect(bayNextToPad, 'a bay against a landing pad sheds an edge').toBeLessThan(BASE_LAYERS + 19)

    const withHub = encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: [
            { entity_number: 1, name: 'space-platform-hub', position: { x: 0, y: 0 } },
            { entity_number: 2, name: 'cargo-bay', position: { x: 6, y: -2 } },
        ],
    })
    await loadBlueprint(page, withHub)
    const hubTally = await page.evaluate(() => window.__fbe_test.spriteDataTally())
    const bayNextToHub = Number(hubTally['cargo-bay'][0].split(':')[0])
    expect(bayNextToHub, 'a bay against a hub sheds the same edge').toBe(bayNextToPad)

    const hub = Number(hubTally['space-platform-hub'][0].split(':')[0])
    expect(hub, 'the hub itself now draws connection sprites').toBeGreaterThan(22)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
