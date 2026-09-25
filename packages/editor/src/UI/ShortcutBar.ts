import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import {
    PathSegment,
    SHORTCUT_ICON_FRAME,
    ShortcutIconName,
    shortcutIcon,
} from '../core/shortcutIcons'
import { withKeybind } from '../core/keyComboLabel'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import { colors, styles } from './style'

/** The icon's drawn size inside a 36 px slot, the size every other slot icon uses. */
const ICON_SIZE = 32
const SUPERSAMPLE = 4

/*
    The game's shortcut button face, read off `__core__/graphics/gui-new.png`
    at the `slot_sized_button` position. The game's icons are dark ink made
    for this lighter grey: on the editor's usual 0x646464 slot the ink reads
    at 2.85:1, and here at 5.0:1.
*/
const SHORTCUT_BUTTON_COLOR = 0x8c8c8c

/*
    Arcs are traced as short lines rather than with `Graphics.arc`. Pixi's arc
    adds its start point even when the pen is already there, and a stroke
    divides by that zero-length step: measured, it cut a wedge out of the
    outer edge of each wire's ring. `lineTo` skips a repeated point. A full
    circle leaves off its last point, which is its first, and `close` joins
    the two.
*/
const ARC_STEP_DEGREES = 3

function tracePath(g: Graphics, path: readonly PathSegment[]): void {
    for (const s of path) {
        switch (s.op) {
            case 'move':
                g.moveTo(s.x, s.y)
                break
            case 'line':
                g.lineTo(s.x, s.y)
                break
            case 'arc': {
                const sweep = s.to - s.from
                const steps = Math.ceil(Math.abs(sweep) / ARC_STEP_DEGREES)
                const last = Math.abs(sweep) >= 360 ? steps - 1 : steps
                for (let i = 0; i <= last; i++) {
                    const a = ((s.from + (sweep * i) / steps) * Math.PI) / 180
                    g.lineTo(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a))
                }
                break
            }
            case 'close':
                g.closePath()
                break
        }
    }
}

/**
 * Draws one of `core/shortcutIcons.ts`'s icons, centred on its own origin.
 *
 * Baked to a texture, because the editor's canvas has antialiasing off and a
 * bare `Graphics` at 32 px shows stair steps on every curve. The texture is
 * drawn at `SUPERSAMPLE` times the screen pixels the icon covers and read
 * back down through its mipmaps, which smooths the edges the way the game's
 * own downscaled icon art is smooth. It is freed with the sprite.
 */
function createShortcutIcon(name: ShortcutIconName): Sprite {
    const g = new Graphics()
    for (const shape of shortcutIcon(name)) {
        tracePath(g, shape.path)
        if (shape.kind === 'fill') {
            g.fill(shape.color)
            /*
                All holes go in one `cut()`. Pixi 8's `cut()` adds a hole to
                the last fill and, when that fill already has one, to the fill
                before it as well, so a second call would punch the previous
                shape too.
            */
            if (shape.holes?.length) {
                for (const hole of shape.holes) tracePath(g, hole)
                g.cut()
            }
        } else {
            g.stroke({ width: shape.width, color: shape.color, cap: 'butt', join: 'miter' })
        }
    }
    const scale = ICON_SIZE / SHORTCUT_ICON_FRAME
    const texture = G.app.renderer.generateTexture({
        target: g,
        frame: new Rectangle(0, 0, SHORTCUT_ICON_FRAME, SHORTCUT_ICON_FRAME),
        resolution: SUPERSAMPLE * scale * G.app.renderer.resolution,
        antialias: true,
        textureSourceOptions: { scaleMode: 'linear', autoGenerateMipmaps: true },
    })
    g.destroy()

    const icon = new Sprite(texture)
    icon.label = `shortcut-icon:${name}`
    icon.anchor.set(0.5)
    icon.scale.set(scale)
    icon.once('destroyed', () => texture.destroy(true))
    return icon
}

/** A slot with the game's shortcut button colour, so the icons read the way they do in game. */
class ShortcutSlot<Data> extends Slot<Data> {
    protected override get background(): number {
        return SHORTCUT_BUTTON_COLOR
    }
}

/*
    Slot<string>, not the Slot<string | undefined> QuickbarSlot uses. The two
    look alike but a quickbar slot can be emptied - unassignItem sets its data
    back to undefined - while every wire slot is constructed and named in the
    same breath below, and there are exactly three of them for as long as the
    panel exists. Nothing ever clears one.
*/
class WireSlot extends ShortcutSlot<string> {
    public constructor(wireName: string, icon: ShortcutIconName) {
        super(wireName)
        this.content = createShortcutIcon(icon)

        this.on('pointerdown', e => {
            if (e.button !== 0) return
            if (G.BPC.mode === EditorMode.PAINT) {
                if (this.wireName === G.BPC.painting.getItemName()) {
                    G.BPC.painting.destroy()
                } else {
                    G.BPC.spawnPaintContainer(this.wireName)
                }
            } else {
                G.BPC.spawnPaintContainer(this.wireName)
            }
        })
    }

