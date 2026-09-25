/*
    The overlay chrome drawn over the blueprint, as vectors (#509): the arrows
    alt-mode draws on splitters, combinators, drills and fluid connections, and
    the corner brackets of the hover, pair, copy, not-allowed and selection
    boxes. They were the game's own PNGs, which the editor stretches 3x at its
    closest zoom and softens.

    Traced from Factorio 2.0.77's `__core__/graphics/arrows/*.png`,
    `cursor-boxes.png` and `cursor-boxes-32x32.png`. Each shape was rasterised
    at the PNG's own size and fitted to it, pixel by pixel, then checked by
    eye at 8x beside the PNG - a good score alone passed arrows that were the
    wrong shape. Scored as the pixels drawn by one and not the other, then the
    mean channel difference over the pixels either covers, out of 255:

      indication arrow      6 px, 1.4
      fluid arrow           16 px, 3.4
      two-way fluid arrow   6 px, 6.9 (the game's outline there is thin and
                            partly faint, which a solid band overstates)
      cursor box corners    0-3 px and 1.7-9.4, except the pair's medium
                            corner at 12 px

    Pixels part way between the edge and core colours are left out of the
    pixel count, since either reading of one is fair.

    Each colour's corners are fitted on their own because the game's are not
    one shape recoloured: the not-allowed box's horizontal arm is a pixel
    thinner than the regular one's, for instance. And the arms of one corner
    are not always equally thick, hence `across` and `down`.

    This file holds only shape data, with no pixi code, so the shapes can be
    tested without a browser. `OverlayContainer` draws them. Coordinates are in
    the PNG's own pixels, origin top-left; angles are in degrees on screen
    axes, 0 pointing right and 90 down.
*/
import type { IconShape, PathSegment } from './shortcutIcons'

type Point = [number, number]
export type FillShape = Extract<IconShape, { kind: 'fill' }>

const move = (x: number, y: number): PathSegment => ({ op: 'move', x, y })
const line = (x: number, y: number): PathSegment => ({ op: 'line', x, y })
const close: PathSegment = { op: 'close' }

function arc(cx: number, cy: number, r: number, from: number, to: number): PathSegment {
    return { op: 'arc', cx, cy, r, from, to }
}

/** The polygon moved inward by `d` along every edge. Convex polygons only. */
export function insetPolygon(points: readonly Point[], d: number): Point[] {
    const n = points.length
    let area = 0
    for (let i = 0; i < n; i++) {
        const [x1, y1] = points[i]
        const [x2, y2] = points[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    }
    // On screen axes, y down, a positive area runs clockwise with the inside on its right.
    const side = area > 0 ? 1 : -1
    const edges = points.map((p, i) => {
        const q = points[(i + 1) % n]
        const len = Math.hypot(q[0] - p[0], q[1] - p[1])
        const nx = (-(q[1] - p[1]) / len) * side
        const ny = ((q[0] - p[0]) / len) * side
        return {
            p: [p[0] + nx * d, p[1] + ny * d] as Point,
            dir: [q[0] - p[0], q[1] - p[1]] as Point,
        }
    })
    // Each corner moves to where the two edges beside it meet once both have moved.
    return edges.map((e, i) => {
        const prev = edges[(i + n - 1) % n]
        const det = -prev.dir[0] * e.dir[1] + prev.dir[1] * e.dir[0]
        const rx = e.p[0] - prev.p[0]
        const ry = e.p[1] - prev.p[1]
        const s = (-rx * e.dir[1] + ry * e.dir[0]) / det
        return [prev.p[0] + s * prev.dir[0], prev.p[1] + s * prev.dir[1]]
    })
}

/** A closed path round the polygon, each corner rounded to its radius. */
export function roundedPolygon(points: readonly Point[], radii: readonly number[]): PathSegment[] {
    const n = points.length
    const corners = points.map((B, i) => {
        const r = radii[i]
        if (r <= 0) return { p1: B, p2: B, arc: undefined }
        const A = points[(i + n - 1) % n]
        const C = points[(i + 1) % n]
        const la = Math.hypot(A[0] - B[0], A[1] - B[1])
        const lc = Math.hypot(C[0] - B[0], C[1] - B[1])
        const u: Point = [(A[0] - B[0]) / la, (A[1] - B[1]) / la]
        const v: Point = [(C[0] - B[0]) / lc, (C[1] - B[1]) / lc]
        const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])))
        // The arc meets each edge this far from the corner.
        const t = r / Math.tan(theta / 2)
        const p1: Point = [B[0] + u[0] * t, B[1] + u[1] * t]
        const p2: Point = [B[0] + v[0] * t, B[1] + v[1] * t]
        const bisector = Math.hypot(u[0] + v[0], u[1] + v[1])
        const h = r / Math.sin(theta / 2)
        const cx = B[0] + ((u[0] + v[0]) / bisector) * h
        const cy = B[1] + ((u[1] + v[1]) / bisector) * h
        const from = (Math.atan2(p1[1] - cy, p1[0] - cx) * 180) / Math.PI
        let to = (Math.atan2(p2[1] - cy, p2[0] - cx) * 180) / Math.PI
        while (to - from > 180) to -= 360
        while (to - from < -180) to += 360
        return { p1, p2, arc: arc(cx, cy, r, from, to) }
    })
    const last = corners[n - 1]
    const path: PathSegment[] = [move(last.p2[0], last.p2[1])]
    for (const c of corners) {
        path.push(line(c.p1[0], c.p1[1]))
        if (c.arc) path.push(c.arc)
    }
    path.push(close)
    return path
}

