import type {
    Sprite as SpriteData,
    SpriteVariations,
    Animation4Way,
    RotatedAnimation8Way,
} from 'factorio:prototype'

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
