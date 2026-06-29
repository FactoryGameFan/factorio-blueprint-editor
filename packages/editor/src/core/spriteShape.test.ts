import { describe, it, expect } from 'vitest'
import { layersOf } from './spriteShape'

describe('layersOf', () => {
    it('returns the layers array when the value has a layers property', () => {
        const a = { filename: 'a.png' }
        const b = { filename: 'b.png' }
        const input = { layers: [a, b] }
        expect(layersOf(input as never)).toEqual([a, b])
    })

    it('wraps a bare sprite (no layers) into a single-element array', () => {
        const bare = { filename: 'c.png' }
        expect(layersOf(bare as never)).toEqual([bare])
    })
})
