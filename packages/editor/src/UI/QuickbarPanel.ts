import { Container, Graphics } from 'pixi.js'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import F from './controls/functions'
import { HoverText } from './controls/HoverText'
import { withKeybind } from '../core/keyComboLabel'
import {
    BAR_PADDING,
    BAR_SLOT_PITCH,
    QUICKBAR_MIDDLE_GAP,
    QUICKBAR_WIDTH,
    barLength,
} from './barLayout'
import { colors } from './style'

class QuickbarSlot extends Slot<string | undefined> {
    /** Undefined for an empty slot, which is what unassignItem leaves behind. */
    public get itemName(): string | undefined {
        return this.data
    }

    public assignItem(itemName: string): void {
        if (itemName === 'blueprint') return
        this.data = itemName
        this.content = F.CreateIcon(itemName)
    }

    public unassignItem(): void {
        this.data = undefined
        this.content = undefined
    }
}

export class QuickbarPanel extends Panel {
    private rows: number

    private slots: QuickbarSlot[]
    private slotsContainer: Container
    private readonly hoverText = new HoverText()

    public constructor(rows = 1, itemNames?: string[]) {
        super(
            QUICKBAR_WIDTH,
            barLength(rows),
            colors.quickbar.background.color,
            colors.quickbar.background.alpha,
            colors.quickbar.background.border
        )

        this.rows = rows
        // Dense, not sparse. generateSlots below fills every index 0..rows*10-1
        // before anything reads this, so the two are equivalent today - but
        // serialize() maps over it, and `.map` *skips* holes while it would call
        // `s.itemName` on a dense undefined. So if a slot ever did go unfilled,
        // sparse would silently return a shorter array and slide the quickbar one
        // place left on the next load, where dense throws instead. Loud beats
        // silently wrong for something that persists.
        this.slots = Array.from<QuickbarSlot>({ length: rows * 10 })

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(BAR_PADDING, BAR_PADDING)
        this.addChild(this.slotsContainer)

        this.generateSlots(itemNames)

        const t = QuickbarPanel.createTriangleButton(15, 14)
        t.position.set((this.width - t.width) / 2, (this.height - t.height) / 2)
        t.on('pointerdown', this.changeActiveQuickbar)
        /*
            It swaps the two rows, and nothing on it says so (#509). The name
            is the game's own for the action, `rotate-active-quick-bars` in
            `core/locale/en/core.cfg`, and the keybind is read on each hover
            because a user can rebind it.
        */
        t.on('pointerover', () => {
            const keyCombo = G.actions.get('changeActiveQuickbar')?.keyCombo
            this.hoverText.show(t, withKeybind('Rotate active quickbars', keyCombo), t.x)
        })
        t.on('pointerout', () => this.hoverText.hide(t))
        this.addChild(t, this.hoverText)
    }

    /** The hover text on show, or undefined when there is none. */
    public get hoverTextShown(): string | undefined {
        return this.hoverText.shown
    }

    private static createTriangleButton(width: number, height: number): Graphics {
        const button = new Graphics()

        button
            .moveTo(0, height)
            .lineTo(width / 2, 0)
            .lineTo(width, height)
            .lineTo(0, height)
            .fill(colors.controls.button.background.color)

        button.eventMode = 'static'

        button.on('pointerover', () => {
            button.alpha = 0.8
        })
        button.on('pointerout', () => {
            button.alpha = 1
        })

        return button
    }

    /** Positional: index i is slot i, and a hole leaves that slot empty. */
    public generateSlots(itemNames?: (string | undefined)[]): void {
        for (let r = 0; r < this.rows; r++) {
            for (let i = 0; i < 10; i++) {
                const quickbarSlot = new QuickbarSlot(undefined)
                quickbarSlot.position.set(
                    BAR_SLOT_PITCH * i + (i > 4 ? QUICKBAR_MIDDLE_GAP : 0),
                    BAR_SLOT_PITCH * r
                )

                // Read into a local: the index is a loop `let`, so TypeScript
                // will not carry the truthiness test across to the use.
                const itemName = itemNames?.[r * 10 + i]
                if (itemName) {
                    quickbarSlot.assignItem(itemName)
                }

                quickbarSlot.on('pointerdown', e => {
                    // Use Case 1:   Left Click  & Slot=Empty & Mouse=Painting                      >> Assign Mouse Item to Slot
                    // Use Case 2:   Left Click  & Slot=Item  & Mouse=Painting                      >> Assign Slot Item to Mouse
                    // Use Case 2.5: Left Click  & Slot=Item  & Mouse=Painting & Item=PaintingItem  >> Destroy Painting Item
                    // Use Case 3:   Left Click  & Slot=Empty & Mouse=Empty                         >> Assign Slot Item to Selected Inv item
                    // Use Case 4:   Left Click  & Slot=Item  & Mouse=Empty                         >> Assign Slot Item to Mouse
                    // Use Case 5:   Right Click & Slot=*     & Mouse=*                             >> Unassign Slot

                    if (e.button === 0) {
                        if (G.BPC.mode === EditorMode.PAINT) {
                            if (quickbarSlot.itemName) {
                                if (quickbarSlot.itemName === G.BPC.painting.getItemName()) {
                                    // UC2.5
                                    G.BPC.painting.destroy()
                                } else {
                                    // UC2
                                    G.BPC.spawnPaintContainer(quickbarSlot.itemName)
                                }
                            } else {
                                // UC1
                                quickbarSlot.assignItem(G.BPC.painting.getItemName())
                            }
                        } else if (quickbarSlot.itemName) {
                            // UC4
                            G.BPC.spawnPaintContainer(quickbarSlot.itemName)
                        } else {
                            // UC3
                            G.UI.createInventory('Inventory', undefined, item =>
                                quickbarSlot.assignItem(item)
                            )
                        }
                    } else if (e.button === 2) {
                        // UC5
                        quickbarSlot.unassignItem()
                    }
                })

                this.slots[r * 10 + i] = quickbarSlot
                this.slotsContainer.addChild(quickbarSlot)
            }
        }
    }

    public bindKeyToSlot(slot: number): void {
        const itemName = this.slots[slot].itemName
        if (!itemName) return

        if (G.BPC.mode === EditorMode.PAINT && G.BPC.painting.getItemName() === itemName) {
            G.BPC.painting.destroy()
            return
        }

        G.BPC.spawnPaintContainer(itemName)
    }

    /** Arrow property: handed to a pointerdown listener. @see EntityContainer.redrawEntityInfo */
    public readonly changeActiveQuickbar = (): void => {
        this.slotsContainer.removeChildren()

        let itemNames = this.serialize()
        // Left shift array by 10
        itemNames = itemNames.concat(itemNames.splice(0, 10))
        this.generateSlots(itemNames)
    }

    /*
        One entry per slot, so an empty slot is a hole rather than a gap closed
        up - generateSlots indexes this positionally, and compacting it would
        slide every later item one place left on the next load.
    */
    public serialize(): (string | undefined)[] {
        return this.slots.map(s => s.itemName)
    }

    protected override setPosition(): void {
        this.position.set(
            G.app.screen.width / 2 - this.width / 2,
            G.app.screen.height - this.height + 1
        )
    }
}
