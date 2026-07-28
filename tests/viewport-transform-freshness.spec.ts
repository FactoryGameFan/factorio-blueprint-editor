import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    That a screen position read straight after a load is the real one (issue
    #144).

    `Viewport.centerViewPort` computes a new scale and position and sets a dirty
    flag, leaving the matrix itself to be rebuilt by `update()` on the render
    ticker. `getTransform()` handed back the **stale** matrix until that frame
    ran, and `BlueprintContainer.toScreen` - which is what every spec aims its
    pointer with, through `entityScreenPosition` - reads it.

    So for the gap between `loadBp` resolving and the next frame, an entity's
    reported screen position was computed from the viewport as it was *before*
    the blueprint was centred. Measured, that put a machine at (-80, -16): off
    the canvas entirely.

    Why this was worth chasing rather than retrying. Every pointer-driven spec
    starts by loading a blueprint and asking where an entity is, and normally
    survives only because a `page.evaluate` round-trip is long enough for a frame
    to land in the middle. When one does not - a busy machine, a long suite - the
    pointer is sent to a coordinate the entity is not at, the hover never
    arrives, and the spec fails on a 10s timeout that names nothing. It presents
    as a broken setter in whatever was last touched, and it cost two PRs' worth
    of proving the failure was pre-existing before it was diagnosed.

    This test is deterministic where the bug was not: it reads the position
    inside the same evaluate as the load, with no yield, so the frame *cannot*
    have run. Before the fix it failed 25 times out of 25.
*/

const BP = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'assembling-machine-2', position: { x: 1, y: 1 }, direction: 0 },
        { entity_number: 2, name: 'requester-chest', position: { x: 7, y: 1 }, direction: 0 },
    ],
})

test('a screen position read before the next frame is already the centred one', async ({
    page,
}) => {
    await page.goto('/')
    await waitForEditor(page)

    const r = await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        // No yield between these two, so no frame can run in the gap. The whole
        // point: this must not depend on the ticker having fired.
        const immediate = t.entityScreenPosition(1)
        await new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
        )
        const settled = t.entityScreenPosition(1)
        return { immediate, settled }
    }, BP)

    expect(r.immediate, 'entity 1 should exist').toBeDefined()
    expect(r.immediate).toEqual(r.settled)
})

test('the position it reports is actually on the canvas', async ({ page }) => {
    /*
        The above would also pass if both reads were equally wrong, so this pins
        the value rather than the agreement: a blueprint the editor has just
        centred puts its entities inside the viewport. The measured failure was
        (-80, -16), which this catches and the equality check alone would not.
    */
    await page.goto('/')
    await waitForEditor(page)

    const r = await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        return {
            at: t.entityScreenPosition(1),
            viewport: { w: window.innerWidth, h: window.innerHeight },
        }
    }, BP)

    const at = r.at
    if (at === undefined) throw new Error('entity 1 is not in the loaded blueprint')
    expect(at.x).toBeGreaterThan(0)
    expect(at.y).toBeGreaterThan(0)
    expect(at.x).toBeLessThan(r.viewport.w)
    expect(at.y).toBeLessThan(r.viewport.h)
})

test('reading the transform early does not stop the blueprint being drawn', async ({ page }) => {
    /*
        The over-correction, and the reason it needs its own test: making
        `getTransform` clear the dirty flag as well as rebuild the matrix passes
        both tests above and every pointer spec in the suite. `update()`'s return
        value is what writes this container's position and scale, so clearing the
        flag from a *read* hands the caller a fresh transform and then skips the
        draw - the model is centred, the pixels are not, and every coordinate the
        editor reports stays self-consistent because `toScreen` and `toWorld`
        both read the same transform. Only a screenshot would show it.

        So this reads the transform first, exactly the way a spec does, and then
        asks whether the frame still happened. Mutation-checked: clearing the
        flag in `getTransform` fails this and nothing else.
    */
    await page.goto('/')
    await waitForEditor(page)

    const inSync = await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        // the read under suspicion, before any frame can run
        t.entityScreenPosition(1)
        await new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
        )
        return t.viewportRenderedInSync()
    }, BP)

    expect(inSync, 'the blueprint is centred in the model but not on screen').toBe(true)
})
