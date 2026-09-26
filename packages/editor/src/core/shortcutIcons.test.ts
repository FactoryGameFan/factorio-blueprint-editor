import { describe, expect, it } from 'vite-plus/test'
import {
    IconShape,
    mirrorIcon,
    PathSegment,
    SHORTCUT_ICON_FRAME,
    ShortcutIconName,
    shortcutIcon,
} from './shortcutIcons'

/*
    The shortcut bar's vector icons (#505). The seven traced from the game are
    held to the opaque extent of the game's own x56 PNG, measured from
    `__base__/graphics/icons/shortcut-toolbar/mip/` in Factorio 2.0.77 as the
    box around every pixel with alpha above half, as [left, top, right,
    bottom]. The shapes were fitted by rendering them at 56 px and scoring
    them against those PNGs; this pins where each one sits, which is what a
    wrong coordinate would move.
*/
const GAME_EXTENTS: Partial<Record<ShortcutIconName, [number, number, number, number]>> = {
    'alt-mode': [4, 16, 52, 40],
    'import-string': [9, 11, 46, 44],
    undo: [9, 15, 46, 40],
    redo: [10, 15, 47, 40],
    'copper-wire': [8, 8, 48, 48],
    'red-wire': [10, 8, 46, 48],
    'green-wire': [8, 8, 48, 48],
}

const ALL: ShortcutIconName[] = [
    'alt-mode',
    'import-string',
    'export-string',
    'undo',
    'redo',
    'copper-wire',
    'red-wire',
    'green-wire',
    'export-image',
]

interface Sample {
    x: number
    y: number
    /** Unit normal, for a stroke to be widened along. */
    nx: number
    ny: number
}

/** Points along a path, one per unit of length or degree of arc. */
function samplePath(path: readonly PathSegment[]): Sample[] {
    const out: Sample[] = []
    let x = 0
    let y = 0
    const lineTo = (tx: number, ty: number) => {
        const len = Math.hypot(tx - x, ty - y)
        if (len > 0) {
            const nx = -(ty - y) / len
            const ny = (tx - x) / len
            for (let i = 0; i <= Math.ceil(len); i++) {
                const t = Math.min(1, i / len)
                out.push({ x: x + (tx - x) * t, y: y + (ty - y) * t, nx, ny })
            }
        }
        x = tx
        y = ty
    }
    for (const s of path) {
        switch (s.op) {
            case 'move':
                x = s.x
                y = s.y
                break
            case 'line':
                lineTo(s.x, s.y)
                break
            case 'arc': {
                const at = (deg: number) => {
                    const a = (deg * Math.PI) / 180
                    return { cos: Math.cos(a), sin: Math.sin(a) }
                }
                const start = at(s.from)
                lineTo(s.cx + s.r * start.cos, s.cy + s.r * start.sin)
                const steps = Math.ceil(Math.abs(s.to - s.from))
                for (let i = 0; i <= steps; i++) {
                    const p = at(s.from + ((s.to - s.from) * i) / steps)
                    x = s.cx + s.r * p.cos
                    y = s.cy + s.r * p.sin
                    out.push({ x, y, nx: p.cos, ny: p.sin })
                }
                break
            }
            case 'close':
                break
        }
    }
    return out
}

/** The box an icon covers, with each stroke widened along its normal. */
function extent(shapes: readonly IconShape[]): [number, number, number, number] {
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
    const add = (px: number, py: number) => {
        box[0] = Math.min(box[0], px)
        box[1] = Math.min(box[1], py)
        box[2] = Math.max(box[2], px)
        box[3] = Math.max(box[3], py)
    }
    for (const shape of shapes) {
        const half = shape.kind === 'stroke' ? shape.width / 2 : 0
        for (const p of samplePath(shape.path)) {
            add(p.x + p.nx * half, p.y + p.ny * half)
            add(p.x - p.nx * half, p.y - p.ny * half)
        }
    }
    return box
}

describe('shortcut icons', () => {
    it.each(ALL)('%s stays inside the 56-unit frame', name => {
        const shapes = shortcutIcon(name)
        expect(shapes.length).toBeGreaterThan(0)
        const [left, top, right, bottom] = extent(shapes)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeGreaterThanOrEqual(0)
        expect(right).toBeLessThanOrEqual(SHORTCUT_ICON_FRAME)
        expect(bottom).toBeLessThanOrEqual(SHORTCUT_ICON_FRAME)
    })

    it.each(Object.entries(GAME_EXTENTS))(
        "%s covers the game icon's extent to within a unit",
        (name, game) => {
            const box = extent(shortcutIcon(name as ShortcutIconName))
            for (const [i, side] of box.entries()) {
                expect(Math.abs(side - game[i])).toBeLessThanOrEqual(1)
            }
        }
    )

    it('draws every wire in its own colour over dark outlines', () => {
        const colors = (name: ShortcutIconName) =>
            new Set(shortcutIcon(name).map(shape => shape.color))
        expect(colors('copper-wire')).toEqual(new Set([0x1d1d1d, 0xce6131]))
        expect(colors('red-wire')).toEqual(new Set([0x1d1d1d, 0xe20000]))
        expect(colors('green-wire')).toEqual(new Set([0x1d1d1d, 0x208c00]))
    })

    it('draws the rest in the one dark ink, so the Alt highlight needs no tint', () => {
        for (const name of ALL.filter(n => !n.endsWith('-wire'))) {
            for (const shape of shortcutIcon(name)) expect(shape.color).toBe(0x1d1d1d)
        }
    })

    it('mirrors an icon back onto itself when applied twice', () => {
        for (const name of ALL) {
            const shapes = shortcutIcon(name)
            const twice = mirrorIcon(mirrorIcon(shapes))
            expect(extent(twice).map(v => v.toFixed(6))).toEqual(
                extent(shapes).map(v => v.toFixed(6))
            )
        }
    })

    it('mirrors undo into redo across the frame centre', () => {
        const [left, top, right, bottom] = extent(shortcutIcon('undo'))
        const redo = extent(shortcutIcon('redo'))
        expect(redo[0]).toBeCloseTo(SHORTCUT_ICON_FRAME - right)
        expect(redo[1]).toBeCloseTo(top)
        expect(redo[2]).toBeCloseTo(SHORTCUT_ICON_FRAME - left)
        expect(redo[3]).toBeCloseTo(bottom)
    })
})
