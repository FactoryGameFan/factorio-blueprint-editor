import { Container, isMobile } from 'pixi.js'
import { Entity } from '../core/Entity'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { EntityInfoPanel } from './EntityInfoPanel'
import { InventoryDialog } from './InventoryDialog'
import { ImportDialog } from './ImportDialog'
import { ExportDialog } from './ExportDialog'
import { ToolsPanel } from './ToolsPanel'
import { createEditor } from './editors/factory'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    private toolsPanel: ToolsPanel
    private entityInfoPanel: EntityInfoPanel
    private dialogsContainer: Container
    private paintIconContainer: Container
    private importDialog: ImportDialog | undefined
    private exportDialog: ExportDialog | undefined

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.toolsPanel = new ToolsPanel()
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
            this.addChild(this.quickbarPanel, this.toolsPanel)
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
     * Where ToolsPanel sits, in the same client coordinates `topDialogBounds`
     * answers in - for tests/tools-panel.spec.ts, which needs to check it
     * stays on screen at a narrow viewport width rather than running off the
     * right edge (ToolsPanel.setPosition's own clamp).
     */
    public get toolsPanelBounds(): { x: number; y: number; width: number; height: number } {
        const at = this.toolsPanel.toGlobal({ x: 0, y: 0 })
        return { x: at.x, y: at.y, width: this.toolsPanel.width, height: this.toolsPanel.height }
    }

    /**
     * Opens ImportDialog, or closes it if it is already open - the ToolsPanel
     * button that reaches this is a single toggle, not a spawner, so a
     * second click has to answer "close" rather than stacking a second copy
     * on top of the first.
     */
    public toggleImportDialog(): void {
        if (this.importDialog) {
            this.importDialog.close()
            return
        }

        this.importDialog = new ImportDialog()
        this.importDialog.on('close', () => {
            this.importDialog = undefined
        })
        this.dialogsContainer.addChild(this.importDialog)
    }

    /** Same as `toggleImportDialog`, for ExportDialog. */
    public toggleExportDialog(): void {
        if (this.exportDialog) {
            this.exportDialog.close()
            return
        }

        this.exportDialog = new ExportDialog()
        this.exportDialog.on('close', () => {
            this.exportDialog = undefined
        })
        this.dialogsContainer.addChild(this.exportDialog)
    }

    /** `ExportDialog.encodeCount` for the currently open one, or undefined
     * when none is open - see that getter's own doc comment. */
    public get exportEncodeCount(): number | undefined {
        return this.exportDialog?.encodeCount
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