    public get wireName(): string {
        return this.data
    }
}

/**
 * A one-shot action button, styled like a WireSlot but calling `onClick`
 * instead of entering PAINT mode. Backs the import/export quick actions -
 * see `QuickActions` in common/globals.ts for why the click reaches
 * `navigator.clipboard`/`saveBlob` through there rather than directly.
 */
class ActionSlot extends ShortcutSlot<undefined> {
    public constructor(icon: ShortcutIconName, onClick: () => void) {
        super(undefined)
        this.content = createShortcutIcon(icon)
        this.on('pointerdown', e => {
            if (e.button === 0) onClick()
        })
    }
}

/*
    The game's selected shortcut button, from the same sheet as
    `SHORTCUT_BUTTON_COLOR`. The Alt icon is one colour of dark ink, so it
    needs no tint to read on either face - 5.0:1 on grey and 9.9:1 here. The
    fill alone shows that Alt is on, as it does in the game.
*/
const ALT_ACTIVE_COLOR = 0xf1be64

/**
 * A colour overlay toggled onto a slot to reflect a persistent on/off state,
 * rather than the momentary hover/press one `Button` already draws. Used for
 * Alt, so the button shows whether entity info is visible even when the
 * state last changed through the `AltLeft` keybind rather than a click here.
 *
 * Inserted just above the slot's own background - `Button`'s constructor
 * adds `[background, active, hover]` in that order and `content`'s setter
 * appends last, so a fully built slot's children are
 * `[background, active, hover, content]`. `addChildAt(highlight,
 * children.length - 1)` used to insert at the *content's own* index, which
 * pushes content up rather than landing below it - the highlight ended up
 * above `active`/`hover` too, not just below content, so while Alt was on,
 * the button drew no hover/press feedback at all, the one slot that most
 * needs to keep looking pressable since it is the only toggle in the panel.
 * `Math.min(1, ...)` both fixes that (index 1, right after background) and
 * survives a slot with zero children - `children.length - 1` was `-1` on
 * one, which `addChildAt` throws on - though nothing here constructs one.
 *
 * Sized off the slot's own drawn bounds rather than a third hardcoded copy
 * of `Slot`'s 36x36 default.
 */
function addToggleHighlight(slot: Container, color: number): Graphics {
    const highlight = new Graphics().rect(0, 0, slot.width, slot.height).fill(color)
    highlight.visible = false
    slot.addChildAt(highlight, Math.min(1, slot.children.length))
    return highlight
}

const WIRES = ['copper-wire', 'red-wire', 'green-wire']

/*
    2 rows, filled column-major (top-to-bottom, then next column) rather than
    a single wide row, so the panel stays as narrow as the action count
    allows - it sits flush against the quickbar's right edge (see
    setPosition) at common viewport widths, and a wide single row would run
    further under `.toasts-container` than a narrower two-row grid does.

    That used to matter for a stronger reason than width alone: a settled
    toast used to *intercept* clicks meant for whatever it covered, verified
    by clicking a widened-panel slot there and finding the click reached the
    toast instead of the button. Issue #228, merged from the base branch,
    fixed that at the source - `.toasts-container` and the toasts it holds
    are `pointer-events: none` now (bar `.toasts-persistent`, the
    infinite-timeout exception that needs a click to dismiss), so a toast no
    longer takes a click aimed at what it covers, row count or not. What
    #228 did not change is *visibility*: a toast still paints on top of
    whatever it overlaps for as long as it's up - measured at 1280x720, a
    settled toast still visually covers five of the nine slots here for its
    lifetime, a user just isn't blocked from clicking through it to reach
    them.

    `setPosition` below separately clamps the panel's x so it cannot run off
    the right edge of a narrower viewport - a different problem (the
    screen's own edge, not the toast overlay) that narrowing the grid here
    does not fix on its own.

    Each action pairs with the wire below it - Alt/copper-wire,
    open-Import/red-wire, open-Export/green-wire, Undo/Redo - except the
    last column, export-image, which has no wire to pair with and doesn't
    need one. The wire order itself is `WIRES`' own declared order
    (copper, red, green) - the same left-to-right order the pre-existing
    single-row `WiresPanel` this replaced drew them in - rather than a
    reordering invented for this grid.
*/
const ROWS = 2

