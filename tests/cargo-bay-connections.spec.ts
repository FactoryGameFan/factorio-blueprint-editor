import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    Placement half of issue #378. tests/cargo-bay-connections.test.ts pins the
    rules - which pieces a cell draws, and which bridge a seam takes - against
    Factorio's own table and against the game's own pixels. This pins the other
    half: that the rules are applied per 2x2 cell and per shared edge, and that
    each piece is offset to where it belongs, so bays placed against each other
    join into one structure instead of rendering as separate islands.

    Layer counts and digests together are the instrument. Before the fix every
    arrangement drew the same 37 connection layers stacked on the entity centre,
    so a lone bay and a bay in the middle of a field were identical.

    Counts are connection layers plus the 7 the bay draws regardless - 5 picture
    layers and 2 hatch layers.

    A count on its own cannot express "this bay joined to something", and
    assuming it could is what left this spec with a failing assertion at
    4c8ec5e6. Joining is not monotone in the layer count: a bay that gains a
    west neighbour swaps its two left outer corners, 4 + 5 layers, for a top and
    a bottom wall, also 4 + 5, so the total does not move at all. Measured, a
    bay covered on its west or north stays at 26 while one covered on its east
    or south drops to 25. The digest is what actually answers the question, so
    the digest is what these tests compare.
*/

const LONE_BAY = 26

/** A bay joined on its west only. Its own count happens to equal a lone bay's. */
const JOINED_WEST = '26:5b2ec7f8'

const bp = (entities: [string, number, number][]): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        entities: entities.map(([name, x, y], i) => ({
            entity_number: i + 1,
            name,
            position: { x, y },
        })),
    })

const bays = (positions: [number, number][]): string =>
    bp(positions.map(([x, y]) => ['cargo-bay', x, y]))

async function tally(page: import('@playwright/test').Page): Promise<Record<string, string[]>> {
    const all = await page.evaluate(() => window.__fbe_test.spriteDataTally())
    for (const [name, digests] of Object.entries(all)) {
        expect(
            digests.filter(d => d === 'FAILED'),
            `${name} failed to generate`
        ).toEqual([])
    }
    return all
}

const countsOf = (digests: string[]): number[] => digests.map(d => Number(d.split(':')[0]))

