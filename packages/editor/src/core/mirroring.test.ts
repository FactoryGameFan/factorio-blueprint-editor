import { describe, expect, it } from 'vite-plus/test'
import { IPoint } from '../types'
import { mirrorDirection, mirrorPoint } from './mirroring'

/*
    The rule in mirroring.ts. tests/mirroring-oracle.test.ts checks it against
    every case the game measured.
*/

const key = (p: IPoint): string => `${p.x + 0},${p.y + 0}`

describe('mirrorPoint', () => {
    it('negates x facing north or south and y facing east or west', () => {
        expect(mirrorPoint({ x: 1, y: -2 }, 0)).toEqual({ x: -1, y: -2 })
        expect(mirrorPoint({ x: 1, y: -2 }, 8)).toEqual({ x: -1, y: -2 })
        expect(mirrorPoint({ x: 1, y: -2 }, 4)).toEqual({ x: 1, y: 2 })
        expect(mirrorPoint({ x: 1, y: -2 }, 12)).toEqual({ x: 1, y: 2 })
    })

    it('reflects across the diagonal a diagonal facing points along', () => {
        expect(mirrorPoint({ x: 1, y: 0 }, 2)).toEqual({ x: -0, y: -1 })
        expect(mirrorPoint({ x: 1, y: 0 }, 6)).toEqual({ x: 0, y: 1 })
    })

    it('is its own inverse', () => {
        for (const dir of [0, 2, 4, 6, 8, 10, 12, 14]) {
            const p = { x: 1.5, y: -0.5 }
            expect(key(mirrorPoint(mirrorPoint(p, dir), dir))).toBe(key(p))
        }
    })
})

describe('mirrorDirection', () => {
    it('swaps east and west facing north, and north and south facing east', () => {
        expect([0, 4, 8, 12].map(d => mirrorDirection(d, 0))).toEqual([0, 12, 8, 4])
        expect([0, 4, 8, 12].map(d => mirrorDirection(d, 4))).toEqual([8, 4, 0, 12])
    })
})
