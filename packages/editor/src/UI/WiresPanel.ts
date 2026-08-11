import { Container } from 'pixi.js'
import FD from '../core/factorioData'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import F from './controls/functions'
import { colors } from './style'

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

/*
    Columns fixed at 3 - the wire row's own count - rather than widening the
    panel to fit the 4 action slots on the same row. This panel sits flush
    against the quickbar's right edge (see setPosition), close enough to the
    screen's right side at common viewport widths (1280 and narrower) that
    growing rightward runs the new slots under `.toasts-container`, which is
    `position: fixed; right: 0; width: 320px` and sits above the canvas -
    verified by clicking a widened-panel action slot there and finding the
    click reached the toast, not the button. Growing downward into extra rows
    instead keeps the panel's width - and therefore its right edge - exactly
    what it was before these buttons existed.
*/
const COLS = 3
const ACTION_ROWS = Math.ceil(4 / COLS)

export class WiresPanel extends Panel {
    private slotsContainer: Container
    public static Wires = ['copper-wire', 'red-wire', 'green-wire']

    public constructor() {
        super(
            24 + 38 * COLS - 2,
            24 + 38 * (1 + ACTION_ROWS) - 2,
            colors.quickbar.background.color,
            colors.quickbar.background.alpha,
            colors.quickbar.background.border
        )

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(12, 12)
        this.addChild(this.slotsContainer)

        this.generateSlots()
        this.generateActionSlots()
    }

    public generateSlots(): void {
        for (const [i, wire] of WiresPanel.Wires.entries()) {
            const slot = new WireSlot(wire)
            slot.position.set((36 + 2) * i, 0)

            slot.on('pointerdown', e => {
                if (e.button === 0) {
                    if (G.BPC.mode === EditorMode.PAINT) {
                        if (slot.wireName === G.BPC.painting.getItemName()) {
                            G.BPC.painting.destroy()
                        } else {
                            G.BPC.spawnPaintContainer(slot.wireName)
                        }
                    } else {
                        G.BPC.spawnPaintContainer(slot.wireName)
                    }
                }
            })

            this.slotsContainer.addChild(slot)
        }
    }

    /**
     * Import-replace, import-append, export-to-string and export-to-image -
     * the four actions that only ever existed as a keyboard shortcut (paste,
     * Ctrl+Shift+V, copy and Ctrl+S respectively), with no menu entry to find
     * them from. Icons are the game's own GUI sprites rather than repurposed
     * item icons, since nothing in the item list means "import" or "export".
     * Laid out in the rows below the wire row, `COLS` wide - see the comment
     * on `COLS` for why this doesn't sit beside the wires instead.
     */
    private generateActionSlots(): void {
        const actions: [icon: Container, onClick: () => void][] = [
            [
                F.CreateUtilitySpriteIcon(FD.utilitySprites.import_slot),
                () => G.quickActions.importReplace(),
            ],
            [F.CreateUtilitySpriteIcon(FD.utilitySprites.add), () => G.quickActions.importAppend()],
            [
                F.CreateUtilitySpriteIcon(FD.utilitySprites.export_slot),
                () => G.quickActions.exportString(),
            ],
            [F.CreateIcon('blueprint'), () => G.quickActions.exportImage()],
        ]

        for (const [i, [icon, onClick]] of actions.entries()) {
            const slot = new ActionSlot(icon, onClick)
            const row = 1 + Math.floor(i / COLS)
            const col = i % COLS
            slot.position.set((36 + 2) * col, (36 + 2) * row)
            this.slotsContainer.addChild(slot)
        }
    }

    protected override setPosition(): void {
        this.position.set(G.app.screen.width / 2 + 442 / 2, G.app.screen.height - this.height + 1)
    }
}