/**
 * What a button's hover text says: its name, and the action whose keybind
 * follows it in brackets. The names are the game's English ones, from the
 * `[shortcut]` section of `base/locale/en/base.cfg`, where the game has a
 * shortcut. Export and export image have none, so their names are the
 * editor's own.
 *
 * The keybind is read when the hover starts rather than stored here, because
 * a user can rebind any action in settings.
 */
interface HoverText {
    name: string
    /** The actions whose keybinds the text shows, in order. */
    actions?: readonly string[]
}

interface Cell {
    slot: Container
    hover: HoverText
}

export class ShortcutBar extends Panel {
    private slotsContainer: Container
    private altHighlightTick: (() => void) | undefined
    /*
        One box, shown above whichever slot the pointer is over, and reused
        for every hover. A fresh `Text` per hover would leak: pixi's text
        listens for changes on its style, which here is the shared
        `styles.dialog.label`, and does not stop listening when destroyed.
    */
    private readonly hoverText = new Container()
    private readonly hoverBackground = new Graphics()
    private readonly hoverLabel = new Text({ style: styles.dialog.label })
    private hoveredSlot: Container | undefined
    public static Wires = WIRES

    public constructor() {
        const initialCells = ShortcutBar.buildCells()
        const cols = Math.ceil(initialCells.cells.length / ROWS)
        super(
            24 + 38 * cols - 2,
            24 + 38 * ROWS - 2,
            colors.quickbar.background.color,
            colors.quickbar.background.alpha,
            colors.quickbar.background.border
        )

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(12, 12)
        this.hoverLabel.position.set(8, 5)
        this.hoverText.addChild(this.hoverBackground, this.hoverLabel)
        this.hoverText.eventMode = 'none'
        this.hoverText.visible = false
        this.addChild(this.slotsContainer, this.hoverText)

        this.placeCells(initialCells)
    }

    /** The hover text on show, or undefined when there is none. */
    public get shortcutTooltip(): string | undefined {
        return this.hoverText.visible ? this.hoverLabel.text : undefined
    }

    private showHoverText(slot: Container, hover: HoverText): void {
        const keyCombos = (hover.actions ?? []).map(a => G.actions.get(a)?.keyCombo)
        this.hoverLabel.text = withKeybind(hover.name, keyCombos)

        const width = Math.ceil(this.hoverLabel.width) + 16
        const height = Math.ceil(this.hoverLabel.height) + 10
        this.hoverBackground
            .clear()
            .rect(0, 0, width, height)
            .fill(colors.dialog.background.color)
            .stroke({ width: 1, color: colors.controls.button.background.color, alignment: 1 })

        // Over the slot's left edge, and kept on screen at a narrow width.
        const x = this.slotsContainer.x + slot.x
        this.hoverText.position.set(
            Math.max(-this.x, Math.min(x, G.app.screen.width - this.x - width)),
            -height - 4
        )
        this.hoverText.visible = true
        this.hoveredSlot = slot
    }

    private hideHoverText(slot: Container): void {
        // pointerout on one slot can arrive after pointerover on the next.
        if (this.hoveredSlot !== slot) return
        this.hoverText.visible = false
        this.hoveredSlot = undefined
    }

    public override destroy(): void {
        if (this.altHighlightTick) {
            G.app.ticker.remove(this.altHighlightTick)
        }
        super.destroy()
    }

    /**
     * The wire slots and the Alt/import/export/undo/redo/export-image quick
     * actions in one interleaved grid - see the comment on `ROWS` for the
     * layout and why it wraps instead of running in a single row. Alt does
     * exactly what `AltLeft` does in Editor.ts's keybinds -
     * `overlayContainer.toggleEntityInfoVisibility()` - so a touch/no-keyboard
     * user can reach it too. Opening ImportDialog/ExportDialog is how paste
     * and copy (and, inside ImportDialog, Ctrl+Shift+V) become reachable
     * without already knowing the shortcut; export-to-image (Ctrl+S) stays a
     * direct one-click action since it produces a PNG rather than a string a
     * dialog would have anything to show. Undo/Redo (Ctrl+Z/Ctrl+Y) call
     * `G.bp.history` directly, the same as their keybinds in Editor.ts -
     * unlike the clipboard/file actions, undoing a change needs nothing
     * outside the editor package. Every icon is a vector from
     * `core/shortcutIcons.ts`, traced from the game's own shortcut art where
     * the game has a shortcut.
     *
     * Pure - builds and wires every cell fresh but touches nothing on `this`,
     * so the constructor can call it once before `super()` (cells aren't
     * `this`-dependent, only counting them for sizing is needed there) and
     * reuse the very same result afterwards, rather than building the whole
     * grid twice at startup. `generateSlots`, the public re-callable entry
     * point, calls it again for its own single fresh build.
     */
    private static buildCells(): { cells: Cell[]; altSlot: ActionSlot } {
        const altSlot = new ActionSlot('alt-mode', () =>
            G.BPC.overlayContainer.toggleEntityInfoVisibility()
        )

        const cells: Cell[] = [
            {
                slot: altSlot,
                hover: {
                    name: 'Toggle "Alt-mode"',
                    actions: ['showInfo', 'showInfoRight'],
                },
            },
            { slot: new WireSlot(WIRES[0], 'copper-wire'), hover: { name: 'Make copper wire' } },
            {
                slot: new ActionSlot('import-string', () => G.UI.toggleImportDialog()),
                hover: { name: 'Import string' },
            },
            { slot: new WireSlot(WIRES[1], 'red-wire'), hover: { name: 'Make red wire' } },
            {
                slot: new ActionSlot('export-string', () => G.UI.toggleExportDialog()),
                hover: { name: 'Export string' },
            },
            { slot: new WireSlot(WIRES[2], 'green-wire'), hover: { name: 'Make green wire' } },
            {
                slot: new ActionSlot('undo', () => G.bp.history.undo()),
                hover: { name: 'Undo', actions: ['undo'] },
            },
            {
                slot: new ActionSlot('redo', () => G.bp.history.redo()),
                hover: { name: 'Redo', actions: ['redo'] },
            },
            {
                slot: new ActionSlot('export-image', () => G.quickActions.exportImage()),
                hover: { name: 'Export image', actions: ['takePicture'] },
            },
        ]

        return { cells, altSlot }
    }

