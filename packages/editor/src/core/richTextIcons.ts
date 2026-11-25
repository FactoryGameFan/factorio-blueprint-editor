import FD, { hasIcon, IconSource, recipeIconSource } from './factorioData'

/*
    Factorio draws an icon tag inside a player-typed name - `[item=iron-plate]`,
    `[virtual-signal=signal-fuel]` - as the icon itself, in line with the text
    around it. Station names are where that matters: 35 of the 36 distinct
    station names in test-blueprints/ carry one, so a label that printed them
    raw would mostly be tag syntax. The book dialog's row labels draw them the
    same way (UI/controls/richTextLine.ts).

    Only the tag types naming a prototype data.json exports are split out, and
    each resolves in its own collection (`iconTagSource`): `[recipe=pentapod-egg]`
    draws the recipe's icon rather than the item's, and `[entity=straight-rail]`
    the rail entity's, although no item has that name. `[planet=nauvis]` and
    `[space-location=solar-system-edge]` draw from `FD.spaceLocations` and
    `[quality=rare]` from `FD.qualities` (#652). A planet is a space location,
    so the `space-location` tag takes either; the `planet` tag takes only a
    planet. A name its collection lacks, `[entity=character]`, has no icon, and
    the caller falls back to the tag's own text. So do the tag types this does
    not split out at all - `color`, `font`, `gps`, `img` and the rest print as
    typed. Anything after the name, such as `,quality=rare`, is dropped - the
    icon is drawn without its quality.
*/

export type IconTagType =
    | 'item'
    | 'fluid'
    | 'recipe'
    | 'virtual-signal'
    | 'entity'
    | 'planet'
    | 'space-location'
    | 'quality'

export type RichTextRun =
    | { kind: 'text'; text: string }
    /** `source` is the whole tag as typed, for a caller that cannot draw it. */
    | { kind: 'icon'; type: IconTagType; name: string; source: string }

/*
    The name stops at `,`, `[` or `]`, and anything after it must start with a
    comma. The earlier `=([^,\]]+)[^\]]*\]` let the name and the tail split the
    same characters every possible way, and let `[` into both, so a label of
    repeated `[item=` with no `]` backtracked: 6,000 characters took 3.5 s and
    12,000 took 27 s, from a pasted blueprint or a share link. No prototype
    name holds a `,`, `[` or `]`, so every real tag matches as before.
*/
const ICON_TAG =
    /\[(item|fluid|recipe|virtual-signal|entity|planet|space-location|quality)=([^,[\]]+)(?:,[^[\]]*)?\]/g

/** Splits `text` into plain runs and icon tags, in order. Empty runs are omitted. */
export function splitRichTextIcons(text: string): RichTextRun[] {
    const runs: RichTextRun[] = []
    let last = 0
    for (const match of text.matchAll(ICON_TAG)) {
        if (match.index > last) runs.push({ kind: 'text', text: text.slice(last, match.index) })
        runs.push({
            kind: 'icon',
            type: match[1] as IconTagType,
            name: match[2],
            source: match[0],
        })
        last = match.index + match[0].length
    }
    if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) })
    return runs
}

/**
 * The prototype an icon tag's icon comes from, looked up only in the
 * collection its type names. Undefined when that collection has no such name,
 * or the prototype carries no icon.
 */
export function iconTagSource(type: IconTagType, name: string): IconSource | undefined {
    if (type === 'recipe') {
        const recipe = FD.recipes[name]
        return recipe === undefined ? undefined : recipeIconSource(recipe)
    }
    if (type === 'planet') {
        const planet = FD.spaceLocations[name]
        return planet?.type === 'planet' && hasIcon(planet) ? planet : undefined
    }
    const prototype =
        type === 'item'
            ? FD.items[name]
            : type === 'fluid'
              ? FD.fluids[name]
              : type === 'virtual-signal'
                ? FD.signals[name]
                : type === 'space-location'
                  ? FD.spaceLocations[name]
                  : type === 'quality'
                    ? FD.qualities[name]
                    : FD.entities[name]
    return hasIcon(prototype) ? prototype : undefined
}
