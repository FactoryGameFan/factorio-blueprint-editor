import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    What `PositionGrid.isAreaAvailable` answers around the four elevated-*
    rail types. Issue #133, item 4.

    Those types were never named in the function's classification switch, so
    they fell to `default:`, set `otherEntities` and read as ordinary
    obstructions. Crossing over things on the ground is the entire point of an
    elevated rail, and the editor refused it in both directions.

    Neither direction is dead code, which is worth stating because the obvious
    route to one of them does not exist: **no item places an elevated rail** -
    nothing in data.json has one as its `place_result` and the rail planner
    gives `straight-rail` - so the inventory cannot reach this. It is reached
    instead through `PaintBlueprintEntityContainer`, which calls
    `isAreaAvailable(this.entity.name, ...)` for every entity of a pasted
    selection, and from the other side by hand-placing anything at all under an
    elevated rail that a loaded blueprint brought with it.

    Measured, not reasoned about: tools/oracle/probe-elevated-rail-collision.mjs
    dumps every prototype's collision_mask from the running binary and then
    builds an elevated rail and asks can_place_entity what may sit under it,
    each answer paired with the same question on empty ground. The masks and the
    placements agree - see tools/oracle/fixtures/elevated-rail-collision.json.

    The refusals carry as much weight here as the acceptances. An elevated rail
    collides with a short, specific list, and the fix has to keep refusing those
    while letting everything else through; a change that simply ignored elevated
    rails entirely passes the first test and fails the second and third.
*/

const VERSION = packVersion(2, 0, 55)

interface Placed {
    name: string
    x: number
    y: number
    direction: number
}

/**
 * Same anchoring as rail-placement-rules.spec.ts: a rail at (1,1) covers tiles
 * (0,0) to (1,1). A 1x1 entity goes at (0.5, 0.5) and an even-sized one at
 * (1,1), both of which land squarely inside that pair whatever the footprint.
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

const elevated = (name: string, direction = 0): Placed => ({ name, ...RAIL_AT, direction })
/** For 1x1 and odd-sized entities */
const under = (name: string, direction = 0): Placed => ({ name, ...ON_THE_RAIL, direction })
/** For even-sized entities, which centre on the tile corner */
const underEven = (name: string, direction = 0): Placed => ({ name, ...RAIL_AT, direction })

test('a ground entity may sit under an elevated rail', async ({ page }) => {
    await waitForEditor(page)

    /*
        The direction a user meets first: load a blueprint carrying elevated
        rails, then try to build anything at all beneath one. Every case here
        answered false before #133 - an elevated rail set `otherEntities` and
        the function returned false at the end.

        All four are measured. With an elevated rail standing, the game accepts
        each of these at its position with the empty-ground control also true.
    */
    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], under('wooden-chest')),
        'a chest under an elevated straight rail'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], under('transport-belt')),
        'a belt under an elevated straight rail'
    ).toBe(true)

    // A ground rail passing under an elevated one, which is what an elevated
    // rail is for.
    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], under('straight-rail')),
        'a ground rail under an elevated straight rail'
    ).toBe(true)

    /*
        The one the rule most depends on. A rail support holds an elevated rail
        up and therefore has to overlap one, so it must not collide - the probe
        asserts its absence from the collider list as a control rather than
        leaving it as an omission.
    */
    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], under('rail-support')),
        'a rail support under an elevated straight rail'
    ).toBe(true)

    // And the other three elevated types, since the classification is by type
    // and one of them could be left out of the set without anything else noticing.
    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-half-diagonal-rail', 2)],
            under('wooden-chest')
        ),
        'a chest under an elevated half-diagonal rail'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [elevated('elevated-curved-rail-a')], under('wooden-chest')),
        'a chest under elevated-curved-rail-a'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [elevated('elevated-curved-rail-b')], under('wooden-chest')),
        'a chest under elevated-curved-rail-b'
    ).toBe(true)
})

