import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    What survives the decode -> model -> serialize path for the three grid
    snapping fields: `snap-to-grid`, `absolute-snapping` and
    `position-relative-to-grid`.

    Nothing pinned this before. `blueprint-round-trip.spec.ts` did catch PR
    #222 dropping `position-relative-to-grid`, but only by accident of the
    corpus: exactly ONE of its 367 blueprints carries a grid position ("Biolabs
    750 SPM" in test-blueprints/EARN/pocket-base-space-age-v22.1.2.txt, at
    {80, 106}). Re-capture that fixture, or swap the corpus the way #186 did,
    and the coverage leaves with it. What it reports is also a changed hash
    rather than a named field, so it says something moved without saying what.

    The rule these assert is measured, not reasoned - the game itself, on
    2.0.77, in tools/oracle/fixtures/blueprint-snapping.json:

        position-relative-to-grid is written under ABSOLUTE snapping and
        omitted under RELATIVE.

    Set a grid position of {3, 5} in relative mode and the game writes no
    position key at all; set the same one in absolute mode and it writes it.
    That is the opposite of what #222 implemented, and the first test below is
    the one that fails under its rule.

    Synthetic, and it has to be: the corpus cannot reach relative snapping at
    all. All 325 of its blueprints that carry snapping are absolute, so a test
    built from real exports could not tell the two modes apart - which is
    exactly why the corpus could not have answered the question and the binary
    had to.

    Mutation-checked against the real thing rather than an invented one: with
    PR #222's own condition pasted into Blueprint.serialize, two of the five
    fail - "an absolute grid position survives the round trip" and "a grid
    position at the origin is carried as it arrived" - and the other three
    pass. So the first test is not decoration, and the origin test is doing
    work of its own rather than restating it.

    Fixed point, not a snapshot to refresh. A diff here means the serialization
    of a blueprint's own grid settings changed; check it against the fixture
    before touching the numbers.
*/

/** Current, so no name migration applies - see nameMigrations.ts. */
const VERSION = packVersion(2, 0, 55)

/** One entity, so the blueprint is non-empty and serialize() has something to do. */
const ENTITIES = [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }]

interface Snapping {
    'snap-to-grid'?: { x: number; y: number }
    'absolute-snapping'?: boolean
    'position-relative-to-grid'?: { x: number; y: number }
}

/** Decode a synthetic blueprint and hand back only the three keys, as serialized. */
async function serializedSnapping(
    page: import('@playwright/test').Page,
    snapping: Snapping
): Promise<Snapping> {
    const source = encodeBlueprint({
        item: 'blueprint',
        version: VERSION,
        entities: ENTITIES,
        ...snapping,
    })

    return page.evaluate(async (src: string) => {
        const bp = (await window.__fbe_test.getBlueprintOrBookFromSource(src)) as unknown as {
            serialize: () => Record<string, unknown>
        }
        const out = bp.serialize()
        const pick = (k: string): unknown => out[k] ?? undefined
        /*
            Rebuilt rather than returned whole: serialize() carries entities and
            a version too, and a test that compared the whole object would fail
            for reasons that have nothing to do with snapping.
        */
        return {
            'snap-to-grid': pick('snap-to-grid'),
            'absolute-snapping': pick('absolute-snapping'),
            'position-relative-to-grid': pick('position-relative-to-grid'),
        } as Snapping
    }, source)
}

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

test('an absolute grid position survives the round trip', async ({ page }) => {
    /*
        THE ONE THAT MATTERS. This is the configuration the game itself
        produces - absolute snapping with an offset - and the one PR #222
        dropped, taking the field off 325 of the corpus's 367 blueprints.
    */
    const out = await serializedSnapping(page, {
        'snap-to-grid': { x: 2, y: 2 },
        'absolute-snapping': true,
        'position-relative-to-grid': { x: 3, y: 5 },
    })

    expect(out['snap-to-grid']).toEqual({ x: 2, y: 2 })
    expect(out['absolute-snapping']).toBe(true)
    expect(out['position-relative-to-grid']).toEqual({ x: 3, y: 5 })
})

