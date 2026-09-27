import { Container, Text } from 'pixi.js'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'
import { Button } from './controls/Button'
import { Panel } from './controls/Panel'
import { Slot } from './controls/Slot'
import F from './controls/functions'
import { HoverText } from './controls/HoverText'
import { withKeybind } from '../core/keyComboLabel'
import {
    BAR_PADDING,
    BAR_SLOT_PITCH,
    BAR_SLOT_SIZE,
    QUICKBAR_MIDDLE_GAP,
    QUICKBAR_PAGE_COLUMN,
    QUICKBAR_WIDTH,
    barLength,
} from './barLayout'
import { colors, styles } from './style'

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

/*
    The game's page button face, `quick_bar_page_button`'s default graphical
    set, read off `__core__/graphics/gui-new.png` at {312, 744}.
*/
const PAGE_BUTTON_COLOR = 0x8c8c8c

/**
 * The square left of a row that names the page the row shows, as the game's
 * quickbar does (#512). Raised, where a slot is sunk.
 */
class PageButton extends Button {
    private readonly caption = new Text({ style: styles.quickbar.page })

    public constructor() {
        super(undefined, BAR_SLOT_SIZE, BAR_SLOT_SIZE)
        this.caption.anchor.set(0.5)
        this.content = this.caption
    }

    public set page(page: number) {
        this.caption.text = String(page + 1)
    }

    protected override get background(): number {
        return PAGE_BUTTON_COLOR
    }
}

export class QuickbarPanel extends Panel {
    private rows: number
    /** The page each row shows, top row first, counting from 0. */
    private rowPages: number[]
    private readonly pageButtons: PageButton[]

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
        this.rowPages = Array.from({ length: rows }, (_, r) => r)
        // generateSlots below fills every index 0..rows*10-1 before anything
        // reads this. serialize() reads each slot by index, so a slot left
        // unfilled throws there rather than saving a quickbar with a gap in
        // it. Loud beats silently wrong for something that persists.
        this.slots = Array.from<QuickbarSlot>({ length: rows * 10 })

        this.slotsContainer = new Container()
        this.slotsContainer.position.set(BAR_PADDING + QUICKBAR_PAGE_COLUMN, BAR_PADDING)
        this.addChild(this.slotsContainer)

        this.generateSlots(itemNames)

        /*
            In the game a click on a page button picks which of ten pages its
            row shows. The editor has as many pages as rows, so picking the
            other page is a swap, and a click does what X does. The hover text
            is the game's name for that action, `rotate-active-quick-bars` in
            `core/locale/en/core.cfg`, and the keybind is read on each hover
            because a user can rebind it (#509).
        */
        this.pageButtons = this.rowPages.map((page, r) => {
            const button = new PageButton()
            button.page = page
            button.position.set(BAR_PADDING, BAR_PADDING + BAR_SLOT_PITCH * r)
            button.on('pointerdown', e => {
                if (e.button === 0) this.changeActiveQuickbar()
            })
            button.on('pointerover', () => {
                const keyCombo = G.actions.get('changeActiveQuickbar')?.keyCombo
                this.hoverText.show(
                    button,
                    withKeybind('Rotate active quickbars', keyCombo),
                    button.x
                )
            })
            button.on('pointerout', () => this.hoverText.hide(button))
            return button
        })
        this.addChild(...this.pageButtons, this.hoverText)
    }

    /** The hover text on show, or undefined when there is none. */
    public get hoverTextShown(): string | undefined {
        return this.hoverText.shown
    }

    /** The page each row shows, top row first, counting from 1 as its button does. */
    public get pages(): number[] {
        return this.rowPages.map(page => page + 1)
    }

    /**
     * Positional, in page order: index i is slot i % 10 of page i / 10, and a
     * hole leaves that slot empty. Each row shows the page `rowPages` names.
     */
    public generateSlots(itemNames?: (string | undefined)[]): void {
        for (let r = 0; r < this.rows; r++) {
            const page = this.rowPages[r]
            for (let i = 0; i < 10; i++) {
                const quickbarSlot = new QuickbarSlot(undefined)
                quickbarSlot.position.set(
                    BAR_SLOT_PITCH * i + (i > 4 ? QUICKBAR_MIDDLE_GAP : 0),
                    BAR_SLOT_PITCH * r
                )

                // Read into a local: the index is a loop `let`, so TypeScript
                // will not carry the truthiness test across to the use.
                const itemName = itemNames?.[page * 10 + i]
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
        const itemNames = this.serialize()
        this.slotsContainer.removeChildren()

        // Each row takes the page the row below it showed.
        this.rowPages = [...this.rowPages.slice(1), this.rowPages[0]]
        for (const [r, button] of this.pageButtons.entries()) {
            button.page = this.rowPages[r]
        }
        this.generateSlots(itemNames)
    }

    /*
        One entry per slot, in page order, so what is saved does not depend on
        which row shows which page. An empty slot is a hole rather than a gap
        closed up - generateSlots indexes this positionally, and compacting it
        would slide every later item one place left on the next load.
    */
    public serialize(): (string | undefined)[] {
        const itemNames = Array.from<string | undefined>({ length: this.slots.length })
        for (const [r, page] of this.rowPages.entries()) {
            for (let i = 0; i < 10; i++) {
                itemNames[page * 10 + i] = this.slots[r * 10 + i].itemName
            }
        }
        return itemNames
    }

    protected override setPosition(): void {
        this.position.set(
            G.app.screen.width / 2 - this.width / 2,
            G.app.screen.height - this.height + 1
        )
    }
}