test('the entities an elevated rail does collide with are still refused', async ({ page }) => {
    await waitForEditor(page)

    /*
        The guard against over-correcting, and the reason the fix is a collision
        layer rather than "ignore elevated rails". An elevated rail carries the
        elevated_rail layer and so does a short list of ground entities - things
        tall enough to be in the way. Both of these were measured behaviourally
        as well as read off the mask: with an elevated rail standing, the game
        refuses each at its position while accepting it on empty ground.
    */
    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], underEven('rail-ramp')),
        'a rail ramp under an elevated rail'
    ).toBe(false)

    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], underEven('roboport')),
        'a roboport under an elevated rail'
    ).toBe(false)

    /*
        These two are why the collider set is keyed by **name** and not by type.
        Only one assembling machine carries the layer and only one electric pole
        does, so a type key would refuse every machine and every pole. The pairs
        below fail together under a type key and pass together under a name one.
    */
    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-straight-rail')],
            underEven('big-electric-pole')
        ),
        'a big electric pole under an elevated rail'
    ).toBe(false)

    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-straight-rail')],
            under('medium-electric-pole')
        ),
        'a medium electric pole under an elevated rail'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [elevated('elevated-straight-rail')], under('oil-refinery')),
        'an oil refinery under an elevated rail'
    ).toBe(false)

    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-straight-rail')],
            under('assembling-machine-2')
        ),
        'an assembling machine under an elevated rail'
    ).toBe(true)
})

test('an elevated rail may be laid over the ground, and refused where it collides', async ({
    page,
}) => {
    await waitForEditor(page)

    /*
        The same question from the other side, which is the direction a paste
        takes. Not measured directly and it cannot be: an elevated rail with no
        support under it is unplaceable everywhere, so the probe's sweep came
        back 0 accepted against a 0 empty-ground control - a section its own
        control voids rather than answers. Collision is symmetric, so these
        follow from the masks and from the measured direction above.
    */
    expect(
        await isAreaAvailable(page, [under('wooden-chest')], elevated('elevated-straight-rail')),
        'an elevated rail over a chest'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [under('straight-rail')], elevated('elevated-straight-rail')),
        'an elevated rail over a ground rail'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [under('wooden-chest')], elevated('elevated-curved-rail-a')),
        'an elevated curved rail over a chest'
    ).toBe(true)

    expect(
        await isAreaAvailable(page, [underEven('roboport')], elevated('elevated-straight-rail')),
        'an elevated rail over a roboport'
    ).toBe(false)

    expect(
        await isAreaAvailable(page, [underEven('rail-ramp')], elevated('elevated-straight-rail')),
        'an elevated rail over a rail ramp'
    ).toBe(false)
})

test('elevated rails meet each other under the same rules ground rails do', async ({ page }) => {
    await waitForEditor(page)

    /*
        Two elevated rails are on the same layer, so the filter keeps both and
        the measured rail-versus-rail rules apply - which is why the elevated
        types are classified into their ground namesakes' buckets rather than
        given their own. This is a mirror of the ground behaviour rather than a
        measurement: the #95 probe skipped these types, and nothing has measured
        rail-on-rail for any type (issue #133, item 5). Pinned so that the
        mirroring is a decision.

        It matters for a real case, not a hypothetical one: elevated rail
        crossings are common, and a pasted selection places its entities one at
        a time, so the second rail of a crossing is asked about while the first
        is already down.
    */
    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-straight-rail', 0)],
            elevated('elevated-straight-rail', 4)
        ),
        'two elevated rails crossing'
    ).toBe(true)

    expect(
        await isAreaAvailable(
            page,
            [elevated('elevated-straight-rail', 0)],
            elevated('elevated-straight-rail', 0)
        ),
        'an elevated rail on an identical one'
    ).toBe(false)
})

test('the ground rules are untouched by the layer filter', async ({ page }) => {
    await waitForEditor(page)

    /*
        The filter only ever removes entities from consideration, so a mistake in
        it that removed too much would quietly turn `isAreaAvailable` into
        "always true" for everything. These three are the controls for that, and
        they involve no elevated rail at all.
    */
    expect(
        await isAreaAvailable(page, [under('wooden-chest')], under('wooden-chest')),
        'a chest on a chest'
    ).toBe(false)

    // From #95, and the arm most easily lost: a signal on a straight rail is a
    // blueprint the game will not build back.
    expect(
        await isAreaAvailable(page, [elevated('straight-rail', 0)], under('rail-signal')),
        'a signal on a ground straight rail'
    ).toBe(false)

    // And the permissive one next to it, so the control cuts both ways.
    expect(
        await isAreaAvailable(page, [elevated('curved-rail-a', 0)], under('rail-signal')),
        'a signal on curved-rail-a'
    ).toBe(true)
})