export interface EdgeAndCore {
    /** The darker band round the outside. */
    edge: number
    /** The lighter colour filling the inside. */
    core: number
}

/** A rounded polygon in the edge colour, with a copy inset by `band` in the core colour. */
function banded(
    points: readonly Point[],
    radii: readonly number[],
    band: number,
    colors: EdgeAndCore
): FillShape[] {
    return [
        { kind: 'fill', color: colors.edge, path: roundedPolygon(points, radii) },
        {
            kind: 'fill',
            color: colors.core,
            path: roundedPolygon(
                insetPolygon(points, band),
                radii.map(r => Math.max(0, r - band))
            ),
        },
    ]
}

/*
    The arrows. Each is the game's outline: straight sides at about 45
    degrees, a slightly rounded tip, and a short upright wall at each end of
    the base. Fitted with the tip and corner radii held small, because an
    unconstrained fit rounded the tips into domes and bent the sides in -
    shapes that scored well at 48 px and read wrongly at 8x.

    All three are drawn at 200 of 255 alpha in the game, edge and core alike,
    so the shapes are solid and the sprite carries `OVERLAY_ARROW_ALPHA`.
*/
export const OVERLAY_ARROW_ALPHA = 200 / 255

const ORANGE_ARROW: EdgeAndCore = { edge: 0xff9900, core: 0xffff00 }
const BLUE_ARROW: EdgeAndCore = { edge: 0x0076e2, core: 0x00d4ff }

interface HouseArrow {
    /** The tip's x, and how far the base reaches either side of it. */
    cx: number
    halfWidth: number
    /** The tip, the top of the upright walls, and the base. */
    tipY: number
    wallY: number
    baseY: number
    band: number
    tipRadius: number
    baseRadius: number
}

/** An arrow pointing up. */
function houseArrow(a: HouseArrow, colors: EdgeAndCore): FillShape[] {
    const { cx, halfWidth, tipY, wallY, baseY } = a
    return banded(
        [
            [cx, tipY],
            [cx + halfWidth, wallY],
            [cx + halfWidth, baseY],
            [cx - halfWidth, baseY],
            [cx - halfWidth, wallY],
        ],
        [a.tipRadius, 0, a.baseRadius, a.baseRadius, 0],
        a.band,
        colors
    )
}

