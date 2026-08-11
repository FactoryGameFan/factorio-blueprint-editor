import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    A splitter takes circuit wires in 2.0, and factorioData.ts answered nothing
    about them until the corpus went public (#186). Two separate switches were
    missing a `case 'splitter'`, and the two failed in completely different ways:

    - `getCircuitConnector` fell to its `default:`, so a splitter had no wire
      connection point. Nothing catches around `WiresContainer.add` - the call
      is inside `BlueprintContainer.initBP` and the nearest handler above it is
      the one that reports a corrupt blueprint - so a single wired splitter threw
      "Could not find the wire connection point!" and lost the *whole* blueprint.
      Not a missing sprite: everything else on screen went with it.

    - `getMaxWireDistance` fell to its `default: return 0`, and a reach of 0 only
      makes `WiresContainer.createWire` draw the wire at alpha 0.3, as though the
      two ends were too far apart. Wrong, and completely silent.

    The asymmetry is why this spec exists rather than leaving it to the corpus.
    The connector half is loudly covered by accident: revert it and the overlay,
    sprite-generation and sprite-data specs all fail, because a blueprint that
    will not load produces no digests. Nothing at all covered the distance half
    when this spec was written. `entity-accessors.spec.ts` did tally
    `maxWireDistance` over every entity in the corpus, but it bucketed into
    value/empty/nothing/threw, and 0 and 9 both landed in `value` - so the
    fixture did not move. Mutation-checked at the time: deleting `case 'splitter'`
    from `getMaxWireDistance` alone left Playwright, vitest and `vp check` all
    green, and every wired splitter in every blueprint quietly drew its wires as
    out of range.

    That mutation is now caught twice, from opposite directions, and neither
    catcher is this spec. #205's `wire-switch-completeness.test.ts` asks the
    prototype side - every entity declaring `circuit_wire_max_distance` must read
    back the same number - and it is vitest, so it runs in CI, which this does
    not. #189 then moved `maxWireDistance` into `entity-accessors.spec.ts`'s
    exact-histogram half, where the same deletion moves 4202 splitters from the
    `9` key to the `0` key.

    So read this spec as covering the *editor-facing* behaviour rather than as
    the only thing standing between that case and a regression. And note how the
    claim above went stale: it was invalidated twice by changes to files that
    never open this one, which is the failure mode any "mutation-checked:
    nothing catches this" note carries.

    Synthetic rather than corpus-driven on purpose. The blueprint that found this
    is JEPAKAZOL/fulgora-mall-4-planets, but a spec that named it would be
    answering "does that file still contain a wired splitter" - which #186 has
    just demonstrated is not a stable question.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/*
    Entities 1 and 2 reproduce the shape that broke: two turbo-splitters four
    tiles apart at direction 12, joined by one red circuit wire. The 2.0 `wires`
    form is [entity, connector, entity, connector], and connector 1 is the red
    circuit side of anything that is not a combinator - copied from the real
    wire, `[391, 1, 855, 1]`, rather than worked out from the format.

    3 to 5 are the other three splitter prototypes at the other three facings,
    since the connection point is indexed `circuit_connector[direction / 4]` and
    one facing proves nothing about the other three.

    6 is a pipe: an entity in neither switch, so it answers 0 and no connection
    point. Without it a hook that reported 9 for everything would satisfy every
    assertion below.
*/
const SPLITTERS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'turbo-splitter', position: { x: 0.5, y: 0 }, direction: 12 },
        { entity_number: 2, name: 'turbo-splitter', position: { x: 0.5, y: 4 }, direction: 12 },
        { entity_number: 3, name: 'splitter', position: { x: 8, y: 0.5 } },
        { entity_number: 4, name: 'fast-splitter', position: { x: 12.5, y: 0 }, direction: 4 },
        { entity_number: 5, name: 'express-splitter', position: { x: 16, y: 0.5 }, direction: 8 },
        { entity_number: 6, name: 'pipe', position: { x: 20.5, y: 0.5 } },
    ],
    wires: [[1, 1, 2, 1]],
})

/** Every splitter in SPLITTERS, with the facing it is on. */
const SPLITTER_ENTITIES = [
    { entityNumber: 1, name: 'turbo-splitter', direction: 12 },
    { entityNumber: 2, name: 'turbo-splitter', direction: 12 },
    { entityNumber: 3, name: 'splitter', direction: 0 },
    { entityNumber: 4, name: 'fast-splitter', direction: 4 },
    { entityNumber: 5, name: 'express-splitter', direction: 8 },
]

const PIPE = 6

interface Attachment {
    maxWireDistance: number
    red: boolean
    green: boolean
}

const attachmentOf = (page: Page, entityNumber: number): Promise<Attachment> =>
    page.evaluate(n => window.__fbe_test.entityWireAttachment(n), entityNumber)

async function load(page: Page): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await waitForEditor(page)
    await loadBlueprint(page, SPLITTERS)
    return errors
}

test('a blueprint holding a wired splitter loads at all', async ({ page }) => {
    /*
        The connector half, stated as the thing the user actually lost. This is
        the only assertion here that the old code fails by *throwing* rather than
        by answering wrongly, and the throw happens during the load itself, so
        every later expectation is unreachable rather than red.
    */
    const errors = await load(page)

    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(6)
    expect(await page.evaluate(() => window.__fbe_test.wireCount())).toBe(1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a splitter offers a wire somewhere to attach, at every facing', async ({ page }) => {
    /*
        The same half again, said in a way that names a splitter. The test above
        would also fail if loading broke for some entirely unrelated reason; this
        one can only fail because a splitter has no connection point.
    */
    await load(page)

    for (const { entityNumber, name, direction } of SPLITTER_ENTITIES) {
        const at = await attachmentOf(page, entityNumber)
        expect(at.red, `${name} at direction ${direction} has no red connection point`).toBe(true)
        expect(at.green, `${name} at direction ${direction} has no green connection point`).toBe(
            true
        )
    }
})

test('a splitter reports the wire reach its prototype declares', async ({ page }) => {
    /*
        The distance half, and the only assertion in the suite that can see it.
        9 is `circuit_wire_max_distance` in data.json, the same for all four
        splitter prototypes and the same as a transport belt's. The number that
        matters is really "not 0" - 0 is what the missing case answered - but
        pinning the real one costs nothing and says where it comes from.
    */
    await load(page)

    for (const { entityNumber, name } of SPLITTER_ENTITIES) {
        const at = await attachmentOf(page, entityNumber)
        expect(at.maxWireDistance, `${name} reports the wrong wire reach`).toBe(9)
    }
})

test('an entity in neither switch still answers nothing', async ({ page }) => {
    /*
        The control, and it has to be able to fail while the two tests above
        pass. A pipe is in neither `getCircuitConnector` nor `getMaxWireDistance`
        and should stay that way: it is what those functions answering
        indiscriminately would look like.
    */
    await load(page)

    const at = await attachmentOf(page, PIPE)
    expect(at.maxWireDistance).toBe(0)
    expect(at.red).toBe(false)
    expect(at.green).toBe(false)
})
