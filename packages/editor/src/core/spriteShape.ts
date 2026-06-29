import type {
    Sprite as SpriteData,
    SpriteVariations,
    Sprite4Way,
    AnimationVariations,
    Animation4Way,
    RotatedAnimation8Way,
    TurretBaseVisualisation,
} from 'factorio:prototype'
import util from '../common/util'

/**
 * Sprite-shape narrowing helpers.
 *
 * typed-factorio models several sprite types as `Base | Struct` unions. The
 * runtime data from data.json is always one concrete shape; these helpers
 * collapse the union to `SpriteData` using `in`-operator guards.
 *
 * No defensive null-handling: malformed data still throws and is caught +
 * logged by getSpriteData's try/catch in spriteDataBuilder.ts, which returns
 * SPRITE_GENERATION_FAILED. Silent empty returns would hide that diagnostic.
 */

/** `'layers' in x ? x.layers : [x]` */
export function layersOf(
    x: SpriteVariations | SpriteData | Animation4Way | RotatedAnimation8Way
): readonly SpriteData[] {
    return 'layers' in x ? (x.layers as readonly SpriteData[]) : [x as SpriteData]
}

/**
 * `'sheet' in x ? x.sheet : x` — collapse a *Variations/4Way union to the
 * single sheet sprite. Struct members (SpriteSheet) are structurally SpriteData
 * at runtime. Returns SpriteData (never undefined) so results feed straight
 * into duplicateAndSetPropertyUsing.
 */
export function sheetOf(x: SpriteVariations | Sprite4Way | AnimationVariations): SpriteData {
    return 'sheet' in x ? (x.sheet as unknown as SpriteData) : (x as unknown as SpriteData)
}

/** `'sheets' in x ? x.sheets : [x]` — Sprite4Way's multi-sheet form. */
export function sheetsOf(x: Sprite4Way): readonly SpriteData[] {
    return 'sheets' in x && x.sheets
        ? (x.sheets as unknown as readonly SpriteData[])
        : [x as SpriteData]
}

/**
 * Resolve a directional Animation4Way to its layers for `dir`. Uses
 * util.getDirName to pick the north/east/south/west key.
 */
export function fourWayAnimation(x: Animation4Way, dir: number): readonly SpriteData[] {
    const directional = x as unknown as Record<string, Animation4Way>
    return layersOf(directional[util.getDirName(dir)])
}

/**
 * Resolve a turret base_visualisation (array or object form) to its animation
 * layers. Pass `dir` for the directional (fluid-turret) animation form;
 * omit it for the flat (ammo/electric-turret) form.
 */
export function baseVisualisationLayers(
    bv: TurretBaseVisualisation | readonly TurretBaseVisualisation[],
    dir?: number
): readonly SpriteData[] {
    const base = Array.isArray(bv) ? bv[0] : (bv as TurretBaseVisualisation)
    const anim = base.animation
    return dir === undefined ? layersOf(anim) : fourWayAnimation(anim, dir)
}
