import { Container } from 'pixi.js'
import { Book, countNestedBlueprints } from '../core/Book'
import { IBlueprintBookEntry } from '../types'
import G from '../common/globals'
import F from './controls/functions'
import { Button } from './controls/Button'
import { Dialog } from './controls/Dialog'
import { ScrollArea } from './controls/ScrollArea'
import { layoutRichTextLine } from './controls/richTextLine'
import { styles } from './style'

const WIDTH = 320
const PADDING = 12
const ROW_HEIGHT = 24
const ICON_SIZE = 18
const INDENT = 14
const VP_X = PADDING
const VP_Y = 40
const VP_W = WIDTH - PADDING * 2
const VP_H = 320
const HEIGHT = VP_Y + VP_H + PADDING

/**
 * How many `blueprint_book`s deep to descend. A guard, not a real limit -
 * nothing seen in the wild nests anywhere close to this - so hitting it
 * shows one placeholder row rather than silently dropping the rest of the
 * tree, the same way a corrupt or hand-crafted string could.
 */
const MAX_DEPTH = 10

const ROW_LABEL_STYLE = styles.dialog.label

/**
 * What building the rows learns on the way, for the dialog to report once:
 * the distinct names of the icons that could not be drawn, in the order they
 * were met.
 */
interface RowBuild {
    failedIcons: Set<string>
}

/** The most failed icon names one warning lists, so a book of hundreds cannot
 * make a toast taller than the screen. */
const MAX_NAMED_FAILURES = 8

/** A book's own icon, or its first blueprint icon, or nothing - every one
 * of those is optional in the format, and a bad signal name in an icon
 * throws, which is worth losing one icon over rather than the whole dialog.
 * A failure is recorded in `build` rather than toasted: every row builds at
 * once, and a book with a few hundred planet icons would otherwise toast one
 * warning for each. */
function tryCreateIcon(
    name: string | undefined,
    size: number,
    build: RowBuild
): Container | undefined {
    if (name === undefined) return undefined
    return F.SafeIcon(
        name,
        () => F.CreateIcon(name, size),
        () => {
            build.failedIcons.add(name)
        }
    )
}

/** The one warning for every icon the rows could not draw, or undefined when
 * they all drew. */
function failedIconsWarning(names: ReadonlySet<string>): string | undefined {
    if (names.size === 0) return undefined
    const shown = [...names].slice(0, MAX_NAMED_FAILURES)
    const more = names.size - shown.length
    const noun = names.size === 1 ? 'icon' : 'icons'
    const list = shown.join(', ') + (more > 0 ? `, and ${more} more` : '')
    return `${names.size} ${noun} could not be drawn: ${list}`
}

/**
 * A row's label: `text` with its icon tags drawn as icons (see
 * `layoutRichTextLine`), vertically centred in the row from `x`. Labelled
 * `book-row-label` for the `bookRowRuns` test hook.
 *
 * Nothing shortens a long label. The viewport's mask clips it at the row's
 * right edge, as it did when the label was one plain Text, and an icon takes
 * the width of its tag.
 */
function createRowLabel(text: string, x: number): Container {
    const { row, lineHeight } = layoutRichTextLine(text, ROW_LABEL_STYLE, ICON_SIZE)
    row.label = 'book-row-label'
    row.position.set(x, (ROW_HEIGHT + lineHeight) / 2)
    return row
}

function firstIconName(
    icons: readonly { signal: { name?: string } }[] | undefined
): string | undefined {
    return icons?.[0]?.signal?.name
}

/** A non-interactive row - a nested-book header, a planner placeholder, or
 * the depth-limit notice - dimmed to read as informational rather than
 * clickable, since nothing here reacts to a pointer. */
function createStaticRow(
    text: string,
    x: number,
    y: number,
    build: RowBuild,
    iconName?: string
): Container {
    const row = new Container()
    row.position.set(x, y)
    row.alpha = 0.6

    const icon = tryCreateIcon(iconName, ICON_SIZE, build)
    let labelX = 0
    if (icon) {
        icon.position.set(ICON_SIZE / 2, ROW_HEIGHT / 2)
        row.addChild(icon)
        labelX = ICON_SIZE + 4
    }

    row.addChild(createRowLabel(text, labelX))

    return row
}

