import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import FD, { localisedName, recipeIngredients, recipeResults } from '../core/factorioData'
import G from '../common/globals'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { Button } from './controls/Button'
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

type InventoryItems = Container<Button<Container>>

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

    /** Scrollbar thumb rendered alongside the items viewport */
    private readonly m_ScrollThumb: Graphics

    // Items viewport geometry (matches the layout comment above)
    private static readonly VP_X = 12
    private static readonly VP_Y = 126
    private static readonly VP_W = 380
    private static readonly VP_H = 304
    private static readonly ROW_H = 38

    public constructor(
        title = 'Inventory',
        itemsFilter: string[] | undefined,
        // Not optional: picking an item is the whole point of the dialog, and all
        // five call sites pass one. Optional only made the invocation below a
        // type error, with nothing to do about it that was not a fiction.
        selectedCallBack: (selectedItem: string) => void
    ) {
        super(404, 442, title)

        const D = InventoryDialog

        this.m_InventoryGroups = new Container()
        this.m_InventoryGroups.position.set(12, 46)
        this.addChild(this.m_InventoryGroups)

        this.m_InventoryItems = new Container()
        this.m_InventoryItems.position.set(D.VP_X, D.VP_Y)
        this.addChild(this.m_InventoryItems)

        // Clip the items to a fixed viewport and allow wheel scrolling.
        // Space Age groups contain far more items than fit in the fixed dialog
        // height, so without this the lower rows are hidden with no way to reach them.
        const itemsMask = new Graphics().rect(D.VP_X, D.VP_Y, D.VP_W, D.VP_H).fill(0xffffff)
        this.addChild(itemsMask)
        this.m_InventoryItems.mask = itemsMask
        this.m_InventoryItems.eventMode = 'static'
        this.m_InventoryItems.hitArea = new Rectangle(0, 0, D.VP_W, D.VP_H)

        this.m_ScrollThumb = new Graphics().rect(0, 0, 4, 1).fill({ color: 0xc8c8c8, alpha: 0.6 })
        this.m_ScrollThumb.visible = false
        this.addChild(this.m_ScrollThumb)

        const onItemsWheel = (e: WheelEvent): void => {
            const active = this.m_InventoryItems.children.find(c => c.visible)
            if (!active) return
            const contentH = this.m_ContentHeights.get(active) ?? 0
            const maxScroll = Math.max(0, contentH - D.VP_H)
            if (maxScroll <= 0) return
            e.preventDefault()
            e.stopPropagation()
            active.y = Math.min(0, Math.max(-maxScroll, active.y - Math.sign(e.deltaY) * D.ROW_H))
            this.refreshScrollbar()
        }
        this.m_InventoryItems.addEventListener('wheel', onItemsWheel, { passive: false })
        this.on('destroyed', () => {
            this.m_InventoryItems.removeEventListener('wheel', onItemsWheel)
        })

        let groupIndex = 0
        for (const group of FD.inventoryLayout) {
            // Make creative entities available only in the main inventory
            if (group.name === 'creative' && itemsFilter !== undefined) {
                continue
            }

            const inventoryGroupItems = new Container<Button<Container>>()
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

                    const button = new Button<Container>(36, 36)
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

                const button = new Button<Container<Button<Container>>>(68, 68, 3)
                button.active = groupIndex === 0
                button.position.set(groupIndex * 70, 0)
                button.content = F.CreateIcon(group.name, group.name === 'creative' ? 32 : 64)
                button.data = inventoryGroupItems
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
                                inventoryGroupItems.visible = inventoryGroupItems === buttonData
                                inventoryGroupItems.interactiveChildren =
                                    inventoryGroupItems === buttonData
                            }
                            this.refreshScrollbar()
                        }
                    }
                })

                this.m_InventoryGroups.addChild(button)

                groupIndex += 1
            }
        }

        const recipePanel = new Container()
        recipePanel.position.set(0, 442)
        this.addChild(recipePanel)

        const recipeBackground = F.DrawRectangle(
            404,
            78,
            colors.dialog.background.color,
            colors.dialog.background.alpha,
            colors.dialog.background.border
        )
        recipeBackground.position.set(0, 0)
        recipePanel.addChild(recipeBackground)

        this.m_RecipeLabel = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeLabel.position.set(12, 10)
        recipePanel.addChild(this.m_RecipeLabel)

        this.m_RecipeContainer = new Container()
        this.m_RecipeContainer.position.set(12, 36)
        recipePanel.addChild(this.m_RecipeContainer)

        this.refreshScrollbar()
    }

    /** Update the scrollbar thumb to reflect the active group's scroll position */
    private refreshScrollbar(): void {
        const D = InventoryDialog
        const active = this.m_InventoryItems.children.find(c => c.visible)
        const contentH = active ? (this.m_ContentHeights.get(active) ?? 0) : 0
        const maxScroll = Math.max(0, contentH - D.VP_H)
        if (!active || maxScroll <= 0) {
            this.m_ScrollThumb.visible = false
            return
        }
        const thumbH = Math.max(24, (D.VP_H * D.VP_H) / contentH)
        const scroll = -active.y
        const thumbY = D.VP_Y + (scroll / maxScroll) * (D.VP_H - thumbH)
        this.m_ScrollThumb.visible = true
        this.m_ScrollThumb.height = thumbH
        this.m_ScrollThumb.position.set(D.VP_X + D.VP_W, thumbY)
    }

    /** Override automatically set position of dialog due to additional area for recipe */
    protected override setPosition(): void {
        this.position.set(
            G.app.screen.width / 2 - this.width / 2,
            G.app.screen.height / 2 - 520 / 2
        )
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
