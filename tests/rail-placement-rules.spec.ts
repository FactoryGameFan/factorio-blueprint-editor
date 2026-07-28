import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    What `PositionGrid.isAreaAvailable` answers when a signal or a gate is
    dropped onto a rail. Issue #95.

    Nothing covered this and the corpus cannot: `isAreaAvailable` is only ever
    called from the paint containers, so every one of these answers is reachable
    only by hand-placing, and all 578 blueprints in wormeyman-tests/ are real
    exports that were legal when the game wrote them. `position-grid.spec.ts`
    calls the function twice, for a chest on empty ground and a chest on top of
    another entity, and touches no rail rule at all.

    Every expectation here is measured against the real binary rather than
    reasoned about - tools/oracle/probe-rail-placement.mjs, captured in
    tools/oracle/fixtures/rail-placement.json. That mattered: reasoning gets the
    grouping wrong, because the rails that can hold a signal on their own tiles
    are curved-rail-a, curved-rail-b and legacy-straight-rail-at-a-diagonal,
    while legacy-curved-rail cannot - the opposite of what the straight/curved
    split the rest of the function uses would suggest.

    The positive cases are half the point. A fix that simply refused every signal
    on every rail would pass the first test and fail the second, and that is the
    mistake this is really guarding against - the permissive arms are permissive
    on purpose and only the measured-impossible ones were closed.
*/

const VERSION = packVersion(2, 0, 55)

interface Placed {
    name: string
    x: number
    y: number
    direction: number
}

/**
 * A rail at (1,1) covers tiles (0,0) to (1,1), so anything 1x1 at (0.5, 0.5)
 * lands squarely inside it. Every case here uses that pair, which keeps the
 * overlap the same across rail types whose footprints differ - a curved-rail-a
 * is 2x6 in this grid and a legacy-curved-rail 4x4, but both cover (0,0).
 */
const RAIL_AT = { x: 1, y: 1 }
const ON_THE_RAIL = { x: 0.5, y: 0.5 }

async function isAreaAvailable(
    page: import('@playwright/test').Page,
    existing: Placed[],
    placing: Placed
): Promise<boolean> {
    const source = encodeBlueprint({
        item: 'blueprint',
        version: VERSION,
        entities: existing.map((e, i) => ({
            entity_number: i + 1,
            name: e.name,
            position: { x: e.x, y: e.y },
            direction: e.direction,
        })),
    })

    return page.evaluate(
        async ({ src, place }) => {
            const bp = (await window.__fbe_test.getBlueprintOrBookFromSource(src)) as unknown as {
                entities: Map<number, unknown>
                entityPositionGrid: {
                    isAreaAvailable: (
                        name: string,
                        pos: { x: number; y: number },
                        direction: number
                    ) => boolean
                }
            }
            // A name FD does not have is stripped silently, which would leave an
            // empty blueprint and make every answer trivially true.
            if (bp.entities.size === 0) throw new Error('the blueprint decoded to no entities')
            return bp.entityPositionGrid.isAreaAvailable(
                place.name,
                { x: place.x, y: place.y },
                place.direction
            )
        },
        { src: source, place: placing }
    )
}

const rail = (name: string, direction: number): Placed => ({ name, ...RAIL_AT, direction })
const onRail = (name: string, direction: number): Placed => ({
    name,
    ...ON_THE_RAIL,
    direction,
})

test('a signal is refused on the rails that can never hold one', async ({ page }) => {
    await waitForEditor(page)

    /*
        Measured: across every orientation of each of these, not one of the
        game's legal signal positions has tiles overlapping the rail's own -
        16 of 16 spots outside for straight-rail, 16 of 16 for
        half-diagonal-rail, 20 of 20 for legacy-curved-rail. All four of these
        answered true before #95.

        The consequence is why they are refused rather than documented: the
        blueprint imports at code 0 and survives get_blueprint_entities, so
        nothing rejects the string, but with the rail on the ground the game
        accepts the signal at that position in none of its sixteen directions.
        The entity is lost at build time and nothing says so.
    */
    expect(
        await isAreaAvailable(page, [rail('straight-rail', 0)], onRail('rail-signal', 0)),
        'a signal on a straight rail'
    ).toBe(false)

    expect(
        await isAreaAvailable(page, [rail('half-diagonal-rail', 2)], onRail('rail-signal', 1)),
        'a signal on a half-diagonal rail'
    ).toBe(false)

    // Not what the straight/curved grouping would predict.
    expect(
        await isAreaAvailable(page, [rail('legacy-curved-rail', 0)], onRail('rail-signal', 0)),
        'a signal on a legacy curved rail'
    ).toBe(false)

    expect(
        await isAreaAvailable(page, [rail('legacy-straight-rail', 0)], onRail('rail-signal', 0)),
        'a signal on a cardinal legacy straight rail'
    ).toBe(false)

    // Chain signals are classified separately and read the same rule.
    expect(
        await isAreaAvailable(page, [rail('straight-rail', 0)], onRail('rail-chain-signal', 0)),
        'a chain signal on a straight rail'
    ).toBe(false)
})