/** A clickable row for one selectable blueprint entry. */
function createBlueprintRow(
    label: string,
    iconName: string | undefined,
    x: number,
    y: number,
    width: number,
    active: boolean,
    onSelect: () => void,
    build: RowBuild
): Container {
    const button = new Button<undefined>(undefined, width, ROW_HEIGHT, 0)
    button.position.set(x, y)
    button.active = active

    const icon = tryCreateIcon(iconName, ICON_SIZE, build)
    let labelX = 4
    if (icon) {
        icon.position.set(4 + ICON_SIZE / 2, ROW_HEIGHT / 2)
        button.addChild(icon)
        labelX = 4 + ICON_SIZE + 4
    }

    button.addChild(createRowLabel(label, labelX))

    button.on('pointerdown', e => {
        if (e.button === 0) onSelect()
    })

    return button
}

/**
 * Walks a book's raw, still-nested entries and builds one row per entry in
 * document order - a nested book gets a header row followed by its own
 * children indented one level further, which is the whole of "drawing a
 * tree" here: nothing collapses, since a book rarely nests deep enough for
 * that to matter and an always-expanded list needs no expand/collapse state.
 *
 * `flatIndex` is threaded through the recursion rather than looked up
 * afterwards, incrementing on exactly the entries `Book`'s own flattened
 * index space counts - a `blueprint` counts, a `blueprint_book` recurses
 * without counting itself, and a planner is skipped - so a row's index
 * lines up with what `selectBookEntry` (and `activeIndex`) mean by it.
 */
function buildRows(
    entries: readonly IBlueprintBookEntry[],
    depth: number,
    flatIndex: { current: number },
    activeIndex: number,
    onSelect: (index: number) => void,
    rows: Container[],
    build: RowBuild
): void {
    for (const entry of entries) {
        const x = depth * INDENT
        const rowWidth = VP_W - depth * INDENT
        const y = rows.length * ROW_HEIGHT

        if (entry.blueprint) {
            const index = flatIndex.current
            flatIndex.current += 1
            rows.push(
                createBlueprintRow(
                    entry.blueprint.label || `Blueprint #${index}`,
                    firstIconName(entry.blueprint.icons),
                    x,
                    y,
                    rowWidth,
                    index === activeIndex,
                    () => onSelect(index),
                    build
                )
            )
        } else if (entry.blueprint_book) {
            rows.push(
                createStaticRow(
                    entry.blueprint_book.label || 'Blueprint Book',
                    x,
                    y,
                    build,
                    firstIconName(entry.blueprint_book.icons) ?? 'blueprint-book'
                )
            )

            if (depth >= MAX_DEPTH) {
                flatIndex.current += countNestedBlueprints(entry.blueprint_book.blueprints)
                rows.push(
                    createStaticRow(
                        'Nested further, not shown',
                        (depth + 1) * INDENT,
                        rows.length * ROW_HEIGHT,
                        build
                    )
                )
            } else {
                buildRows(
                    entry.blueprint_book.blueprints ?? [],
                    depth + 1,
                    flatIndex,
                    activeIndex,
                    onSelect,
                    rows,
                    build
                )
            }
        } else if (entry.upgrade_planner || entry.deconstruction_planner) {
            const label = entry.upgrade_planner ? 'Upgrade planner' : 'Deconstruction planner'
            rows.push(createStaticRow(label, x, y, build))
        } else {
            rows.push(createStaticRow('Unknown entry', x, y, build))
        }
    }
}

/**
 * Lists a loaded book's blueprints as a tree, matching the book's own
 * nesting - the settings pane's "BP Book Index" number field is the only
 * other way to switch entries, and it says nothing about what's at an
 * index or how deep it sits.
 */
export class BookDialog extends Dialog {
    public constructor(book: Book) {
        super(WIDTH, HEIGHT, 'Blueprint Book')

        // The track takes the right-hand margin, beside the rows rather than over them.
        const scrollArea = new ScrollArea({ width: VP_W, height: VP_H, trackX: VP_W })
        scrollArea.position.set(VP_X, VP_Y)
        this.addChild(scrollArea)

        const rows: Container[] = []
        const build: RowBuild = { failedIcons: new Set() }
        buildRows(
            book.entries,
            0,
            { current: 0 },
            book.activeIndex,
            index => {
                G.quickActions.selectBookEntry(index).catch((error: unknown) => {
                    G.logger({ text: String(error), type: 'error' })
                })
            },
            rows,
            build
        )

        /*
            One warning for the whole dialog, each time it opens: a reopened
            dialog builds its rows again and warns again, the same as any other
            fresh draw of a bad icon. Planet and quality icons have no data to
            draw from at all (#652), so a book that uses them warns on every
            open until that is fixed.
        */
        const warning = failedIconsWarning(build.failedIcons)
        if (warning !== undefined) G.logger({ text: warning, type: 'warning' })

        for (const row of rows) {
            scrollArea.content.addChild(row)
        }
        scrollArea.contentHeight = rows.length * ROW_HEIGHT
    }
}