export const OVERLAY_ARROWS = {
    /** `indication_arrow`, 64 px: splitter priorities, combinators, drill outputs. */
    indication: {
        frame: 64,
        shapes: (): FillShape[] =>
            houseArrow(
                {
                    cx: 32,
                    halfWidth: 20.5,
                    tipY: 19.75,
                    wallY: 38,
                    baseY: 42.75,
                    band: 2,
                    tipRadius: 3,
                    baseRadius: 1.5,
                },
                ORANGE_ARROW
            ),
    },
    /** `fluid_indication_arrow`, 48 px: a one-way fluid connection. */
    fluid: {
        frame: 48,
        shapes: (): FillShape[] =>
            houseArrow(
                {
                    cx: 23.5,
                    halfWidth: 20,
                    tipY: 14,
                    wallY: 32,
                    baseY: 36.75,
                    band: 1.75,
                    tipRadius: 3,
                    baseRadius: 1,
                },
                BLUE_ARROW
            ),
    },
    /**
     * `fluid_indication_arrow_both_ways`, 48 px: an input-output connection.
     * A small arrow pointing up beside a triangle pointing down.
     */
    'fluid-both-ways': {
        frame: 48,
        shapes: (): FillShape[] => [
            ...houseArrow(
                {
                    cx: 17,
                    halfWidth: 10.25,
                    tipY: 19.25,
                    wallY: 27.5,
                    baseY: 30.75,
                    band: 1.5,
                    tipRadius: 1.5,
                    baseRadius: 1.5,
                },
                BLUE_ARROW
            ),
            ...banded(
                [
                    [19.25, 19.5],
                    [42.75, 19.5],
                    [31.25, 31],
                ],
                [1, 1, 1.75],
                1,
                BLUE_ARROW
            ),
        ],
    },
} as const

export type OverlayArrowName = keyof typeof OVERLAY_ARROWS

export function overlayArrow(name: OverlayArrowName): FillShape[] {
    return OVERLAY_ARROWS[name].shapes()
}

/*
    The cursor boxes. The game draws a box round anything larger than one tile
    as four corner pieces, one sprite rotated to each corner, and picks the
    piece by the entity's shorter side. A one-tile entity gets a whole box
    from `cursor-boxes-32x32.png` instead, which is the small corner mirrored
    into all four corners - measured, 0 to 2 pixels off on every colour.
*/

/** Both the corner pieces and the one-tile boxes are 64 px sprites. */
export const CURSOR_BOX_FRAME = 64

export type CornerSize = 'small' | 'medium' | 'large'

/**
 * The corner piece the game picks for an entity whose shorter side is `side`
 * tiles: the first of `cursor_box`'s pieces whose `max_side_length` is above
 * it, else the last. The pieces are 0.4, 0.7, 1.05, 3.5 and 4.0, and entity
 * sizes here are whole tiles, so the first two never come up.
 */
export function cornerSizeFor(side: number): CornerSize {
    if (side < 1.05) return 'small'
    if (side < 3.5) return 'medium'
    return 'large'
}

interface CornerFit {
    /** Thickness of the arm running right, and of the arm running down. */
    across: number
    down: number
    /** Width of the edge band along each side of an arm. */
    band: number
    /** Radius of the outside of the bend, and of the inside. */
    outer: number
    inner: number
}

/** How far each size's arms reach from the corner. */
const CORNER_LENGTH: Record<CornerSize, number> = { small: 20, medium: 32, large: 60 }

export type CursorBoxType = 'regular' | 'not_allowed' | 'pair' | 'copy' | 'multiplayer_selection'

interface CursorBoxStyle {
    colors: EdgeAndCore
    corners: Record<CornerSize, CornerFit>
    /**
     * Whose one-tile box it draws. Only `pair` differs: it takes
     * `make_full_cursor_box(192, 0)`, which is copy's green box, while its
     * corners are blue.
     */
    full: CursorBoxType
}

const fit = (
    across: number,
    down: number,
    band: number,
    outer: number,
    inner: number
): CornerFit => ({
    across,
    down,
    band,
    outer,
    inner,
})

