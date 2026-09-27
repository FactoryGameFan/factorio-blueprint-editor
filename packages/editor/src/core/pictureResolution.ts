/*
    The resolution an image export actually renders at (#341).

    Pure - no pixi, no globals - so `pictureResolution.test.ts` runs under
    `vp test`, following zoomLevels.ts.

    `getBlueprintBounds` has no upper limit, so a large blueprint at a high
    resolution asks for a texture wider than the GPU can allocate. At 1x the
    editor draws 32 px per tile, and the headless Chromium the specs run in
    reports a WebGL MAX_TEXTURE_SIZE of 8192, so a blueprint 257 tiles across
    was already past it before any resolution setting existed. Rather than
    fail, the export shrinks to the largest resolution that fits.

    The side is also capped at MAX_PICTURE_SIDE whatever the GPU reports. Many
    desktop GPUs report a WebGL limit of 16384, and a 16384 x 16384 picture is
    1 GiB of RGBA read back by `extract.canvas` plus as much again for the
    canvas it is copied into - enough to crash the tab or have `toBlob` hand
    back null. A 128-tile square blueprint at 4x reaches that.
*/

/**
 * The longest side an exported picture may have, in pixels. 8192 is also the
 * WebGPU limit pixi runs with (it requests the default device limits), so the
 * two backends export at the same size. At 8192 x 8192 the readback is 256 MiB.
 */
export const MAX_PICTURE_SIDE = 8192

/**
 * `requested`, lowered where needed so that `width * resolution` and
 * `height * resolution` both stay within `maxTextureSize`, and within
 * `MAX_PICTURE_SIDE` where the GPU allows more. It can come out
 * below 1: a blueprint too big for the texture at 1x is exported smaller
 * rather than not at all.
 *
 * A requested value that is not a positive number answers 1, the default,
 * because pixi's `generateTexture` reads a resolution of 0 as "use the
 * renderer's own" - the screen's device pixel ratio.
 */
export function clampPictureResolution(
    requested: number,
    width: number,
    height: number,
    maxTextureSize: number
): number {
    const wanted = Number.isFinite(requested) && requested > 0 ? requested : 1
    const longest = Math.max(width, height)
    const maxSide =
        maxTextureSize > 0 ? Math.min(maxTextureSize, MAX_PICTURE_SIDE) : MAX_PICTURE_SIDE
    if (!(longest > 0)) return wanted
    if (longest * wanted <= maxSide) return wanted

    const fitted = maxSide / longest
    /*
        A division then a multiplication can land a hair above the limit - a
        limit of 5000 and 145 px across gives 5000.000000000001 - and pixi's
        WebGPU texture system takes `Math.ceil` of the pixel size, so that hair
        is a whole pixel too many. Half a pixel of headroom rounds back down.
        Measured, it never happens for a power-of-two limit and a whole number
        of tiles, which is every real case; this is for the case that is not.
    */
    return longest * fitted > maxSide ? (maxSide - 0.5) / longest : fitted
}
