import { IPoint } from '../types'
import util from '../common/util'

/*
    The quality badge Factorio draws in alt mode, on an entity and on each of
    its module icons (#348). Normal quality draws nothing.

    Drawn as vectors rather than from the game's icon textures, which the data
    export does not carry. The style follows FactorioTools' QualitySelect
    badge - black-outlined pips in the quality's colour - but the layout is
    fitted to the game's own 64 px icons (`__quality__/graphics/icons/
    quality-*.png`, Factorio 2.0.77) rather than centred the way FactorioTools
    draws it. The game's glyph sits against the left and bottom of its frame,
    and the badge is placed by that frame's corner, so a centred glyph lands
    off by up to half a pip. Rasterised at 64 px and scored against the game
    icon, mean |dRGBA| over the pixels either one covers is 2.1 uncommon, 2.4
    rare, 2.4 epic and 3.2 legendary, out of 255.

    All pip coordinates are in a 24-unit frame, origin top-left.
*/

export const QUALITY_BADGE_FRAME = 24
/** Each pip is a circle of this radius stroked this wide: fill to 4.2, outline to 6.0. */
export const QUALITY_PIP_RADIUS = 5.1
export const QUALITY_PIP_STROKE = 1.8

type Pip = readonly [number, number]

export interface QualityBadgeStyle {
    color: number
    /** In draw order; a later pip's outline covers an earlier pip's fill. */
    pips: readonly Pip[]
}

const COL = [6.125, 16.25] as const
const ROW = [7.75, 17.875] as const

/*
    Colours match the game icons exactly. Legendary's four corner pips sit a
    little wider than epic's, measured from its opaque extent (0..22.5 by
    1.5..24), and its centre pip is drawn last, over them.
*/
const STYLES: Readonly<Record<string, QualityBadgeStyle>> = {
    uncommon: {
        color: 0x3eec57,
        pips: [
            [COL[0], ROW[0]],
            [COL[0], ROW[1]],
        ],
    },
    rare: {
        color: 0x2495ff,
        pips: [
            [COL[0], ROW[0]],
            [COL[0], ROW[1]],
            [COL[1], ROW[1]],
        ],
    },
    epic: {
        color: 0xc400ff,
        pips: [
            [COL[0], ROW[0]],
            [COL[1], ROW[0]],
            [COL[0], ROW[1]],
            [COL[1], ROW[1]],
        ],
    },
    legendary: {
        color: 0xff9500,
        pips: [
            [6, 7.5],
            [16.5, 7.5],
            [6, 18],
            [16.5, 18],
            [11.375, 12.625],
        ],
    },
}

/**
 * The badge for a quality, or undefined for normal, for no quality at all, and
 * for a name this editor does not know - a modded quality has no art here, and
 * drawing nothing is what an unknown name gets everywhere else in the overlay.
 */
export function qualityBadgeStyle(quality: string | undefined): QualityBadgeStyle | undefined {
    return quality === undefined ? undefined : STYLES[quality]
}

/**
 * An entity's badge size in tiles, from the smaller side of its tile footprint.
 *
 * Measured against Factorio 2.0.77 at 128 px per tile over 12 entities: 1/4 of a
 * tile for a smaller side of 1 (small-lamp, splitter), 1/3 for 2 (substation,
 * accumulator, big-electric-pole, stone-furnace, boiler) and 1/2 for 3 and up
 * (beacon, lab, electromagnetic-plant, foundry, rocket-silo, steam-engine). It is
 * the tile footprint and not the selection box: a stone furnace's selection box
 * is 1.594 wide, and its badge is the 2-tile size.
 */
export function entityBadgeSize(footprint: IPoint): number {
    const side = Math.min(footprint.x, footprint.y)
    if (side >= 3) return 1 / 2
    if (side >= 2) return 1 / 3
    return 1 / 4
}

/**
 * The badge frame's bottom-left corner, in tiles from the entity's centre: the
 * bottom-left of its selection box, rotated with the entity.
 *
 * Measured the same way, the frame corner sits on the selection box corner to
 * within 0.003 of a tile on every entity, and a boiler at all four cardinal
 * directions puts it on the rotated box. A diagonal direction was not measured,
 * so it keeps the unrotated box rather than guessing.
 */
export function entityBadgeCorner(
    selectionBox: readonly [readonly [number, number], readonly [number, number]],
    direction: number
): IPoint {
    const cardinal = direction % 4 === 0 ? direction % 16 : 0
    const a = util.rotatePointBasedOnDir(selectionBox[0], cardinal)
    const b = util.rotatePointBasedOnDir(selectionBox[1], cardinal)
    return { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }
}
