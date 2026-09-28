import { describe, expect, it } from 'vite-plus/test'
import type { RotatedSprite } from 'factorio:prototype'
import { rotatedSpriteFrame } from './rotatedSprite'

/*
    The two sheet layouts rolling stock uses, with the grid fields copied from
    data.json's base `locomotive` and `cargo-wagon` body layers. Every rolling
    stock layer in data.json is one of these two: 256 frames over 8 files, or
    128 frames over 4 files with `back_equals_front`. Frame f sits in file
    floor(f / 32), column f % 4 and row floor((f % 32) / 4).
*/
const LOCOMOTIVE: RotatedSprite = {
    direction_count: 256,
    line_length: 4,
    lines_per_file: 8,
    width: 474,
    height: 458,
    filenames: [1, 2, 3, 4, 5, 6, 7, 8].map(n => `locomotive-${n}.png`),
}
const CARGO_WAGON: RotatedSprite = {
    direction_count: 128,
    line_length: 4,
    lines_per_file: 8,
    back_equals_front: true,
    width: 442,
    height: 408,
    filenames: [1, 2, 3, 4].map(n => `cargo-wagon-${n}.png`),
}

const cell = (layer: RotatedSprite, orientation: number) => {
    const { filename, x, y } = rotatedSpriteFrame(layer, orientation)
    return { filename, x, y }
}

describe('rotatedSpriteFrame', () => {
    it('puts the four cardinals at the start of every other locomotive file', () => {
        // Frames 0, 64, 128 and 192: the first cell of files 1, 3, 5 and 7. The
        // old draw took filenames[direction / 4], files 1 to 4, which is north,
        // north-east, east and south-east.
        expect(cell(LOCOMOTIVE, 0)).toEqual({ filename: 'locomotive-1.png', x: 0, y: 0 })
        expect(cell(LOCOMOTIVE, 0.25)).toEqual({ filename: 'locomotive-3.png', x: 0, y: 0 })
        expect(cell(LOCOMOTIVE, 0.5)).toEqual({ filename: 'locomotive-5.png', x: 0, y: 0 })
        expect(cell(LOCOMOTIVE, 0.75)).toEqual({ filename: 'locomotive-7.png', x: 0, y: 0 })
    })

    it('draws a wagon facing south with the frame it uses facing north', () => {
        // Half a turn over 128 frames, so east and west are both frame 64.
        expect(cell(CARGO_WAGON, 0.5)).toEqual(cell(CARGO_WAGON, 0))
        expect(cell(CARGO_WAGON, 0.75)).toEqual(cell(CARGO_WAGON, 0.25))
        expect(cell(CARGO_WAGON, 0.25)).toEqual({ filename: 'cargo-wagon-3.png', x: 0, y: 0 })
    })

    it('projects a diagonal onto the frame that lies along the grid diagonal', () => {
        // atan(cos 45 * tan 45) = 35.26 degrees, frame 25.07 of 256: file 1,
        // column 1, row 6. Frame 32 is the one that draws 35 degrees flat.
        expect(cell(LOCOMOTIVE, 0.125)).toEqual({
            filename: 'locomotive-1.png',
            x: 474,
            y: 6 * 458,
        })
        expect(cell({ ...LOCOMOTIVE, apply_projection: false }, 0.125)).toEqual({
            filename: 'locomotive-2.png',
            x: 0,
            y: 0,
        })
    })

    it('wraps orientations outside [0, 1)', () => {
        expect(cell(LOCOMOTIVE, -0.25)).toEqual(cell(LOCOMOTIVE, 0.75))
        expect(cell(LOCOMOTIVE, 1.25)).toEqual(cell(LOCOMOTIVE, 0.25))
        // Just short of a whole turn rounds to north, not to a frame 256.
        expect(cell(LOCOMOTIVE, 0.999)).toEqual(cell(LOCOMOTIVE, 0))
    })

    it('reverses the frame order for a counterclockwise sheet', () => {
        expect(cell({ ...LOCOMOTIVE, counterclockwise: true }, 0.25)).toEqual(
            cell(LOCOMOTIVE, 0.75)
        )
    })
})
