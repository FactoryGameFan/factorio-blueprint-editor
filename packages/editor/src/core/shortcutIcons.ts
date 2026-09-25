/*
    The shortcut bar's nine icons, as vectors (#505).

    Seven are traced from Factorio 2.0.77's own shortcut art,
    `__base__/graphics/icons/shortcut-toolbar/mip/*-x56.png`, which the data
    export does not carry. Export and export image have no shortcut in the
    game, so they are drawn in the same style: the import box mirrored with
    an arrow leaving it, and a picture frame.

    Rasterised at 56 px and scored against the game icon, both laid over the
    game's button grey, the mean channel difference over the pixels either
    one covers is 1.9 alt, 5.2 import, 5.9 undo and redo, 0.9 copper wire,
    3.6 red wire and 3.0 green wire, out of 255.

    This file holds only shape data, with no pixi code, so the shapes can be
    tested without a browser. `ShortcutBar` draws them.

    All coordinates are in a 56-unit frame, origin top-left, the same frame as
    the game's 56 px icons. Angles are in degrees on screen axes: 0 points
    right and 90 points down.
*/

export const SHORTCUT_ICON_FRAME = 56

/** The game's icon colours, read off the PNGs. */
export const SHORTCUT_COLORS = {
    dark: 0x1d1d1d,
    copper: 0xce6131,
    red: 0xe20000,
    green: 0x208c00,
} as const

export type PathSegment =
    | { op: 'move'; x: number; y: number }
    | { op: 'line'; x: number; y: number }
    /** Runs clockwise on screen when `to` is larger than `from`, and back when it is smaller. */
    | { op: 'arc'; cx: number; cy: number; r: number; from: number; to: number }
    | { op: 'close' }

export type IconShape =
    | {
          kind: 'fill'
          color: number
          path: readonly PathSegment[]
          /** Cut out of this fill, one path per hole. */
          holes?: readonly (readonly PathSegment[])[]
      }
    | { kind: 'stroke'; color: number; width: number; path: readonly PathSegment[] }

export type ShortcutIconName =
    | 'alt-mode'
    | 'import-string'
    | 'export-string'
    | 'undo'
    | 'redo'
    | 'copper-wire'
    | 'red-wire'
    | 'green-wire'
    | 'export-image'

const move = (x: number, y: number): PathSegment => ({ op: 'move', x, y })
const line = (x: number, y: number): PathSegment => ({ op: 'line', x, y })
const close: PathSegment = { op: 'close' }

function arc(cx: number, cy: number, r: number, from: number, to: number): PathSegment {
    return { op: 'arc', cx, cy, r, from, to }
}

/** Where an arc starts, so a path can move there before drawing it. */
function arcStart(cx: number, cy: number, r: number, angle: number): PathSegment {
    const a = (angle * Math.PI) / 180
    return move(cx + r * Math.cos(a), cy + r * Math.sin(a))
}

function poly(...points: [number, number][]): PathSegment[] {
    const [first, ...rest] = points
    return [move(...first), ...rest.map(p => line(...p)), close]
}

function rect(x: number, y: number, w: number, h: number): PathSegment[] {
    return poly([x, y], [x + w, y], [x + w, y + h], [x, y + h])
}

function roundRect(x: number, y: number, w: number, h: number, r: number): PathSegment[] {
    return [
        move(x + r, y),
        line(x + w - r, y),
        arc(x + w - r, y + r, r, 270, 360),
        line(x + w, y + h - r),
        arc(x + w - r, y + h - r, r, 0, 90),
        line(x + r, y + h),
        arc(x + r, y + h - r, r, 90, 180),
        line(x, y + r),
        arc(x + r, y + r, r, 180, 270),
        close,
    ]
}

function circle(cx: number, cy: number, r: number): PathSegment[] {
    return [arcStart(cx, cy, r, 0), arc(cx, cy, r, 0, 360), close]
}

const fill = (path: PathSegment[], holes?: PathSegment[][]): IconShape => ({
    kind: 'fill',
    color: SHORTCUT_COLORS.dark,
    path,
    holes,
})

/*
    A wire is a coloured core 4 wide inside a dark outline 12 wide, and the
    outline runs 4 past each end of the core. Each piece draws its outline and
    then its core, in order, so a later piece's outline covers an earlier
    piece's core where they cross. That is how the game's art shows one strand
    passing under another.
*/
function wirePiece(color: number, core: PathSegment[], outline: PathSegment[]): IconShape[] {
    return [
        { kind: 'stroke', color: SHORTCUT_COLORS.dark, width: 12, path: outline },
        { kind: 'stroke', color, width: 4, path: core },
    ]
}

/** Mirrors an icon left to right. */
export function mirrorIcon(shapes: readonly IconShape[]): IconShape[] {
    const flip = (path: readonly PathSegment[]): PathSegment[] =>
        path.map(s => {
            switch (s.op) {
                case 'move':
                case 'line':
                    return { ...s, x: SHORTCUT_ICON_FRAME - s.x }
                case 'arc':
                    return {
                        ...s,
                        cx: SHORTCUT_ICON_FRAME - s.cx,
                        from: 180 - s.from,
                        to: 180 - s.to,
                    }
                case 'close':
                    return s
            }
        })
    return shapes.map(shape =>
        shape.kind === 'fill'
            ? { ...shape, path: flip(shape.path), holes: shape.holes?.map(flip) }
            : { ...shape, path: flip(shape.path) }
    )
}

/*
    The box the import arrow drops into: corner and side dashes 4 thick,
    8 long, with 4-unit gaps. The top-left corner and the top middle are
    left out, which is where the arrow comes in.
*/
const IMPORT_BOX = [
    rect(38, 12, 8, 4),
    rect(42, 16, 4, 4),
    rect(42, 24, 4, 8),
    rect(14, 24, 4, 8),
    rect(14, 36, 4, 8),
    rect(18, 40, 4, 4),
    rect(26, 40, 8, 4),
    rect(38, 40, 8, 4),
    rect(42, 36, 4, 4),
].flat()

