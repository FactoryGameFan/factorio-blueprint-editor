import { describe, it, expect } from 'vitest'
import { layersOf, sheetOf } from './spriteShape'

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

describe('sheetOf', () => {
    it('returns the sheet when the value is a struct with a sheet', () => {
        const sheet = { filename: 's.png', width: 1, height: 1 }
        expect(sheetOf({ sheet } as never)).toBe(sheet)
    })

    it('returns the value itself when it is a bare sheet/sprite', () => {
        const bare = { filename: 'bare.png', width: 1, height: 1 }
        expect(sheetOf(bare as never)).toBe(bare)
    })
})
