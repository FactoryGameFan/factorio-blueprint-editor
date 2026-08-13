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
        this.content = F.CreateIcon(wireName)

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
 * Inserted just below the slot's own content (added last, so it's the final
 * child) so the icon/text stays legible on top of it.
 */
function addToggleHighlight(slot: Container, color: number): Graphics {
    const highlight = new Graphics().rect(0, 0, 36, 36).fill(color)
    highlight.visible = false
    slot.addChildAt(highlight, slot.children.length - 1)
    return highlight
}

const WIRES = ['copper-wire', 'red-wire', 'green-wire']

/*
    2 rows, filled column-major (top-to-bottom, then next column) rather than
    a single wide row. This panel sits flush against the quickbar's right edge
    (see setPosition), close enough to the screen's right side at common
    viewport widths (1280 and narrower) that a wide single row runs under
    `.toasts-container`, which is `position: fixed; right: 0; width: 320px`
    and sits above the canvas - verified by clicking a widened-panel slot
    there and finding the click reached the toast, not the button. Wrapping
    into a second row instead keeps the panel as narrow as the action count
    allows.

    Each action pairs with the wire below it - Alt/copper-wire,
    open-Import/green-wire, open-Export/red-wire, Undo/Redo - except the
    last column, export-image, which has no wire to pair with and doesn't
    need one.
*/
const ROWS = 2
const CELL_COUNT = WIRES.length + 6

export class ToolsPanel extends Panel {
    private slotsContainer: Container
    public static Wires = WIRES

    public constructor() {
        const cols = Math.ceil(CELL_COUNT / ROWS)
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

        this.generateSlots()
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
     */
    public generateSlots(): void {
        const altSlot = new ActionSlot(createTextIcon('ALT'), () =>
            G.BPC.overlayContainer.toggleEntityInfoVisibility()
        )
        /*
            Polls rather than listening for an event, because `G.BPC` - and so
            `overlayContainer` - is a fresh instance every `loadBlueprint`
            (Editor.ts), while this panel and its ticker callback are
            constructed once and outlive every reload. A listener attached to
            today's overlayContainer would go silent on the next one; reading
            `G.BPC` fresh each frame can't go stale the same way.
        */
        const altHighlight = addToggleHighlight(altSlot, ALT_ACTIVE_COLOR)
        G.app.ticker.add(() => {
            altHighlight.visible = G.BPC.overlayContainer.entityInfoVisible
        })

        const cells: Container[] = [
            altSlot,
            new WireSlot(WIRES[0]),
            new ActionSlot(F.CreateUtilitySpriteIcon(FD.utilitySprites.import_slot), () =>
                G.UI.toggleImportDialog()
            ),
            new WireSlot(WIRES[2]),
            new ActionSlot(F.CreateUtilitySpriteIcon(FD.utilitySprites.export_slot), () =>
                G.UI.toggleExportDialog()
            ),
            new WireSlot(WIRES[1]),
            new ActionSlot(F.CreateIcon('signal-anticlockwise-circle-arrow'), () =>
                G.bp.history.undo()
            ),
            new ActionSlot(F.CreateIcon('signal-clockwise-circle-arrow'), () =>
                G.bp.history.redo()
            ),
            new ActionSlot(F.CreateUtilitySpriteIcon(FD.utilitySprites.downloading), () =>
                G.quickActions.exportImage()
            ),
        ]

        for (const [i, slot] of cells.entries()) {
            const col = Math.floor(i / ROWS)
            const row = i % ROWS
            slot.position.set((36 + 2) * col, (36 + 2) * row)
            this.slotsContainer.addChild(slot)
        }
    }

    protected override setPosition(): void {
        this.position.set(G.app.screen.width / 2 + 442 / 2, G.app.screen.height - this.height + 1)
    }
}