/*
    The import arrow's shaft: a crescent between two circles, thin at the
    tail and 6 wide where it meets the head.
*/
const IMPORT_SHAFT = [
    arcStart(21, 24, 13, 195),
    arc(21, 24, 13, 195, 360),
    line(27, 24.5),
    arc(18.5, 24.5, 8.5, 0, -170),
    close,
]
const IMPORT_HEAD = poly([23, 23], [37, 23], [37, 25], [30, 32], [23, 25])

/*
    The undo arrow: a half ring, its arrowhead on the left end, and a dot
    under the right end. Redo is the same icon mirrored, as in the game.
*/
const UNDO: IconShape[] = [
    {
        kind: 'stroke',
        color: SHORTCUT_COLORS.dark,
        width: 6.5,
        path: [arcStart(30, 31, 12.75, 180), arc(30, 31, 12.75, 180, 360)],
    },
    fill(poly([9, 31], [25, 31], [25, 32.5], [17, 40.5], [9, 32.5])),
    fill(circle(43, 37, 3)),
]

/*
    Export has no shortcut in the game. It is the import box mirrored, with an
    arrow that starts inside it and leaves through the open top-right corner.
    The arrowhead is the import head's size, turned to point right.
*/
const EXPORT_STRING: IconShape[] = [
    fill(
        [
            rect(10, 12, 8, 4),
            rect(10, 16, 4, 4),
            rect(22, 12, 8, 4),
            rect(10, 24, 4, 8),
            rect(10, 36, 4, 8),
            rect(14, 40, 4, 4),
            rect(22, 40, 8, 4),
            rect(34, 40, 8, 4),
            rect(38, 36, 4, 4),
        ].flat()
    ),
    {
        kind: 'stroke',
        color: SHORTCUT_COLORS.dark,
        width: 6,
        path: [arcStart(38, 33, 12, 180), arc(38, 33, 12, 180, 270)],
    },
    fill(poly([38, 14], [46, 21], [38, 28])),
]

/*
    Export image has no shortcut either. A picture frame with a hill and a
    sun, in the same dark ink and 4-unit line as the others.
*/
const EXPORT_IMAGE: IconShape[] = [
    fill(roundRect(8, 12, 40, 32, 3), [rect(12, 16, 32, 24)]),
    fill(poly([12, 40], [23, 27], [31, 35], [35, 31], [44, 40])),
    fill(circle(35, 22, 4)),
]

const ICONS: Readonly<Record<ShortcutIconName, readonly IconShape[]>> = {
    'alt-mode': [
        /*
            A bar with ALT cut out of it, the letters on a 4-unit grid. The
            hole in the A is filled back in afterwards, because a hole cannot
            have a hole of its own.
        */
        fill(roundRect(4, 16, 48, 24, 2), [
            poly([8, 20], [20, 20], [20, 36], [16, 36], [16, 32], [12, 32], [12, 36], [8, 36]),
            poly([24, 20], [28, 20], [28, 32], [36, 32], [36, 36], [24, 36]),
            poly([36, 20], [48, 20], [48, 24], [44, 24], [44, 36], [40, 36], [40, 24], [36, 24]),
        ]),
        fill(rect(12, 24, 4, 4)),
    ],
    'import-string': [fill(IMPORT_BOX), fill(IMPORT_SHAFT), fill(IMPORT_HEAD)],
    'export-string': EXPORT_STRING,
    undo: UNDO,
    redo: mirrorIcon(UNDO),
    'copper-wire': [
        ...wirePiece(
            SHORTCUT_COLORS.copper,
            [move(14, 12), line(14, 32)],
            [move(14, 8), line(14, 32)]
        ),
        ...wirePiece(SHORTCUT_COLORS.copper, circle(24, 32, 10), circle(24, 32, 10)),
        ...wirePiece(
            SHORTCUT_COLORS.copper,
            [move(24, 42), line(44, 42)],
            [move(24, 42), line(48, 42)]
        ),
    ],
    'red-wire': [
        ...wirePiece(
            SHORTCUT_COLORS.red,
            [move(22, 34), line(26, 34), arc(26, 24, 10, 90, -180), line(16, 40)],
            [move(18, 34), line(26, 34), arc(26, 24, 10, 90, -180), line(16, 44)]
        ),
        fill(rect(14, 44, 4, 4)),
        ...wirePiece(
            SHORTCUT_COLORS.red,
            [arcStart(38, 30, 12, 140), arc(38, 30, 12, 140, 90)],
            [arcStart(38, 30, 12, 155), arc(38, 30, 12, 155, 90), line(42, 42)]
        ),
        fill(rect(42, 40, 4, 4)),
    ],
    'green-wire': [
        ...wirePiece(
            SHORTCUT_COLORS.green,
            [move(42, 16), line(40, 26)],
            [move(42, 12), line(40, 26)]
        ),
        fill(rect(40, 8, 4, 4)),
        ...wirePiece(SHORTCUT_COLORS.green, circle(24, 24, 10), circle(24, 24, 10)),
        ...wirePiece(
            SHORTCUT_COLORS.green,
            [move(34, 24), line(34, 32), arc(24, 32, 10, 0, 90), line(16, 42)],
            [move(34, 24), line(34, 32), arc(24, 32, 10, 0, 90), line(12, 42)]
        ),
        fill(rect(8, 40, 4, 4)),
    ],
    'export-image': EXPORT_IMAGE,
}

export function shortcutIcon(name: ShortcutIconName): readonly IconShape[] {
    return ICONS[name]
}
