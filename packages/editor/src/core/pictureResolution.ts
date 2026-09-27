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
*/

/**
 * `requested`, lowered where needed so that `width * resolution` and
 * `height * resolution` both stay within `maxTextureSize`. It can come out
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
    if (!(longest > 0) || !(maxTextureSize > 0)) return wanted
    if (longest * wanted <= maxTextureSize) return wanted

    const fitted = maxTextureSize / longest
    /*
        A division then a multiplication can land a hair above the limit - a
        limit of 10000 and 145 px across gives 10000.000000000002 - and pixi's
        WebGPU texture system takes `Math.ceil` of the pixel size, so that hair
        is a whole pixel too many. Half a pixel of headroom rounds back down.
        Measured, it never happens for a power-of-two limit and a whole number
        of tiles, which is every real case; this is for the case that is not.
    */
    return longest * fitted > maxTextureSize ? (maxTextureSize - 0.5) / longest : fitted
}
