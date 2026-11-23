import { Container, Text } from 'pixi.js'
import FD, { localisedName, recipeIngredients, recipeResults } from '../core/factorioData'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { Button } from './controls/Button'
import { SCROLL_TRACK_W, ScrollArea } from './controls/ScrollArea'
import { colors, styles } from './style'

/*
    Cols
    Space   @ 0     +12              ->12
    Items   @ 12    +(10*(36+2))     ->392
    Space   @ 392   +12              ->404
    Width : 12 + (10 * (36 + 2)) + 12 = 404

    Rows
    Space   @ 0   +10                ->10
    Title   @ 10  +24                ->34
    Space   @ 34  +12                ->46
    Groups  @ 46  +68                ->114
    Space   @ 114 +12                ->126
    Items   @ 126 +(8*(36+2))        ->430
    Space   @ 430 +12                ->442
    Height : 10 + 24 + 12 + 68 + 12 + (8*(36+2)) + 12 = 442

    Space   @ 0   +10                ->10
    R.Label @ 10  +16                ->26
    Space   @ 26  +10                ->36
    R.Data  @ 36  +36                ->72
    Space   @ 8   +8                 ->78
    Height : 10 + 16 + 10 + 36 + 8 = 78
*/

/*
    The item buttons carry no data - only `content`, the icon. This used to say
    `Button<Container>`, which puts the type argument in Button's *Data* slot
    rather than its Content one, so it claimed every item button held a
    Container that nothing ever assigned. Data defaults to undefined, which is
    what these actually have.
*/
type InventoryItems = Container<Button<undefined>>

/** Inventory Dialog - Displayed to the user if there is a need to select an item */
export class InventoryDialog extends Dialog {
    /** Container for Inventory Group Buttons */
    private readonly m_InventoryGroups: Container<Button<InventoryItems>>

    /** Container for Inventory Group Items */
    private readonly m_InventoryItems: Container<InventoryItems>

    /** Text for Recipe Tooltip */
    private readonly m_RecipeLabel: Text

    /** Container for Recipe Tooltip */
    private readonly m_RecipeContainer: Container

    /** Hovered item for item pointerout check; undefined when nothing is hovered. */
    private m_hoveredItem: string | undefined

    /** Content height (px) of each inventory group container, for scroll clamping */
    private readonly m_ContentHeights = new Map<Container, number>()

    /** Where each group was left scrolled to, so a tab keeps its place while another is shown */
    private readonly m_Scrolls = new Map<Container, number>()

    /** Clips the items, scrolls them, and draws the scrollbar */
    private readonly m_ScrollArea: ScrollArea

    /** Whether the recipe panel was built - `setPosition` needs it after the constructor has returned */
    private readonly m_ShowRecipePanel: boolean

    // Items viewport geometry (matches the layout comment above)
    private static readonly VP_X = 12
    private static readonly VP_Y = 126
    private static readonly VP_W = 380
    private static readonly VP_H = 304
    private static readonly ROW_H = 38

    /** Whether an item qualifies for a group tab, mirroring the population loop below */
    private static itemQualifies(itemName: string, itemsFilter: string[] | undefined): boolean {
        if (itemsFilter === undefined) {
            const itemData = FD.items[itemName]
            if (!itemData) return false
            if (!itemData.place_result && !itemData.place_as_tile) return false
            if (itemData.place_result && !FD.entities[itemData.place_result]) return false
            return true
        }
        return itemsFilter.includes(itemName)
    }

    /**
     * Widen the dialog if more group tabs need to fit than the 404px base
     * layout was designed for. `DisplayPanelIcon` and `BlueprintIconSlot` are
     * the callers whose filter (items + fluids + virtual signals) spans
     * enough of `FD.inventoryLayout` to hit this - up to 7 tabs against Space
     * Age data, where every other filtered caller stays within a handful of
     * the base game's own groups.
     */
    private static computeWidth(itemsFilter: string[] | undefined): number {
        let groupCount = 0
        for (const group of FD.inventoryLayout) {
            if (group.name === 'creative' && itemsFilter !== undefined) continue
            const hasItems = group.subgroups.some(subgroup =>
                subgroup.items.some(item => InventoryDialog.itemQualifies(item.name, itemsFilter))
            )
            if (hasItems) groupCount += 1
        }
        return Math.max(404, groupCount * 70 + 22)
    }

