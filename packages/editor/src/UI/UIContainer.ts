import { Container, isMobile } from 'pixi.js'
import { Entity } from '../core/Entity'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { EntityInfoPanel } from './EntityInfoPanel'
import { InventoryDialog } from './InventoryDialog'
import { WiresPanel } from './WiresPanel'
import { BookButton } from './BookButton'
import { BookDialog } from './BookDialog'
import { createEditor } from './editors/factory'
import G from '../common/globals'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    private wiresPanel: WiresPanel
    private entityInfoPanel: EntityInfoPanel
    private dialogsContainer: Container
    private paintIconContainer: Container
    private bookButton: BookButton
    private bookDialog: BookDialog | undefined

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.wiresPanel = new WiresPanel()
        this.entityInfoPanel = new EntityInfoPanel()
        this.dialogsContainer = new Container()
        this.paintIconContainer = new Container()
        this.bookButton = new BookButton()

        this.addChild(
            this.debugContainer,
            this.entityInfoPanel,
            this.dialogsContainer,
            this.paintIconContainer
        )

        if (!isMobile.any) {
            this.addChild(this.quickbarPanel, this.wiresPanel, this.bookButton)
        }
    }

    /** `undefined` hides the panel, which is what a hover-out sends. */
    public updateEntityInfoPanel(entity: Entity | undefined): void {
        this.entityInfoPanel.updateVisualization(entity)
    }

    public addPaintIcon(icon: Container): void {
        this.paintIconContainer.addChild(icon)
    }

    public set showDebuggingLayer(visible: boolean) {
        this.debugContainer.visible = visible
    }

    public createEditor(entity: Entity): void {
        const editor = createEditor(entity)
        if (editor) {
            this.dialogsContainer.addChild(editor)
        }
    }

    /**
     * Where the topmost open dialog sits, in the client coordinates a synthetic
     * pointer event takes, or undefined when no dialog is open.
     *
     * Same purpose as `BlueprintContainer.toScreen`: the dialogs are drawn with
     * pixi, so nothing outside the canvas can find a control to click, and
     * every dialog positions itself relative to the screen centre. A spec that
     * knows a dialog's own layout constants can locate a control from this.
     * See tests/chest-editor.spec.ts.
     */
    public get topDialogBounds(): { x: number; y: number; width: number; height: number } {
        const dialogs = this.dialogsContainer.children
        const top = dialogs[dialogs.length - 1]
        if (top === undefined) {
            throw new Error('no dialog is open')
        }
        const at = top.toGlobal({ x: 0, y: 0 })
        return { x: at.x, y: at.y, width: top.width, height: top.height }
    }

    /** How many dialogs are open. 0 when the canvas has none. */
    public get openDialogCount(): number {
        return this.dialogsContainer.children.length
    }

    public createInventory(
        title: string | undefined,
        itemsFilter: string[] | undefined,
        selectedCallBack: (selectedItem: string) => void,
        showRecipePanel = true
    ): InventoryDialog {
        const inv = new InventoryDialog(title, itemsFilter, selectedCallBack, showRecipePanel)
        this.dialogsContainer.addChild(inv)
        return inv
    }

    /**
     * Opens BookDialog, or closes it if already open - BookButton's click
     * handler. A no-op when no book is loaded, since the button that reaches
     * this is only visible then anyway.
     */
    public toggleBookDialog(): void {
        if (this.bookDialog) {
            this.bookDialog.close()
            return
        }

        const book = G.quickActions.getCurrentBook()
        if (book === undefined) return

        this.bookDialog = new BookDialog(book)
        this.bookDialog.on('close', () => {
            this.bookDialog = undefined
        })
        this.dialogsContainer.addChild(this.bookDialog)
    }

    // public changeQuickbarRows(rows: number): void {
    //     const itemNames = this.quickbarPanel.serialize()
    //     this.quickbarPanel.destroy()
    //     this.quickbarPanel = new QuickbarContainer(rows, itemNames)

    //     const index = this.getChildIndex(this.quickbarPanel)
    //     this.addChildAt(this.quickbarPanel, index)
    // }
}
