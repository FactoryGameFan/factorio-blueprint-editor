import { Container, isMobile } from 'pixi.js'
import { Entity } from '../core/Entity'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { EntityInfoPanel } from './EntityInfoPanel'
import { InventoryDialog } from './InventoryDialog'
import { ImportExportDialog } from './ImportExportDialog'
import { WiresPanel } from './WiresPanel'
import { createEditor } from './editors/factory'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    private wiresPanel: WiresPanel
    private entityInfoPanel: EntityInfoPanel
    private dialogsContainer: Container
    private paintIconContainer: Container
    private importExportDialog: ImportExportDialog | undefined

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.wiresPanel = new WiresPanel()
        this.entityInfoPanel = new EntityInfoPanel()
        this.dialogsContainer = new Container()
        this.paintIconContainer = new Container()

        this.addChild(
            this.debugContainer,
            this.entityInfoPanel,
            this.dialogsContainer,
            this.paintIconContainer
        )

        if (!isMobile.any) {
            this.addChild(this.quickbarPanel, this.wiresPanel)
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

    /**
     * Opens ImportExportDialog, or closes it if it is already open - the
     * WiresPanel button that reaches this is a single toggle, not a spawner,
     * so a second click has to answer "close" rather than stacking a second
     * copy on top of the first.
     */
    public toggleImportExportDialog(): void {
        if (this.importExportDialog) {
            this.importExportDialog.close()
            return
        }

        this.importExportDialog = new ImportExportDialog()
        this.importExportDialog.on('close', () => {
            this.importExportDialog = undefined
        })
        this.dialogsContainer.addChild(this.importExportDialog)
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

    // public changeQuickbarRows(rows: number): void {
    //     const itemNames = this.quickbarPanel.serialize()
    //     this.quickbarPanel.destroy()
    //     this.quickbarPanel = new QuickbarContainer(rows, itemNames)

    //     const index = this.getChildIndex(this.quickbarPanel)
    //     this.addChildAt(this.quickbarPanel, index)
    // }
}