test('a signal is still allowed on the rails that can hold one', async ({ page }) => {
    await waitForEditor(page)

    /*
        The guard against over-correcting. curved-rail-a has one game-legal
        signal position on its own tiles at each of its eight orientations and
        curved-rail-b two or three, and an integer tile grid cannot say which of
        its cells is the legal one - so refusing here would forbid placements the
        game allows. A blanket "no signals on rails" fix passes the test above
        and fails this one.
    */
    expect(
        await isAreaAvailable(page, [rail('curved-rail-a', 0)], onRail('rail-signal', 0)),
        'a signal on curved-rail-a'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [rail('curved-rail-b', 0)], onRail('rail-signal', 0)),
        'a signal on curved-rail-b'
    ).toBe(true)

    /*
        And the case no amount of reading the code would produce: a
        legacy-straight-rail is grouped with straight-rail everywhere in this
        function, but at its four diagonal orientations it holds one legal signal
        position on its own tiles where the cardinal ones hold none.
    */
    expect(
        await isAreaAvailable(page, [rail('legacy-straight-rail', 2)], onRail('rail-signal', 0)),
        'a signal on a diagonal legacy straight rail'
    ).toBe(true)
})

test('a gate on a straight rail needs the rail cardinal, not merely crosswise', async ({
    page,
}) => {
    await waitForEditor(page)

    /*
        The rule tested perpendicularity - gate.direction % 8 !== rail.direction
        % 8 - which is right for a north-south or east-west rail and wrong for a
        diagonal one, where the game accepts a gate at none of the 2704 swept
        placements against 128 at each cardinal orientation. The second
        expectation answered true before #95.
    */
    expect(
        await isAreaAvailable(page, [rail('straight-rail', 0)], onRail('gate', 4)),
        'a gate across a cardinal rail'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [rail('straight-rail', 2)], onRail('gate', 4)),
        'a gate on a diagonal rail'
    ).toBe(false)

    // Measured at all four of its orientations, and the reason the gate rules
    // say nothing about half-diagonal rails is that this is always the answer.
    expect(
        await isAreaAvailable(page, [rail('half-diagonal-rail', 2)], onRail('gate', 4)),
        'a gate on a half-diagonal rail'
    ).toBe(false)

    /*
        legacy-straight-rail carries no such restriction - the game takes gates
        at all six of its orientations - so the cardinality test is keyed on the
        prototype and not on the direction alone.
    */
    expect(
        await isAreaAvailable(page, [rail('legacy-straight-rail', 0)], onRail('gate', 4)),
        'a gate across a cardinal legacy rail'
    ).toBe(true)
})

test('a straight rail laid over a gate follows the same cardinal rule', async ({ page }) => {
    await waitForEditor(page)

    // Same measurement from the other side: of the rail directions the game
    // accepts overlapping a gate's tile, all normalise to 0 or 4.
    const gate: Placed = { name: 'gate', ...ON_THE_RAIL, direction: 4 }

    expect(
        await isAreaAvailable(page, [gate], rail('straight-rail', 0)),
        'a cardinal rail through a gate'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [gate], rail('straight-rail', 2)),
        'a diagonal rail through a gate'
    ).toBe(false)
})

test('the arms that stay permissive are untouched', async ({ page }) => {
    await waitForEditor(page)

    /*
        A rail dropped on a signal. The game refuses 88 of the 768 neighbouring
        rail placements a signal blocks, and this grid cannot tell which 88, so
        the editor keeps accepting all of them - see the comment on
        isAreaAvailable. Pinned so that narrowing it becomes a decision rather
        than a side effect of tidying the signal rule next to it.
    */
    expect(
        await isAreaAvailable(
            page,
            [{ name: 'rail-signal', ...ON_THE_RAIL, direction: 0 }],
            rail('straight-rail', 0)
        ),
        'a rail over a signal'
    ).toBe(true)

    // Nothing rail-shaped in the area, so the signal rule answers false the way
    // it always did - this is not new behaviour from #95.
    expect(
        await isAreaAvailable(
            page,
            [{ name: 'wooden-chest', ...ON_THE_RAIL, direction: 0 }],
            onRail('rail-signal', 0)
        ),
        'a signal on a chest'
    ).toBe(false)

    // And the check above all of these still short-circuits empty ground.
    expect(
        await isAreaAvailable(page, [rail('straight-rail', 0)], {
            name: 'rail-signal',
            x: 40.5,
            y: 40.5,
            direction: 0,
        }),
        'a signal nowhere near the rail'
    ).toBe(true)
})
