import { test, expect, Page } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { NOTCHES_PER_DOUBLING, ZOOM_MAX, ZOOM_MIN } from '../packages/editor/src/core/zoomLevels'

/*
    The zoom keybinds (#206 follow-up). The game has exactly these two controls -
    `zoom-in` and `zoom-out` sit in the binary's built-in control list next to
    `next-weapon` and `toggle-driving` - and this editor had none, which left
    `BlueprintContainer.zoom()` and the whole measured ladder reachable only from
    unit tests after the wheel went continuous.

    So this is the spec that gives the ladder a user-facing route. It is the only
    place the **stepped** behaviour is driven through real input: the wheel is
    continuous and deliberately does not land on rungs, so `zoom-ladder.spec.ts`
    cannot cover this and never will.

    Two things worth knowing before changing it:

      - **Keys are matched on `e.code`**, so the bindings are physical-key based
        (`Equal`, `Minus`) rather than character based. On a keyboard where `=`
        needs a modifier the code is still `Equal`, which is what makes this
        work without a layout table - and it is why the spec presses codes.
      - **A wheel read races the wheel event**, and a key press races the same
        way, so every read here syncs on a frame first. Without it, five presses
        read back as four. See zoom-ladder.spec.ts's header for the measurement.
*/

const rungIndex = (scale: number): number => Math.log2(scale) * NOTCHES_PER_DOUBLING

const settled = async (page: Page): Promise<number> => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    return page.evaluate(() => window.__fbe_test.viewportScale())
}

/** 100 tiles wide, so the fit lands mid-ladder rather than clamped at a limit. */
const wideBlueprint = encode({
    version: version(2, 0, 45),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 100.5, y: 0.5 } },
    ],
})

const open = async (page: Page): Promise<number> => {
    await page.goto('/')
    await waitForEditor(page)
    await loadBlueprint(page, wideBlueprint)
    await page.mouse.move(400, 300)
    return settled(page)
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
})

test('the zoom-in key lands on a rung', async ({ page }) => {
    /*
        The fit is on no rung, so this asserts the snap as well as the step:
        stepZoom goes to the NEAREST rung and then moves one index, which is the
        measured rule and the reason a keypress from 0.4 does not simply
        multiply by 2^(1/7).
    */
    const before = await open(page)
    expect(Math.abs(rungIndex(before) - Math.round(rungIndex(before)))).toBeGreaterThan(0.01)

    await page.keyboard.press('Equal')

    const after = await settled(page)
    expect(after).toBeGreaterThan(before)
    expect(rungIndex(after)).toBeCloseTo(Math.round(rungIndex(before)) + 1, 6)
})

test('the zoom-out key lands on a rung', async ({ page }) => {
    const before = await open(page)
    await page.keyboard.press('Minus')

    const after = await settled(page)
    expect(after).toBeLessThan(before)
    expect(rungIndex(after)).toBeCloseTo(Math.round(rungIndex(before)) - 1, 6)
})

test('stepping in then out returns to the same rung', async ({ page }) => {
    await open(page)
    await page.keyboard.press('Equal')
    const up = await settled(page)
    await page.keyboard.press('Minus')
    await page.keyboard.press('Equal')

    expect(await settled(page)).toBeCloseTo(up, 12)
})

test('holding the keys down stops at each limit', async ({ page }) => {
    /*
        The clamps through the stepped path rather than the continuous one. They
        are separate code - the wheel clamps a position in rungs, this clamps a
        scale - so one being right says nothing about the other.
    */
    await open(page)
    for (let i = 0; i < 50; i++) await page.keyboard.press('Minus')
    expect(await settled(page)).toBeCloseTo(ZOOM_MIN, 10)

    for (let i = 0; i < 50; i++) await page.keyboard.press('Equal')
    expect(await settled(page)).toBeCloseTo(ZOOM_MAX, 10)
})

test('the keys are rebindable like every other action', async ({ page }) => {
    /*
        Not decoration, and not assertable from storage: `exportKeybinds` writes
        only the binds that DIFFER from their default, so a fresh profile has an
        empty `keybinds2` and reading it proves nothing either way. The first
        draft of this test asserted the names were in there and failed for that
        reason rather than because anything was wrong.

        Rebinding is the real check, and it proves three things at once - the
        action is in the registry under the name it claims, a stored bind
        reaches it at startup, and the zoom is driven through the action system
        rather than by a listener hardcoded to a key that the settings pane
        could never show or change.
    */
    await page.addInitScript(() => {
        localStorage.setItem('keybinds2', JSON.stringify({ zoomIn: 'KeyJ' }))
    })
    const before = await open(page)

    /* The default key is gone... */
    await page.keyboard.press('Equal')
    expect(await settled(page)).toBe(before)

    /* ...and the one it was rebound to steps the ladder. */
    await page.keyboard.press('KeyJ')
    expect(rungIndex(await settled(page))).toBeCloseTo(Math.round(rungIndex(before)) + 1, 6)
})