test('absolute snapping with no position keeps the grid and the mode', async ({ page }) => {
    const out = await serializedSnapping(page, {
        'snap-to-grid': { x: 4, y: 8 },
        'absolute-snapping': true,
    })

    expect(out['snap-to-grid']).toEqual({ x: 4, y: 8 })
    expect(out['absolute-snapping']).toBe(true)
    expect(out['position-relative-to-grid']).toBeUndefined()
})

test('relative snapping keeps the grid and stays relative', async ({ page }) => {
    /*
        Relative is the ABSENCE of `absolute-snapping`, not `false` - the game
        omits the key rather than writing false, which is why the corpus has no
        blueprint carrying it as false and why this case is synthetic.
    */
    const out = await serializedSnapping(page, { 'snap-to-grid': { x: 2, y: 2 } })

    expect(out['snap-to-grid']).toEqual({ x: 2, y: 2 })
    expect(out['absolute-snapping']).toBeUndefined()
    expect(out['position-relative-to-grid']).toBeUndefined()
})

test('a blueprint with no snapping serializes none of the three keys', async ({ page }) => {
    /*
        The control, and it can fail while the three above pass: a change that
        wrote a default grid onto every blueprint would satisfy every
        assertion up there and be caught only here. 42 of the corpus's 367
        blueprints are in this state.
    */
    const out = await serializedSnapping(page, {})

    expect(out['snap-to-grid']).toBeUndefined()
    expect(out['absolute-snapping']).toBeUndefined()
    expect(out['position-relative-to-grid']).toBeUndefined()
})

test('a grid position at the origin is carried as it arrived', async ({ page }) => {
    /*
        Current behaviour rather than the game's: the game omits
        `position-relative-to-grid` at {0, 0} in both modes, so it never writes
        this blueprint. The editor passes through what it was given, which is
        harmless for a hand-made string and is what the other four tests
        depend on - they assert pass-through too. Pinned so that a future
        change to drop defaults on write is a decision someone makes, rather
        than a side effect that quietly rewrites input.
    */
    const out = await serializedSnapping(page, {
        'snap-to-grid': { x: 2, y: 2 },
        'absolute-snapping': true,
        'position-relative-to-grid': { x: 0, y: 0 },
    })

    expect(out['position-relative-to-grid']).toEqual({ x: 0, y: 0 })
})

test('absolute-snapping with no grid is stripped, not passed through', async ({ page }) => {
    /*
        A state the in-game GUI cannot reach: there is no way to set "absolute"
        or a grid position without first turning `snap-to-grid` on. The fixture
        row this comes from ("no-grid-absolute-set" in
        tools/oracle/fixtures/blueprint-snapping.json) shows the game itself
        will still WRITE `absolute-snapping: true` and a `position-relative-to-
        grid` here if a mod forces the setters directly - but its own controls
        mark that row unscored: re-importing what it wrote reads back as
        `absolute: false, position: null`, so the write does not even survive
        the game's own round trip. Forwarding it here would preserve a shape
        that is not reachable through play and that the game itself cannot
        reconstruct.

        So this layer normalises it instead: `snap-to-grid` gates the other
        two on serialize (Blueprint.ts's `snapToGrid && absoluteSnapping`),
        which strips all three keys whenever there is no grid to be relative
        to. Pinned so a future change to forward `absolute-snapping` and
        `position-relative-to-grid` unconditionally - which would match the
        game's raw `written` value for this one row - is a decision, not a
        side effect.
    */
    const out = await serializedSnapping(page, {
        'absolute-snapping': true,
        'position-relative-to-grid': { x: 3, y: 5 },
    })

    expect(out['snap-to-grid']).toBeUndefined()
    expect(out['absolute-snapping']).toBeUndefined()
    expect(out['position-relative-to-grid']).toBeUndefined()
})
