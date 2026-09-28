import type { RotatedSprite, Sprite as SpriteData } from 'factorio:prototype'

/**
 * How much shorter a north-south length looks than an east-west one in a
 * RotatedSprite's frames. The Factorio docs for `apply_projection` say the
 * frames are rendered with "the 45 degree angle for projection", which makes
 * this cos 45 degrees. Measured in the editor: the base cargo wagon's frame 32
 * of 256, an eighth of a turn, draws at 35.3 degrees above the horizontal, and
 * atan(cos 45) is 35.26.
 */
const PROJECTION = Math.SQRT1_2

/**
 * Where the frames put an orientation. The tile grid is drawn square, so an
 * entity at 0.125 lies along the 45 degree diagonal of the grid, but frame
 * 0.125 of the sheet lies at 35 degrees. `apply_projection`, which defaults to
 * true, is the game correcting for that: it picks the frame whose picture lies
 * along the grid direction. The four cardinals are unchanged.
 */
function projectOrientation(turns: number): number {
    const radians = turns * 2 * Math.PI
    const projected = Math.atan2(PROJECTION * Math.sin(radians), Math.cos(radians))
    return (projected / (2 * Math.PI) + 1) % 1
}

/**
 * The frame of a RotatedSprite layer that faces `orientation`, as a sprite
 * with `filename`, `x` and `y` pointing at that one cell.
 *
 * `orientation` is the game's: a fraction of a clockwise turn from north, so
 * 0.25 is east and 0.75 west. Frame 0 faces north and the frames go clockwise
 * unless the layer sets `counterclockwise`, which none in data.json do. With
 * `back_equals_front` the frames cover only half a turn, because a wagon
 * facing south looks the same as one facing north.
 *
 * The frames are laid out `line_length` to a row and `lines_per_file` rows to
 * a file, so frame f is in `filenames[floor(f / perFile)]`. For the base
 * locomotive that is 256 frames over 8 files of 4x8, so file k starts at
 * orientation k/8; a cargo wagon is 128 frames over 4 files covering half a
 * turn, so file k starts at k/8 too.
 *
 * Rounding to the nearest frame is an assumption. Nothing here was checked
 * against the game's own render.
 */
export function rotatedSpriteFrame(layer: RotatedSprite, orientation: number): SpriteData {
    const { direction_count, filenames, line_length, lines_per_file, width, height } = layer
    if (!direction_count || !filenames || !line_length || !lines_per_file) {
        throw new Error('rotatedSpriteFrame needs direction_count, filenames and a line grid')
    }
    if (!width || !height) throw new Error('rotatedSpriteFrame needs a frame width and height')

    const turns = ((orientation % 1) + 1) % 1
    const onSheet = layer.apply_projection === false ? turns : projectOrientation(turns)
    const span = layer.back_equals_front ? 0.5 : 1
    const clockwise = Math.round(((onSheet % span) / span) * direction_count) % direction_count
    const frame = layer.counterclockwise
        ? (direction_count - clockwise) % direction_count
        : clockwise

    const perFile = line_length * lines_per_file
    const cell = frame % perFile
    return {
        ...(layer as SpriteData),
        filename: filenames[Math.floor(frame / perFile)],
        x: (cell % line_length) * width,
        y: Math.floor(cell / line_length) * height,
    }
}
