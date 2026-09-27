/*
    Factorio draws an icon tag inside a player-typed name - `[item=iron-plate]`,
    `[virtual-signal=signal-fuel]` - as the icon itself, in line with the text
    around it. Station names are where that matters: 35 of the 36 distinct
    station names in test-blueprints/ carry one, so a label that printed them
    raw would mostly be tag syntax.

    Only the tag types whose name is a prototype `F.CreateIcon` can look up are
    split out. `entity` is among them because an entity's item usually shares
    its name (`[item=train-stop]` and `[entity=train-stop]` draw the same icon);
    one that has no such item, `[entity=character]`, still fails the lookup and
    the caller falls back to the tag's own text. Anything after the name, such as
    `,quality=rare`, is dropped - the icon is drawn without its quality.
*/

export type RichTextRun =
    | { kind: 'text'; text: string }
    /** `source` is the whole tag as typed, for a caller that cannot draw `name`. */
    | { kind: 'icon'; name: string; source: string }

const ICON_TAG = /\[(?:item|fluid|recipe|virtual-signal|entity)=([^,\]]+)[^\]]*\]/g

/** Splits `text` into plain runs and icon tags, in order. Empty runs are omitted. */
export function splitRichTextIcons(text: string): RichTextRun[] {
    const runs: RichTextRun[] = []
    let last = 0
    for (const match of text.matchAll(ICON_TAG)) {
        if (match.index > last) runs.push({ kind: 'text', text: text.slice(last, match.index) })
        runs.push({ kind: 'icon', name: match[1], source: match[0] })
        last = match.index + match[0].length
    }
    if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) })
    return runs
}