export const CURSOR_BOX_TYPES: Record<CursorBoxType, CursorBoxStyle> = {
    regular: {
        colors: { edge: 0xff9900, core: 0xffff00 },
        corners: {
            small: fit(8, 8, 2.25, 13, 6.5),
            medium: fit(11.5, 11.5, 3.5, 14.75, 7.75),
            large: fit(13.5, 13, 3.25, 15.5, 7.5),
        },
        full: 'regular',
    },
    not_allowed: {
        colors: { edge: 0xff0023, core: 0xff5e00 },
        corners: {
            small: fit(9, 9, 2.25, 10.5, 4.75),
            medium: fit(11.5, 11.5, 3.75, 14.5, 7.5),
            large: fit(12.5, 13, 3.25, 14.25, 8),
        },
        full: 'not_allowed',
    },
    pair: {
        colors: { edge: 0x0076e2, core: 0x00d4ff },
        corners: {
            small: fit(9, 8.25, 1.75, 11.5, 6),
            medium: fit(11.5, 11.5, 3, 15, 8.75),
            large: fit(12.5, 13, 3.25, 14, 7.75),
        },
        full: 'copy',
    },
    copy: {
        colors: { edge: 0x007800, core: 0x00d400 },
        corners: {
            small: fit(9, 9, 1.75, 10, 3),
            medium: fit(11.25, 11.5, 3.25, 14, 7.75),
            large: fit(12.5, 13, 3.25, 14.5, 8),
        },
        full: 'copy',
    },
    multiplayer_selection: {
        colors: { edge: 0x646464, core: 0xffffff },
        corners: {
            small: fit(9, 9, 2.25, 9.75, 4.5),
            medium: fit(11.5, 11.75, 3, 15, 7),
            large: fit(13, 12.5, 3, 15, 8.75),
        },
        full: 'multiplayer_selection',
    },
}

/**
 * An L with its outside corner at (o, o) and its arms running right and down
 * to `length`, which the core shares, so the core runs out to the arm's end.
 */
function lShape(
    o: number,
    length: number,
    across: number,
    down: number,
    outer: number,
    inner: number
): PathSegment[] {
    const x = o + down
    const y = o + across
    const path: PathSegment[] = [move(length, o)]
    if (outer > 0) path.push(line(o + outer, o), arc(o + outer, o + outer, outer, 270, 180))
    else path.push(line(o, o))
    path.push(line(o, length), line(x, length))
    if (inner > 0) path.push(line(x, y + inner), arc(x + inner, y + inner, inner, 180, 270))
    else path.push(line(x, y))
    path.push(line(length, y), close)
    return path
}

/** The top-left corner piece; the caller rotates it into the other three corners. */
export function cursorBoxCorner(type: CursorBoxType, size: CornerSize): FillShape[] {
    const { colors, corners } = CURSOR_BOX_TYPES[type]
    const { across, down, band, outer, inner } = corners[size]
    const length = CORNER_LENGTH[size]
    return [
        { kind: 'fill', color: colors.edge, path: lShape(0, length, across, down, outer, inner) },
        {
            kind: 'fill',
            color: colors.core,
            path: lShape(
                band,
                length,
                across - 2 * band,
                down - 2 * band,
                Math.max(0, outer - band),
                inner + band
            ),
        },
    ]
}

/** The path reflected across the frame's vertical and/or horizontal centre line. */
function mirror(path: readonly PathSegment[], flipX: boolean, flipY: boolean): PathSegment[] {
    const X = (x: number): number => (flipX ? CURSOR_BOX_FRAME - x : x)
    const Y = (y: number): number => (flipY ? CURSOR_BOX_FRAME - y : y)
    const angle = (a: number): number => {
        let out = flipX ? 180 - a : a
        if (flipY) out = -out
        return out
    }
    return path.map(s => {
        switch (s.op) {
            case 'move':
            case 'line':
                return { ...s, x: X(s.x), y: Y(s.y) }
            case 'arc':
                return { ...s, cx: X(s.cx), cy: Y(s.cy), from: angle(s.from), to: angle(s.to) }
            case 'close':
                return s
        }
    })
}

/** The whole box round a one-tile entity: the small corner mirrored into each corner. */
export function cursorBoxFull(type: CursorBoxType): FillShape[] {
    const corner = cursorBoxCorner(CURSOR_BOX_TYPES[type].full, 'small')
    return (
        [
            [false, false],
            [true, false],
            [false, true],
            [true, true],
        ] as const
    ).flatMap(([fx, fy]) => corner.map(s => ({ ...s, path: mirror(s.path, fx, fy) })))
}
