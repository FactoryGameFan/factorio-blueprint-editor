import { describe, expect, it } from 'vite-plus/test'
import {
    CURSOR_BOX_FRAME,
    CURSOR_BOX_TYPES,
    CursorBoxType,
    OVERLAY_ARROWS,
    cornerSizeFor,
    cursorBoxCorner,
    cursorBoxFull,
    insetPolygon,
    overlayArrow,
    roundedPolygon,
} from './overlayShapes'
import { PathSegment } from './shortcutIcons'

/** Every point a path passes through, with arcs sampled every degree. */
function pointsOf(path: readonly PathSegment[]): [number, number][] {
    const out: [number, number][] = []
    for (const s of path) {
        if (s.op === 'move' || s.op === 'line') out.push([s.x, s.y])
        else if (s.op === 'arc') {
            const steps = Math.ceil(Math.abs(s.to - s.from))
            for (let i = 0; i <= steps; i++) {
                const a = ((s.from + ((s.to - s.from) * i) / steps) * Math.PI) / 180
                out.push([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)])
            }
        }
    }
    return out
}

function bounds(paths: readonly (readonly PathSegment[])[]): [number, number, number, number] {
    const all = paths.flatMap(pointsOf)
    const xs = all.map(p => p[0])
    const ys = all.map(p => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

const TYPES = Object.keys(CURSOR_BOX_TYPES) as CursorBoxType[]

describe('cornerSizeFor', () => {
    /*
        The game's rule, from `cursor_box` in core/prototypes/utility-sprites.lua:
        the first piece whose max_side_length is above the entity's shorter side,
        or the last. The pieces are 0.4, 0.7, 1.05, 3.5 and 4.0; entity sizes
        are whole tiles, so the first two are never picked.
    */
    it('picks the piece the game picks for each whole-tile side', () => {
        expect(cornerSizeFor(1)).toBe('small')
        expect(cornerSizeFor(2)).toBe('medium')
        expect(cornerSizeFor(3)).toBe('medium')
        expect(cornerSizeFor(4)).toBe('large')
        expect(cornerSizeFor(12)).toBe('large')
    })
})

describe('cursor box colours', () => {
    it('are the edge and core colours read off cursor-boxes.png', () => {
        expect(CURSOR_BOX_TYPES.regular.colors).toEqual({ edge: 0xff9900, core: 0xffff00 })
        expect(CURSOR_BOX_TYPES.not_allowed.colors).toEqual({ edge: 0xff0023, core: 0xff5e00 })
        expect(CURSOR_BOX_TYPES.pair.colors).toEqual({ edge: 0x0076e2, core: 0x00d4ff })
        expect(CURSOR_BOX_TYPES.copy.colors).toEqual({ edge: 0x007800, core: 0x00d400 })
        expect(CURSOR_BOX_TYPES.multiplayer_selection.colors).toEqual({
            edge: 0x646464,
            core: 0xffffff,
        })
    })

    // `pair` takes make_full_cursor_box(192, 0), which is copy's green box.
    it("draws the pair's one-tile box in copy's green, as the game data does", () => {
        const pair = cursorBoxFull('pair')
        const copy = cursorBoxFull('copy')
        expect(pair.map(s => s.color)).toEqual(copy.map(s => s.color))
        expect(pair.map(s => s.path)).toEqual(copy.map(s => s.path))
    })
})

describe('cursor box corners', () => {
    it.each(TYPES)(
        '%s: every size is an L in the frame corner, its arms the fitted length',
        type => {
            for (const [size, length] of [
                ['small', 20],
                ['medium', 32],
                ['large', 60],
            ] as const) {
                const shapes = cursorBoxCorner(type, size)
                expect(shapes.map(s => s.color)).toEqual([
                    CURSOR_BOX_TYPES[type].colors.edge,
                    CURSOR_BOX_TYPES[type].colors.core,
                ])
                const [x0, y0, x1, y1] = bounds(shapes.map(s => s.path))
                expect([x0, y0]).toEqual([0, 0])
                expect(x1).toBeCloseTo(length)
                expect(y1).toBeCloseTo(length)
                // The core sits inside the edge band.
                const [cx0, cy0] = bounds([shapes[1].path])
                expect(cx0).toBeGreaterThan(0)
                expect(cy0).toBeGreaterThan(0)
            }
        }
    )

    it.each(TYPES)('%s: the one-tile box has a corner at each corner of the frame', type => {
        const shapes = cursorBoxFull(type)
        expect(shapes).toHaveLength(8)
        const [x0, y0, x1, y1] = bounds(shapes.map(s => s.path))
        expect([x0, y0]).toEqual([0, 0])
        expect(x1).toBeCloseTo(CURSOR_BOX_FRAME)
        expect(y1).toBeCloseTo(CURSOR_BOX_FRAME)
        // Four mirrored copies of the small corner, so the same area each.
        const quarters = [0, 2, 4, 6].map(i => bounds([shapes[i].path]))
        const sizes = quarters.map(([a, b, c, d]) => [+(c - a).toFixed(6), +(d - b).toFixed(6)])
        expect(new Set(sizes.map(s => s.join()))).toHaveProperty('size', 1)
    })
})

describe('overlay arrows', () => {
    it.each(Object.keys(OVERLAY_ARROWS) as (keyof typeof OVERLAY_ARROWS)[])(
        '%s stays inside its frame and draws an edge under a core',
        name => {
            const { frame } = OVERLAY_ARROWS[name]
            const shapes = overlayArrow(name)
            expect(shapes.length % 2).toBe(0)
            const [x0, y0, x1, y1] = bounds(shapes.map(s => s.path))
            // The widest arrow's base corners round off inside a frame edge.
            expect(x0).toBeGreaterThanOrEqual(-0.5)
            expect(y0).toBeGreaterThanOrEqual(0)
            expect(x1).toBeLessThanOrEqual(frame + 0.5)
            expect(y1).toBeLessThanOrEqual(frame)
        }
    )

    it('points each single arrow up, with its tip at the top', () => {
        for (const name of ['indication', 'fluid'] as const) {
            const [edge] = overlayArrow(name)
            const points = pointsOf(edge.path)
            const top = points.reduce((a, b) => (b[1] < a[1] ? b : a))
            const [x0, , x1] = bounds([edge.path])
            expect(Math.abs(top[0] - (x0 + x1) / 2)).toBeLessThan(2)
        }
    })
})

describe('polygon helpers', () => {
    it('insets a square by the same distance on every side, whichever way it runs', () => {
        const square: [number, number][] = [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ]
        const expected = [
            [2, 2],
            [8, 2],
            [8, 8],
            [2, 8],
        ]
        const round = (ps: [number, number][]) => ps.map(p => p.map(v => +v.toFixed(9)))
        expect(round(insetPolygon(square, 2))).toEqual(expected)
        expect(round(insetPolygon([...square].reverse(), 2))).toEqual([...expected].reverse())
    })

    it('rounds a corner with an arc that meets both edges', () => {
        const path = roundedPolygon(
            [
                [0, 0],
                [10, 0],
                [10, 10],
            ],
            [0, 3, 0]
        )
        const arc = path.find(s => s.op === 'arc')
        if (arc?.op !== 'arc') throw new Error('no arc')
        const at = (deg: number) => [
            +(arc.cx + arc.r * Math.cos((deg * Math.PI) / 180)).toFixed(9),
            +(arc.cy + arc.r * Math.sin((deg * Math.PI) / 180)).toFixed(9),
        ]
        // Tangent to the top edge (y = 0) and the right edge (x = 10).
        expect(at(arc.from)).toEqual([7, 0])
        expect(at(arc.to)).toEqual([10, 3])
    })
})
