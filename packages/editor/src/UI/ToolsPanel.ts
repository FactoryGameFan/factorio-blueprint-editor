import { Container, Graphics, Text } from 'pixi.js'
import FD from '../core/factorioData'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import F from './controls/functions'
import { colors, styles } from './style'

/*
    Slot<string>, not the Slot<string | undefined> QuickbarSlot uses. The two
    look alike but a quickbar slot can be emptied - unassignItem sets its data
    back to undefined - while every wire slot is constructed and named in the
    same breath below, and there are exactly three of them for as long as the
    panel exists. Nothing ever clears one.
*/
class WireSlot extends Slot<string> {
    public constructor(wireName: string) {
        super(wireName)
        this.content = safeIcon(wireName, () => F.CreateIcon(wireName))

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
 * `navigator.clipboard`/`FileSaver` through there rather than directly.
 */
class ActionSlot extends Slot<undefined> {
    public constructor(icon: Container, onClick: () => void) {
        super(undefined)
        this.content = icon
        this.on('pointerdown', e => {
            if (e.button === 0) onClick()
        })
    }
}

/**
 * A text-labelled slot, for Alt - there is no "ALT"-shaped icon anywhere in
 * vanilla Factorio's sprites, since the game spells its own key hints out as
 * text rather than drawing them (see ToolsPanel's `generateSlots` doc for the
 * icons that do exist).
 */
function createTextIcon(text: string): Container {
    const label = new Text({ text, style: styles.controls.checkbox })
    label.anchor.set(0.5)
    return label
}

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
 * An icon that failed to build costs this one slot rather than the whole
 * panel - `F.CreateIcon`/`F.CreateUtilitySpriteIcon` throw by design for a
 * name FD does not have (see `need()` in `core/need.ts`), and nothing above
 * `generateSlots()` catches. Falls back to an empty, childless `Container` -
 * not a drawn blank square, which this doc comment used to claim (#242
 * review): it has no graphic of its own at all, so the slot still exists and
 * is still clickable, but nothing is visible where the icon would have been.
 * Named in a warning rather than silently swallowed either way.
 */
function safeIcon(name: string, build: () => Container): Container {
    try {
        return build()
    } catch (error) {
        G.logger({ text: `Could not build the "${name}" icon: ${String(error)}`, type: 'warning' })
        return new Container()
    }
}

export class ToolsPanel extends Panel {
    private slotsContainer: Container
    private altHighlightTick: (() => void) | undefined
    public static Wires = WIRES

    public constructor() {
        const initialCells = ToolsPanel.buildCells()
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
        this.addChild(this.slotsContainer)

        this.placeCells(initialCells)
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
     * outside the editor package. Import/Export/Undo/Redo/export-image use
     * the game's own GUI sprites and signal icons -
     * `signal-anticlockwise-circle-arrow`/`signal-clockwise-circle-arrow`, a
     * Space Age virtual signal, is the only "undo"/"redo"-shaped icon
     * anywhere in vanilla Factorio's data, item or utility sprite alike, and
     * `downloading` (a mip GUI icon, hence `CreateUtilitySpriteIcon` reading
     * `size` as well as `width`/`height`) reads as "save this out" more than
     * the blueprint icon it replaced did. Alt has no icon anywhere in the
     * game's data at all, since the game spells its own key hints out as
     * text.
     *
     * Pure - builds and wires every cell fresh but touches nothing on `this`,
     * so the constructor can call it once before `super()` (cells aren't
     * `this`-dependent, only counting them for sizing is needed there) and
     * reuse the very same result afterwards, rather than building the whole
     * grid twice at startup. `generateSlots`, the public re-callable entry
     * point, calls it again for its own single fresh build.
     */
    private static buildCells(): { cells: Container[]; altSlot: ActionSlot } {
        const altSlot = new ActionSlot(createTextIcon('ALT'), () =>
            G.BPC.overlayContainer.toggleEntityInfoVisibility()
        )

        const cells: Container[] = [
            altSlot,
            new WireSlot(WIRES[0]),
            new ActionSlot(
                safeIcon('import_slot', () =>
                    F.CreateUtilitySpriteIcon(FD.utilitySprites.import_slot)
                ),
                () => G.UI.toggleImportDialog()
            ),
            new WireSlot(WIRES[1]),
            new ActionSlot(
                safeIcon('export_slot', () =>
                    F.CreateUtilitySpriteIcon(FD.utilitySprites.export_slot)
                ),
                () => G.UI.toggleExportDialog()
            ),
            new WireSlot(WIRES[2]),
            new ActionSlot(
                safeIcon('signal-anticlockwise-circle-arrow', () =>
                    F.CreateIcon('signal-anticlockwise-circle-arrow')
                ),
                () => G.bp.history.undo()
            ),
            new ActionSlot(
                safeIcon('signal-clockwise-circle-arrow', () =>
                    F.CreateIcon('signal-clockwise-circle-arrow')
                ),
                () => G.bp.history.redo()
            ),
            new ActionSlot(
                safeIcon('downloading', () =>
                    F.CreateUtilitySpriteIcon(FD.utilitySprites.downloading)
                ),
                () => G.quickActions.exportImage()
            ),
        ]

        return { cells, altSlot }
    }

    /**
     * Re-callable: clears whatever `slotsContainer` currently holds - and
     * calls `destroy()` on each removed child, since `removeChildren()`
     * alone only detaches - before placing a freshly built set, and replaces
     * the ticker rather than accumulating a second one. Bare `destroy()`
     * with no options does not cascade to a child's own children, only to
     * the immediate container (pixi's own `Container.destroy` doc comment,
     * `{children: true, texture: true, textureSource: true}` is what
     * reaches further) - a claim this used to make and got wrong (#242
     * review) - so each slot's own icon `Sprite`/texture is not released
     * here; only the slot container itself is. Nothing calls this a second
     * time today, but nothing should have to trust that either -
     * `QuickbarPanel.generateSlots` is the precedent this mirrors, for
     * row-count changes.
     */
    public generateSlots(): void {
        this.placeCells(ToolsPanel.buildCells())
    }

    private placeCells({ cells, altSlot }: { cells: Container[]; altSlot: ActionSlot }): void {
        for (const child of this.slotsContainer.removeChildren()) {
            child.destroy()
        }

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

        for (const [i, slot] of cells.entries()) {
            const col = Math.floor(i / ROWS)
            const row = i % ROWS
            slot.position.set((36 + 2) * col, (36 + 2) * row)
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
