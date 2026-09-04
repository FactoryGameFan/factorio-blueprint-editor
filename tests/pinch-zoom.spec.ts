import { devices, expect, test, type Page } from '@playwright/test'
import { ZOOM_MAX, ZOOM_MIN } from '../packages/editor/src/core/zoomLevels'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

// hasTouch alone does not enable the handlers: BlueprintContainer also checks
// Pixi's user-agent-based isMobile.any. Keep the mobile UA and Retina scale.
test.use({ ...devices['Pixel 7'] })

const blueprint = encodeBlueprint({
    item: 'blueprint',
    icons: [],
    version: packVersion(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 30.5, y: 0.5 } },
    ],
})

type TouchStep = {
    type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'
    distance: number
    identifierOffset?: number
}

/** Dispatch a burst in one JS task, with no scale read or render between moves. */
async function touches(page: Page, steps: TouchStep[]): Promise<number> {
    return page.evaluate(async steps => {
        const canvas = document.querySelector<HTMLCanvasElement>('#editor')
        if (!canvas) throw new Error('editor canvas is missing')
        const rect = canvas.getBoundingClientRect()
        for (const { type, distance, identifierOffset = 0 } of steps) {
            const points = [-1, 1].map(
                (side, identifier) =>
                    new Touch({
                        identifier: identifier + identifierOffset,
                        target: canvas,
                        clientX: rect.left + rect.width / 2 + (side * distance) / 2,
                        clientY: rect.top + rect.height / 2,
                    })
            )
            const ended = type === 'touchend' || type === 'touchcancel'
            canvas.dispatchEvent(
                new TouchEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    touches: ended ? [] : points,
                    targetTouches: ended ? [] : points,
                    changedTouches: points,
                })
            )
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        return window.__fbe_test.viewportScale()
    }, steps)
}

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, blueprint)
    const scale = await page.evaluate(() => window.__fbe_test.viewportScale())
    expect(scale).toBeGreaterThan(ZOOM_MIN * 2)
    expect(scale).toBeLessThan(ZOOM_MAX / 2)
})

test('pinching apart and together follows the finger distance ratio', async ({ page }) => {
    const before = await page.evaluate(() => window.__fbe_test.viewportScale())
    const apart = await touches(page, [
        { type: 'touchstart', distance: 100 },
        { type: 'touchmove', distance: 150 },
    ])
    expect(apart).toBeCloseTo(before * 1.5, 8)

    const together = await touches(page, [{ type: 'touchmove', distance: 100 }])
    expect(together).toBeCloseTo(before, 8)
})

test('several pinch moves before a frame compose multiplicatively', async ({ page }) => {
    const before = await page.evaluate(() => window.__fbe_test.viewportScale())
    const after = await touches(page, [
        { type: 'touchstart', distance: 100 },
        { type: 'touchmove', distance: 125 },
        { type: 'touchmove', distance: 175 },
        { type: 'touchmove', distance: 140 },
    ])
    expect(after).toBeCloseTo(before * 1.4, 8)
})

test('the ceiling clamps an overshoot and immediately permits pinching back', async ({ page }) => {
    const atLimit = await touches(page, [
        { type: 'touchstart', distance: 10 },
        { type: 'touchmove', distance: 300 },
    ])
    expect(atLimit).toBeCloseTo(ZOOM_MAX, 8)
    const reversed = await touches(page, [{ type: 'touchmove', distance: 150 }])
    expect(reversed).toBeCloseTo(ZOOM_MAX / 2, 8)
})

test('the floor clamps an overshoot and immediately permits pinching back', async ({ page }) => {
    const atLimit = await touches(page, [
        { type: 'touchstart', distance: 200 },
        { type: 'touchmove', distance: 1 },
    ])
    expect(atLimit).toBeCloseTo(ZOOM_MIN, 8)
    const reversed = await touches(page, [{ type: 'touchmove', distance: 2 }])
    expect(reversed).toBeCloseTo(ZOOM_MIN * 2, 8)
})

for (const end of ['touchend', 'touchcancel'] as const) {
    test(`a new pinch after ${end} uses its own starting distance`, async ({ page }) => {
        const before = await page.evaluate(() => window.__fbe_test.viewportScale())
        const after = await touches(page, [
            { type: 'touchstart', distance: 100 },
            { type: 'touchmove', distance: 150 },
            { type: end, distance: 150 },
            { type: 'touchstart', distance: 200, identifierOffset: 2 },
            { type: 'touchmove', distance: 240, identifierOffset: 2 },
        ])
        expect(after).toBeCloseTo(before * 1.5 * 1.2, 8)
    })
}
