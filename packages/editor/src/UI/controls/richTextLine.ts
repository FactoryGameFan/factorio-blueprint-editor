import { Container, Text, TextStyle } from 'pixi.js'
import { IconTagType, iconTagSource, splitRichTextIcons } from '../../core/richTextIcons'
import F from './functions'

/*
    One line of text with its icon tags drawn as icons, in line with the words
    around them (see core/richTextIcons.ts for which tags and why). Two things
    draw one: a train stop's name in the info overlay, and a blueprint's label in
    a row of the book dialog.

    A tag whose icon cannot be drawn - a colour, a name the
    data does not have - is printed as typed rather than dropped, so the label
    still says what its author wrote. It is never a warning: a label can hold
    dozens of them, and the author's text is not an error in the editor.
*/

/**
 * The icon an icon tag draws, from the collection its type names (see
 * `iconTagSource`), or undefined when there is none or it cannot be built.
 *
 * The drawn icon sits in a wrapper so it can keep a label of its own: the
 * file, or files joined with ` + `, it was drawn from, which the
 * `stationNameIconFiles` test hook reads. The run's `icon:<name>` says only
 * that some icon was drawn for the tag; the file says which prototype it came
 * from, and so whether `[recipe=pentapod-egg]` drew the recipe's icon or the
 * item's.
 */
function createIconTagIcon(type: IconTagType, name: string, size: number): Container | undefined {
    const source = iconTagSource(type, name)
    if (source === undefined) return undefined
    let drawn: Container
    try {
        drawn = F.CreateIconFrom(source, size)
    } catch {
        return undefined
    }
    drawn.label = source.icons ? source.icons.map(i => i.icon).join(' + ') : (source.icon ?? '')
    const icon = new Container()
    icon.addChild(drawn)
    return icon
}

/**
 * `text` laid out as one line. Its Texts take a copy of `style`, not `style`
 * itself: pixi's Text listens for changes on its style and never stops, so on
 * a shared style (the book dialog's) every row ever built would stay
 * subscribed for good. The copy's listeners go with the line.
 *
 * The container's origin is the line's left edge
 * at its bottom: text runs hang from `y = 0` upwards, and each icon is centred
 * half a line above it. Each icon is labelled `icon:<name>`, for the test
 * hooks. `width` and `lineHeight` are the line's measured size.
 */
export function layoutRichTextLine(
    text: string,
    style: TextStyle,
    iconSize: number
): { row: Container; width: number; lineHeight: number } {
    const own = style.clone()
    const lineHeight = new Text({ text: ' ', style: own }).height
    const row = new Container()
    let x = 0
    for (const run of splitRichTextIcons(text)) {
        if (run.kind === 'icon') {
            const icon = createIconTagIcon(run.type, run.name, iconSize)
            if (icon !== undefined) {
                icon.label = `icon:${run.name}`
                icon.position.set(x + iconSize / 2, -lineHeight / 2)
                row.addChild(icon)
                x += iconSize
                continue
            }
        }
        const part = new Text({ text: run.kind === 'text' ? run.text : run.source, style: own })
        part.anchor.set(0, 1)
        part.position.set(x, 0)
        row.addChild(part)
        x += part.width
    }
    return { row, width: x, lineHeight }
}