    public constructor(
        title = 'Inventory',
        itemsFilter: string[] | undefined,
        // Not optional: picking an item is the whole point of the dialog, and all
        // five call sites pass one. Optional only made the invocation below a
        // type error, with nothing to do about it that was not a fiction.
        selectedCallBack: (selectedItem: string) => void,
        // Off for DisplayPanelIcon/BlueprintIconSlot: both pick from
        // items/fluids/signals with no recipe, so the panel would only ever
        // show as a permanently empty bar.
        showRecipePanel = true
    ) {
        super(InventoryDialog.computeWidth(itemsFilter), 442, title)

        this.m_ShowRecipePanel = showRecipePanel

        const D = InventoryDialog

        this.m_InventoryGroups = new Container()
        this.m_InventoryGroups.position.set(12, 46)
        this.addChild(this.m_InventoryGroups)

        // Clip the items to a fixed viewport and let them scroll.
        // Space Age groups contain far more items than fit in the fixed dialog
        // height, so without this the lower rows are hidden with no way to reach them.
        //
        // The track fills the 12px margin at the dialog's actual right border,
        // rather than sitting at a fixed VP_X + VP_W:
        // computeWidth can widen the dialog well past the base 404px layout the
        // viewport geometry was designed for, and a fixed-offset track would
        // strand itself deep inside the dialog instead of at its edge. It sits
        // beside the items, not over them.
        this.m_ScrollArea = new ScrollArea({
            width: D.VP_W,
            height: D.VP_H,
            trackX: this.width - D.VP_X - SCROLL_TRACK_W,
        })
        this.m_ScrollArea.position.set(D.VP_X, D.VP_Y)
        this.addChild(this.m_ScrollArea)
        this.m_InventoryItems = this.m_ScrollArea.content as Container<InventoryItems>

        let groupIndex = 0
        for (const group of FD.inventoryLayout) {
            // Make creative entities available only in the main inventory
            if (group.name === 'creative' && itemsFilter !== undefined) {
                continue
            }

            const inventoryGroupItems: InventoryItems = new Container()
            let itemColIndex = 0
            let itemRowIndex = 0

            for (const subgroup of group.subgroups) {
                let subgroupHasItems = false

                for (const item of subgroup.items) {
                    if (itemsFilter === undefined) {
                        const itemData = FD.items[item.name]
                        if (!itemData) continue
                        if (!itemData.place_result && !itemData.place_as_tile) continue
                        // needed for robots/trains/cars
                        if (itemData.place_result && !FD.entities[itemData.place_result]) continue
                    } else {
                        if (!itemsFilter.includes(item.name)) continue
                    }

                    if (itemColIndex === 10) {
                        itemColIndex = 0
                        itemRowIndex += 1
                    }

                    const button = new Button<undefined>(undefined, 36, 36)
                    button.position.set(itemColIndex * 38, itemRowIndex * 38)
                    button.content = F.CreateIcon(item.name)
                    button.on('pointerdown', e => {
                        e.stopPropagation()
                        if (e.button === 0) {
                            selectedCallBack(item.name)
                            this.close()
                        }
                    })
                    button.on('pointerover', () => {
                        this.m_hoveredItem = item.name
                        this.updateRecipeVisualization(item.name)
                    })
                    button.on('pointerout', () => {
                        // we have to check this because pointerout can fire after pointerover
                        if (this.m_hoveredItem === item.name) {
                            this.m_hoveredItem = undefined
                            this.updateRecipeVisualization(undefined)
                        }
                    })

                    inventoryGroupItems.addChild(button)

                    itemColIndex += 1
                    subgroupHasItems = true
                    // }
                }

                if (subgroupHasItems) {
                    itemRowIndex += 1
                    itemColIndex = 0
                }
            }

            if (inventoryGroupItems.children.length > 0) {
                inventoryGroupItems.visible = groupIndex === 0
                this.m_InventoryItems.addChild(inventoryGroupItems)

                // Record content height so wheel scrolling can be clamped
                let contentH = 0
                for (const child of inventoryGroupItems.children) {
                    contentH = Math.max(contentH, child.position.y + D.ROW_H)
                }
                this.m_ContentHeights.set(inventoryGroupItems, contentH)

                // The group buttons do hold data - which items to reveal - and
                // `m_InventoryGroups` has always been declared as holding these.
                const button = new Button<InventoryItems>(inventoryGroupItems, 68, 68, 3)
                button.active = groupIndex === 0
                button.position.set(groupIndex * 70, 0)
                button.content = F.CreateIcon(group.name, group.name === 'creative' ? 32 : 64)
                button.on('pointerdown', e => {
                    e.stopPropagation()
                    if (e.button === 0) {
                        if (!button.active) {
                            for (const inventoryGroup of this.m_InventoryGroups.children) {
                                inventoryGroup.active = inventoryGroup === button
                            }
                        }
                        const buttonData = button.data
                        if (!buttonData.visible) {
                            for (const inventoryGroupItems of this.m_InventoryItems.children) {
                                if (inventoryGroupItems.visible) {
                                    this.m_Scrolls.set(
                                        inventoryGroupItems,
                                        this.m_ScrollArea.scroll
                                    )
                                }
                                inventoryGroupItems.visible = inventoryGroupItems === buttonData
                                inventoryGroupItems.interactiveChildren =
                                    inventoryGroupItems === buttonData
                            }
                            this.showScrollFor(buttonData)
                        }
                    }
                })

                this.m_InventoryGroups.addChild(button)

                groupIndex += 1
            }
        }

        // Detached placeholders when the recipe panel is hidden - keeps
        // updateRecipeVisualization a safe no-op rather than needing its own
        // showRecipePanel check, since item buttons call it unconditionally.
        this.m_RecipeLabel = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeContainer = new Container()

        if (this.m_ShowRecipePanel) {
            const recipePanel = new Container()
            recipePanel.position.set(0, 442)
            this.addChild(recipePanel)

            const recipeBackground = F.DrawRectangle(
                this.width,
                78,
                colors.dialog.background.color,
                colors.dialog.background.alpha,
                colors.dialog.background.border
            )
            recipeBackground.position.set(0, 0)
            recipePanel.addChild(recipeBackground)

            this.m_RecipeLabel.position.set(12, 10)
            recipePanel.addChild(this.m_RecipeLabel)

            this.m_RecipeContainer.position.set(12, 36)
            recipePanel.addChild(this.m_RecipeContainer)
        }

        this.showScrollFor(this.m_InventoryItems.children.find(c => c.visible))

        // Again, now that `m_ShowRecipePanel` is set. `Panel`'s constructor
        // already ran this before that field was assigned, so it centred on
        // 442 and the recipe panel opened 39px lower than a resize would put
        // it - and under the bottom bars on a viewport where the full 520
        // fits above them (issue #347).
        this.setPosition()
    }