test('a lone bay is four corner cells, and a neighbour changes what it draws', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    // A bay is 2x2 cells, so a lone one is four outer corners and no walls at
    // all - 19 connection layers on top of the 7 it always draws.
    await loadBlueprint(page, bays([[0, 0]]))
    const lone = (await tally(page))['cargo-bay']
    expect(countsOf(lone)).toEqual([LONE_BAY])

    /*
        The control for the whole feature. Two bays 2 tiles apart share no edge,
        and the game draws no join between them - the `gap2` capture is what
        settles that a bridge covers a seam rather than spanning a gap. Both
        bays must therefore be byte-identical to a lone one.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [6, 0],
        ])
    )
    expect(
        (await tally(page))['cargo-bay'],
        'bays with a gap between them are each still a lone bay'
    ).toEqual([lone[0], lone[0]])

    /*
        A 1-tile gap, which is legal: only `cargo-landing-pad` declares a
        `build_grid_size`, so a bay snaps to whole tiles and two of them can sit
        an odd number apart. Sampling a neighbouring cell's middle rather than
        the tile across the edge reads straight over a gap this size, and reads
        it differently from each side - one bay opens its wall while the other
        keeps it. Both must be a lone bay, and the two must agree.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [5, 0],
        ])
    )
    expect(
        (await tally(page))['cargo-bay'],
        'a 1-tile gap is still a gap, from both sides'
    ).toEqual([lone[0], lone[0]])

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [0, 5],
        ])
    )
    expect((await tally(page))['cargo-bay'], 'the same on the other axis').toEqual([
        lone[0],
        lone[0],
    ])

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('a seam is bridged, and bridged once', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /*
        The bridge is anchored on the shared edge between the two bays, so only
        one of them draws it - the west one of a side-by-side pair, the north
        one of a stacked pair. `bridge_horizontal_wide` is 4 layers.

        The east bay is the check that it is drawn once and not twice: it comes
        out byte-identical to a bay joined on its west with no bridge involved,
        which is the same digest a bay against a landing pad or a platform hub
        produces in the next test.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 0],
        ])
    )
    const row2 = (await tally(page))['cargo-bay']
    expect(countsOf(row2), 'the west bay carries the bridge, the east one does not').toEqual([
        29, 26,
    ])
    expect(row2[1], 'the east bay draws no bridge of its own').toBe(JOINED_WEST)

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [0, 4],
        ])
    )
    const col2 = (await tally(page))['cargo-bay']
    expect(countsOf(col2), 'stacked is the same shape, drawn by the north bay').toEqual([29, 26])
    expect(col2[0], 'a vertical seam is not a horizontal one').not.toBe(row2[0])

    /*
        Offset by one build-grid step. The bays share 2 tiles of edge instead of
        4, which is the only thing the two `*_narrow` keys are ever selected
        for, and the step also produces inner corners - so an offset pair draws
        MORE than an aligned one, not less.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 2],
        ])
    )
    expect(countsOf((await tally(page))['cargo-bay'])).toEqual([35, 30])

    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [2, 4],
        ])
    )
    expect(countsOf((await tally(page))['cargo-bay'])).toEqual([34, 31])

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('four bays meeting take a crossing, and a plain seam does not', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /*
        In a 2x2 block the north-west bay draws two bridges and the crossing,
        the north-east and south-west bays one bridge each, and the south-east
        bay none - each piece belongs to the entity on its west or north side.
        `bridge_crossing` is 4 layers, the same as a wide bridge.

        The pair tests above are the other half of this one: two bays alone put
        four occupied cells around their seam midpoint too, and if a crossing
        needed only that, every seam would carry one on top of its bridge.
    */
    await loadBlueprint(
        page,
        bays([
            [0, 0],
            [4, 0],
            [0, 4],
            [4, 4],
        ])
    )
    const block = (await tally(page))['cargo-bay']
    expect(countsOf(block)).toEqual([31, 25, 25, 22])

    /*
        An L: the 2x2 block with one more bay on the end of the bottom row. The
        four block bays are unchanged, which says the extra bay reaches none of
        them, and the new bay joins on its west only - the same digest as the
        east bay of a plain pair.
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
    const ell = (await tally(page))['cargo-bay']
    expect(ell.slice(0, 3), 'the block bays keep what they drew').toEqual(block.slice(0, 3))
    expect(countsOf(ell)).toEqual([31, 25, 25, 26, 26])
    expect(ell[4], 'the outer bay is joined on its west').toBe(JOINED_WEST)

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
        CargoBayConnectableGraphicsSet and join in game, and all three are in
        EntityContainer's update group so a neighbour redraws them.

        A bay against either of the 8x8 entities has to come out byte-identical
        to a bay against another bay on the same side, because nothing about the
        neighbour's own size reaches the bay's cells.
    */
    /*
        These two totals carry the `graphics_set.animation` layers issue #364
        added - one turbine on the pad, 22 cockpit glows on the hub - so they
        were 72 and 77 before that. What this test is about is the difference
        each neighbour makes, and the animation is constant across every
        arrangement below, so it shifts the baselines and nothing else.
    */
    await loadBlueprint(page, bp([['cargo-landing-pad', 0, 0]]))
    const lonePad = (await tally(page))['cargo-landing-pad']
    expect(countsOf(lonePad)).toEqual([73])

    await loadBlueprint(page, bp([['space-platform-hub', 0, 0]]))
    const loneHub = (await tally(page))['space-platform-hub']
    expect(countsOf(loneHub)).toEqual([99])

    for (const big of ['cargo-landing-pad', 'space-platform-hub'] as const) {
        // bay to the east: the 8x8 entity is on the west side, so it draws the
        // bridge and the bay does not
        await loadBlueprint(
            page,
            bp([
                [big, 0, 0],
                ['cargo-bay', 6, -2],
            ])
        )
        const east = await tally(page)
        expect(east['cargo-bay'], `a bay east of a ${big} is joined on its west`).toEqual([
            JOINED_WEST,
        ])
        expect(countsOf(east[big])[0], `the ${big} sheds a wall and gains the bridge`).toBe(
            countsOf(big === 'cargo-landing-pad' ? lonePad : loneHub)[0] + 3
        )

        // bay to the west: now the bay owns the seam and carries the bridge
        await loadBlueprint(
            page,
            bp([
                [big, 0, 0],
                ['cargo-bay', -6, -2],
            ])
        )
        const west = await tally(page)
        expect(countsOf(west['cargo-bay']), `a bay west of a ${big} carries the bridge`).toEqual([
            29,
        ])
    }

    /*
        Two bays stacked against one side of the pad. Measured in game, the
        midpoint of that side takes a crossing even though only three entities
        meet there - the pad fills two of the four quadrants. The pad therefore
        draws two bridges and a crossing, and the north bay draws the bridge to
        the south one.
    */
    await loadBlueprint(
        page,
        bp([
            ['cargo-landing-pad', 0, 0],
            ['cargo-bay', 6, -2],
            ['cargo-bay', 6, 2],
        ])
    )
    const t = await tally(page)
    expect(countsOf(t['cargo-landing-pad'])).toEqual([74])
    expect(countsOf(t['cargo-bay'])).toEqual([25, 22])

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