    /**
     * Re-callable: clears whatever `slotsContainer` currently holds and
     * destroys each removed child, since `removeChildren()` alone only
     * detaches, before placing a freshly built set, and replaces the ticker
     * rather than accumulating a second one. The destroy cascades to each
     * slot's children, because a bare `destroy()` stops at the slot itself
     * (#242 review) and each slot's icon sprite owns a baked texture that it
     * frees only when it is destroyed. Nothing calls this a second time today,
     * but nothing should have to trust that either - `QuickbarPanel.generateSlots`
     * is the precedent this mirrors, for row-count changes.
     */
    public generateSlots(): void {
        this.placeCells(ShortcutBar.buildCells())
    }

    private placeCells({ cells, altSlot }: { cells: Cell[]; altSlot: ActionSlot }): void {
        for (const child of this.slotsContainer.removeChildren()) {
            child.destroy({ children: true })
        }
        if (this.hoveredSlot) this.hideHoverText(this.hoveredSlot)

        /*
            Polls rather than listening for an event, because `G.BPC` - and so
            `overlayContainer` - is a fresh instance every `loadBlueprint`
            (Editor.ts), while this panel and its ticker callback are
            constructed once and outlive every reload. A listener attached to
            today's overlayContainer would go silent on the next one; reading
            `G.BPC` fresh each frame can't go stale the same way.
        */
        if (this.altHighlightTick) {
            G.app.ticker.remove(this.altHighlightTick)
        }
        const altHighlight = addToggleHighlight(altSlot, ALT_ACTIVE_COLOR)
        this.altHighlightTick = () => {
            altHighlight.visible = G.BPC.overlayContainer.entityInfoVisible
        }
        G.app.ticker.add(this.altHighlightTick)

        for (const [i, { slot, hover }] of cells.entries()) {
            const col = Math.floor(i / ROWS)
            const row = i % ROWS
            slot.position.set((36 + 2) * col, (36 + 2) * row)
            slot.on('pointerover', () => this.showHoverText(slot, hover))
            slot.on('pointerout', () => this.hideHoverText(slot))
            this.slotsContainer.addChild(slot)
        }
    }

    /**
     * Flush against the quickbar's right edge at common viewport widths, the
     * same way the two-row layout above assumes - but clamped to the screen's
     * own right edge underneath that, since the unclamped position runs the
     * panel off-screen entirely below ~866px (`screen.width / 2 + 221 +
     * this.width > screen.width`, solved for `screen.width`). Below that
     * width the panel overlaps the quickbar instead of vanishing, which is
     * the same trade-off a real user can still click through. Also clamped
     * at 0: `screen.width - this.width` goes negative once the screen is
     * narrower than the panel itself (below ~212px, `this.width` being
     * `24 + 38*cols - 2` for `cols = ceil(9/2) = 5`), which without the
     * lower bound pushed the panel off the *left* edge instead - worse than
     * the overlap this comment already accepts, since a clamp to 0 is still
     * fully on-screen and clickable where a negative one is not (#242
     * review).
     */
    protected override setPosition(): void {
        const x = Math.max(
            0,
            Math.min(G.app.screen.width / 2 + 442 / 2, G.app.screen.width - this.width)
        )
        this.position.set(x, G.app.screen.height - this.height + 1)
    }
}