    /**
     * Where each group tab's centre sits, in the client coordinates a pointer
     * event takes, left to right. For specs: the tabs are pixi buttons, so
     * nothing outside the canvas can find them. See tests/dialog-scrolling.spec.ts.
     */
    public get groupTabCentres(): { x: number; y: number }[] {
        return this.m_InventoryGroups.children.map(button => {
            const at = button.toGlobal({ x: 0, y: 0 })
            return { x: at.x + button.width / 2, y: at.y + button.height / 2 }
        })
    }

    /** Points the scroll area at the shown group: its height, and where it was left */
    private showScrollFor(group: Container | undefined): void {
        this.m_ScrollArea.contentHeight = group ? (this.m_ContentHeights.get(group) ?? 0) : 0
        this.m_ScrollArea.scroll = group ? (this.m_Scrolls.get(group) ?? 0) : 0
    }

    /** Override automatically set position of dialog due to additional area for recipe */
    protected override setPosition(): void {
        this.centreOnScreen(this.m_ShowRecipePanel ? 520 : 442)
    }

    /** Update recipe visualization */
    private updateRecipeVisualization(recipeName?: string): void {
        // Update Recipe Label
        this.m_RecipeLabel.text = ''

        // Update Recipe Container
        this.m_RecipeContainer.removeChildren()

        if (recipeName === undefined) return

        const item = FD.items[recipeName]
        if (item && item.subgroup === 'creative') {
            this.m_RecipeLabel.text = `[CREATIVE] - ${localisedName(item)}`
        }

        const recipe = FD.recipes[recipeName]
        if (recipe === undefined) return
        this.m_RecipeLabel.text = localisedName(recipe)

        F.CreateRecipe(
            this.m_RecipeContainer,
            0,
            0,
            recipeIngredients(recipe),
            recipeResults(recipe),
            recipe.energy_required
        )
    }
}
