import { describe, expect, it } from 'vite-plus/test'
import { clampPictureResolution, MAX_PICTURE_SIDE } from './pictureResolution'

describe('clampPictureResolution', () => {
    it('keeps a resolution that fits', () => {
        expect(clampPictureResolution(1, 320, 192, 8192)).toBe(1)
        expect(clampPictureResolution(4, 2048, 1024, 8192)).toBe(4)
    })

    it('shrinks to the longest side when the request does not fit', () => {
        expect(clampPictureResolution(4, 4096, 1024, 8192)).toBe(2)
        expect(clampPictureResolution(1000, 96, 64, 8192) * 96).toBe(8192)
    })

    it('caps the side at MAX_PICTURE_SIDE when the GPU allows more', () => {
        expect(MAX_PICTURE_SIDE).toBe(8192)
        // A 128-tile square at 4x, which a 16384 limit alone would let through.
        expect(clampPictureResolution(4, 4096, 4096, 16384)).toBe(2)
        expect(clampPictureResolution(1, 16384, 320, 32768)).toBe(0.5)
        // A GPU limit below the cap still wins.
        expect(clampPictureResolution(4, 4096, 4096, 4096)).toBe(1)
    })

    it('falls back to MAX_PICTURE_SIDE for a limit that is not a positive number', () => {
        expect(clampPictureResolution(4, 4096, 4096, 0)).toBe(2)
        expect(clampPictureResolution(4, 4096, 4096, Number.NaN)).toBe(2)
    })

    it('goes below 1 for a blueprint too big at 1x', () => {
        expect(clampPictureResolution(1, 16384, 320, 8192)).toBe(0.5)
    })

    it('never lets pixi ceil a side past the limit', () => {
        for (const max of [4096, 5000, 6000, 8192, 16384]) {
            for (let longest = 1; longest < 20000; longest += 7) {
                const resolution = clampPictureResolution(64, longest, 1, max)
                expect(Math.ceil(longest * resolution)).toBeLessThanOrEqual(
                    Math.min(max, MAX_PICTURE_SIDE)
                )
            }
        }
    })

    it('reads a missing or nonsensical request as 1', () => {
        expect(clampPictureResolution(0, 320, 320, 8192)).toBe(1)
        expect(clampPictureResolution(-2, 320, 320, 8192)).toBe(1)
        expect(clampPictureResolution(Number.NaN, 320, 320, 8192)).toBe(1)
    })
})
