import { test, expect, type Page } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    The image export's resolution and background - issue #341.

    Before, `getPicture` rendered at a hardcoded resolution of 1 and captured the
    background grids with the blueprint, so every export was 32 px per tile over
    an opaque checkerboard. Both halves fail against that code: the 2x picture
    comes back the same size as the 1x one, and the empty corner reads alpha 255.

    Two chests at opposite ends of a 21 x 3 tile strip, so the top-right corner
    of the picture has nothing in it, and the strip is long and thin so the
    clamped export in the last test stays small enough to read back quickly.
*/

const BLUEPRINT = encodeBlueprint({
    item: 'blueprint',
    version: packVersion(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 20.5, y: 2.5 } },
    ],
})

interface Picture {
    width: number
    height: number
    /** Alpha of the top-right pixel. */
    cornerAlpha: number
    /** Highest alpha anywhere, so a picture of nothing cannot pass. */
    maxAlpha: number
}

function readPicture(page: Page, resolution?: number): Promise<Picture> {
    return page.evaluate(async (res?: number) => {
        const blob = await window.__fbe_test.getPicture(res)
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('No 2d context')
        ctx.drawImage(bitmap, 0, 0)
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
        let maxAlpha = 0
        for (let i = 3; i < data.length; i += 4) maxAlpha = Math.max(maxAlpha, data[i])
        return {
            width: bitmap.width,
            height: bitmap.height,
            cornerAlpha: data[(bitmap.width - 1) * 4 + 3],
            maxAlpha,
        }
    }, resolution)
}

/** A PNG's dimensions from its IHDR chunk, without decoding the pixels. */
function readPictureSize(
    page: Page,
    resolution: number
): Promise<{ width: number; height: number; maxTextureSize: number }> {
    return page.evaluate(async (res: number) => {
        const blob = await window.__fbe_test.getPicture(res)
        const header = new DataView(await blob.slice(0, 24).arrayBuffer())
        const gl = document.createElement('canvas').getContext('webgl2')
        return {
            width: header.getUint32(16),
            height: header.getUint32(20),
            maxTextureSize: gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0,
        }
    }, resolution)
}

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(page, BLUEPRINT)
    /*
        `loadBp` resolves before the sprite sheets arrive: `G.getTexture` hands
        out an empty texture and fills it in when the file loads. Measured, the
        first picture after loading was 672 x 96 and fully transparent, and the
        one after 1344 x 256 at 2x - the chest's sprite is taller than its tile,
        so the bounds grow once it is really there. Wait until two pictures in a
        row agree and something is drawn.
    */
    let last = ''
    await expect
        .poll(async () => {
            const picture = JSON.stringify(await readPicture(page))
            const settled = picture === last && picture.includes('"maxAlpha":255')
            last = picture
            return settled
        })
        .toBe(true)
})

test('the default export leaves the background out', async ({ page }) => {
    const picture = await readPicture(page)
    expect(picture.maxAlpha).toBe(255)
    expect(picture.cornerAlpha).toBe(0)
})

test('resolution 2 exports twice the size of resolution 1', async ({ page }) => {
    const one = await readPicture(page, 1)
    const two = await readPicture(page, 2)
    expect(one.width).toBeGreaterThan(21 * 32 - 1)
    expect(two.width).toBe(one.width * 2)
    expect(two.height).toBe(one.height * 2)
    expect(two.maxAlpha).toBe(255)
    expect(two.cornerAlpha).toBe(0)
    // Nothing was clamped, so nothing is said.
    await expect(page.locator('.toasts-text', { hasText: 'instead of' })).toHaveCount(0)
})

test('a resolution past the texture limit is clamped, not thrown', async ({ page }) => {
    const one = await readPictureSize(page, 1)
    const huge = await readPictureSize(page, 1000)
    const longest = Math.max(huge.width, huge.height)
    // Capped at MAX_PICTURE_SIDE, 8192, or lower where the GPU's own limit is.
    expect(huge.maxTextureSize).toBeGreaterThan(0)
    expect(longest).toBeLessThanOrEqual(8192)
    expect(longest).toBeGreaterThanOrEqual(Math.min(huge.maxTextureSize, 8192) - 1)
    // Scaled as a whole, not cropped: the strip keeps its shape.
    expect(huge.width / huge.height).toBeCloseTo(one.width / one.height, 1)
    // And the user is told the scale it came out at (#539 review).
    await expect(page.locator('.toasts-warning .toasts-text')).toContainText('instead of 1000x')
})
