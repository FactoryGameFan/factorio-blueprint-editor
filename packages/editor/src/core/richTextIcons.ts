import FD, { hasIcon, IconSource, recipeIconSource } from './factorioData'

/*
    Factorio draws an icon tag inside a player-typed name - `[item=iron-plate]`,
    `[virtual-signal=signal-fuel]` - as the icon itself, in line with the text
    around it. Station names are where that matters: 35 of the 36 distinct
    station names in test-blueprints/ carry one, so a label that printed them
    raw would mostly be tag syntax.

    Only the tag types naming a prototype data.json exports are split out, and
    each resolves in its own collection (`iconTagSource`): `[recipe=pentapod-egg]`
    draws the recipe's icon rather than the item's, and `[entity=straight-rail]`
    the rail entity's, although no item has that name. A name its collection
    lacks, `[entity=character]`, has no icon, and the caller falls back to the
    tag's own text. So do the tag types this does not split out at all -
    `color`, `font`, `gps`, `img`, `planet`, `space-location`, `quality` and the
    rest print as typed; data.json exports no planet, space-location or quality
    prototypes to draw them from. Anything after the name, such as
    `,quality=rare`, is dropped - the icon is drawn without its quality.
*/

export type IconTagType = 'item' | 'fluid' | 'recipe' | 'virtual-signal' | 'entity'

export type RichTextRun =
    | { kind: 'text'; text: string }
    /** `source` is the whole tag as typed, for a caller that cannot draw it. */
    | { kind: 'icon'; type: IconTagType; name: string; source: string }

const ICON_TAG = /\[(item|fluid|recipe|virtual-signal|entity)=([^,\]]+)[^\]]*\]/g

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
    const prototype =
        type === 'item'
            ? FD.items[name]
            : type === 'fluid'
              ? FD.fluids[name]
              : type === 'virtual-signal'
                ? FD.signals[name]
                : FD.entities[name]
    return hasIcon(prototype) ? prototype : undefined
}
