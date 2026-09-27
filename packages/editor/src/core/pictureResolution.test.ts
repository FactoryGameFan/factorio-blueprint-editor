import { describe, expect, it } from 'vite-plus/test'
import { clampPictureResolution } from './pictureResolution'

describe('clampPictureResolution', () => {
    it('keeps a resolution that fits', () => {
        expect(clampPictureResolution(1, 320, 192, 8192)).toBe(1)
        expect(clampPictureResolution(4, 2048, 1024, 8192)).toBe(4)
    })

    it('shrinks to the longest side when the request does not fit', () => {
        expect(clampPictureResolution(4, 4096, 1024, 8192)).toBe(2)
        expect(clampPictureResolution(1000, 96, 64, 8192) * 96).toBe(8192)
    })

    it('goes below 1 for a blueprint too big at 1x', () => {
        expect(clampPictureResolution(1, 16384, 320, 8192)).toBe(0.5)
    })

    it('never lets pixi ceil a side past the limit', () => {
        for (const max of [4096, 8192, 10000, 16384]) {
            for (let longest = 1; longest < 20000; longest += 7) {
                const resolution = clampPictureResolution(64, longest, 1, max)
                expect(Math.ceil(longest * resolution)).toBeLessThanOrEqual(max)
            }
        }
    })

    it('reads a missing or nonsensical request as 1', () => {
        expect(clampPictureResolution(0, 320, 320, 8192)).toBe(1)
        expect(clampPictureResolution(-2, 320, 320, 8192)).toBe(1)
        expect(clampPictureResolution(Number.NaN, 320, 320, 8192)).toBe(1)
    })
})
