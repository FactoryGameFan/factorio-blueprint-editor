import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import { Book } from '../core/Book'
import { IBlueprintBookEntry } from '../types'
import G from '../common/globals'
import F from './controls/functions'
import { Button } from './controls/Button'
import { Dialog } from './controls/Dialog'
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
const ACTIVE_ROW_COLOR = 0xb16925

/** A book's own icon, or its first blueprint icon, or nothing - every one
 * of those is optional in the format, and a bad signal name in an icon
 * throws, which is worth losing one icon over rather than the whole dialog. */
function tryCreateIcon(name: string | undefined, size: number): Container | undefined {
    if (name === undefined) return undefined
    try {
        // setAnchor stays at its default (true/centered) - every call site
        // positions the icon by its centre, matching createConditionDisplay's
        // own usage of CreateIcon.
        return F.CreateIcon(name, size)
    } catch {
        return undefined
    }
}

function firstIconName(
    icons: readonly { signal: { name?: string } }[] | undefined
): string | undefined {
    return icons?.[0]?.signal.name
}

/** A non-interactive row - a nested-book header, a planner placeholder, or
 * the depth-limit notice - dimmed to read as informational rather than
 * clickable, since nothing here reacts to a pointer. */
function createStaticRow(text: string, x: number, y: number, iconName?: string): Container {
    const row = new Container()
    row.position.set(x, y)
    row.alpha = 0.6

    const icon = tryCreateIcon(iconName, ICON_SIZE)
    let labelX = 0
    if (icon) {
        icon.position.set(ICON_SIZE / 2, ROW_HEIGHT / 2)
        row.addChild(icon)
        labelX = ICON_SIZE + 4
    }

    const label = new Text({ text, style: ROW_LABEL_STYLE })
    label.position.set(labelX, (ROW_HEIGHT - label.height) / 2)
    row.addChild(label)

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
    onSelect: () => void
): Container {
    const button = new Button<undefined>(undefined, width, ROW_HEIGHT, 0)
    button.position.set(x, y)
    if (active) {
        const highlight = new Graphics().rect(0, 0, width, ROW_HEIGHT).fill(ACTIVE_ROW_COLOR)
        button.addChildAt(highlight, 0)
    }

    const icon = tryCreateIcon(iconName, ICON_SIZE)
    let labelX = 4
    if (icon) {
        icon.position.set(4 + ICON_SIZE / 2, ROW_HEIGHT / 2)
        button.addChild(icon)
        labelX = 4 + ICON_SIZE + 4
    }

    const text = new Text({ text: label, style: ROW_LABEL_STYLE })
    text.position.set(labelX, (ROW_HEIGHT - text.height) / 2)
    button.addChild(text)

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
    rows: Container[]
): void {
    for (const entry of entries) {
        const x = PADDING + depth * INDENT
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
                    () => onSelect(index)
                )
            )
        } else if (entry.blueprint_book) {
            rows.push(
                createStaticRow(
                    entry.blueprint_book.label || 'Blueprint Book',
                    x,
                    y,
                    firstIconName(entry.blueprint_book.icons) ?? 'blueprint-book'
                )
            )

            if (depth >= MAX_DEPTH) {
                rows.push(
                    createStaticRow(
                        'Nested further, not shown',
                        PADDING + (depth + 1) * INDENT,
                        rows.length * ROW_HEIGHT
                    )
                )
            } else {
                buildRows(
                    entry.blueprint_book.blueprints ?? [],
                    depth + 1,
                    flatIndex,
                    activeIndex,
                    onSelect,
                    rows
                )
            }
        } else if (entry.upgrade_planner || entry.deconstruction_planner) {
            const label = entry.upgrade_planner ? 'Upgrade planner' : 'Deconstruction planner'
            rows.push(createStaticRow(label, x, y))
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
    private readonly m_Rows: Container
    private readonly m_ScrollThumb: Graphics
    private m_ContentHeight = 0

    public constructor(book: Book) {
        super(WIDTH, HEIGHT, 'Blueprint Book')

        this.m_Rows = new Container()
        this.m_Rows.position.set(0, VP_Y)
        this.addChild(this.m_Rows)

        const mask = new Graphics().rect(VP_X, VP_Y, VP_W, VP_H).fill(0xffffff)
        this.addChild(mask)
        this.m_Rows.mask = mask
        this.m_Rows.eventMode = 'static'
        this.m_Rows.hitArea = new Rectangle(0, 0, VP_W, VP_H)

        this.m_ScrollThumb = new Graphics().rect(0, 0, 4, 1).fill({ color: 0xc8c8c8, alpha: 0.6 })
        this.m_ScrollThumb.visible = false
        this.addChild(this.m_ScrollThumb)

        const rows: Container[] = []
        buildRows(
            book.entries,
            0,
            { current: 0 },
            book.activeIndex,
            index => {
                G.quickActions.selectBookEntry(index).catch((error: unknown) => {
                    G.logger({ text: String(error), type: 'error' })
                })
                this.close()
            },
            rows
        )

        for (const row of rows) {
            this.m_Rows.addChild(row)
        }
        this.m_ContentHeight = rows.length * ROW_HEIGHT

        const onWheel = (e: WheelEvent): void => {
            const maxScroll = Math.max(0, this.m_ContentHeight - VP_H)
            if (maxScroll <= 0) return
            e.preventDefault()
            e.stopPropagation()
            this.m_Rows.y = Math.min(
                VP_Y,
                Math.max(VP_Y - maxScroll, this.m_Rows.y - Math.sign(e.deltaY) * ROW_HEIGHT)
            )
            this.refreshScrollbar()
        }
        this.m_Rows.addEventListener('wheel', onWheel, { passive: false })
        this.on('destroyed', () => {
            this.m_Rows.removeEventListener('wheel', onWheel)
        })

        this.refreshScrollbar()
    }

    private refreshScrollbar(): void {
        const maxScroll = Math.max(0, this.m_ContentHeight - VP_H)
        if (maxScroll <= 0) {
            this.m_ScrollThumb.visible = false
            return
        }
        const thumbH = Math.max(24, (VP_H * VP_H) / this.m_ContentHeight)
        const scroll = VP_Y - this.m_Rows.y
        const thumbY = VP_Y + (scroll / maxScroll) * (VP_H - thumbH)
        this.m_ScrollThumb.visible = true
        this.m_ScrollThumb.height = thumbH
        this.m_ScrollThumb.position.set(WIDTH - PADDING - 4, thumbY)
    }
}
