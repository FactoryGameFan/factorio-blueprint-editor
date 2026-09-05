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
 * layers. Pass a cardinal number or resolved animation key as `dir` for the
 * directional (fluid-turret) animation form, including 2.1 diagonal keys;
 * omit it for the flat (ammo/electric-turret) form.
 */
export function baseVisualisationLayers(
    bv: TurretBaseVisualisation | readonly TurretBaseVisualisation[],
    dir?: number | string
): readonly SpriteData[] {
    const base = Array.isArray(bv) ? bv[0] : (bv as TurretBaseVisualisation)
    const anim = base.animation
    return dir === undefined
        ? layersOf(anim)
        : dirLayers(anim, typeof dir === 'number' ? util.getDirName(dir) : dir)
}

/**
 * Index a directional sprite/animation struct (Sprite4Way, Animation4Way,
 * RotatedAnimation8Way, ...) by its resolved north/east/south/west key.
 * typed-factorio models these as `Struct | Single` unions whose Single member
 * has no directional keys, so the union can't be indexed by a direction name;
 * runtime data here is always the struct form. Returns the entry as SpriteData
 * (Sprite and Animation share the `.layers` shape callers read). Pass an
 * explicit `T` (e.g. `Animation`) when the caller needs a narrower entry type.
 */
export function dirEntry<T = SpriteData>(x: object, dirName: string): T {
    return (x as unknown as Record<string, T>)[dirName]
}

/**
 * The layers of a directional struct's entry for `dirName` - `dirEntry` followed
 * by `layersOf`, which is how nearly every caller uses it.
 *
 * `layers` is optional on Sprite and Animation because a direction entry is
 * allowed to be a bare sprite that is itself the only layer, which is what
 * layersOf handles. Every entry these callers reach does carry layers in the
 * current data.json; an entry missing for the direction entirely still throws,
 * the same as reading `.layers` off undefined did.
 */
export function dirLayers(x: object, dirName: string): readonly SpriteData[] {
    return layersOf(dirEntry(x, dirName))
}

/**
 * Coerce a SpriteVariations value to a SpriteData[] for array positions (e.g.
 * util.getRandomItem). At runtime variations are either an array of sprites or
 * a single sprite.
 */
export function toSpriteArray(x: SpriteVariations): readonly SpriteData[] {
    return Array.isArray(x) ? (x as readonly SpriteData[]) : [x as unknown as SpriteData]
}
