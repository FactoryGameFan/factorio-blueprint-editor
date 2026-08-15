import { Container, Text } from 'pixi.js'
import G from '../../common/globals'
import { colors, styles } from '../style'
import { Panel } from './Panel'
import { TextInput } from './TextInput'

/**
 * Base Dialog for usage whenever a dialog shall be shown to the user
 *
 * Per default the dialog
 *  + is not visible (this.visible = false)
 *  + is interactive (this.eventMode = 'static')
 *  + has interactive children (this.interactiveChildren = true)
 *  + automatically executes 'setDialogPosition()' on Browser Resizing
 */
export abstract class Dialog extends Panel {
    /** Stores all open dialogs */
    protected static s_openDialogs: Dialog[] = []

    public constructor(width: number, height: number, title?: string) {
        super(
            width,
            height,
            colors.dialog.background.color,
            colors.dialog.background.alpha,
            colors.dialog.background.border
        )

        this.visible = true
        this.eventMode = 'static'
        this.interactiveChildren = true

        if (title !== undefined) {
            this.addLabel(12, 10, title, styles.dialog.title)
        }

        Dialog.s_openDialogs.push(this)
        Dialog.updateDOMInputVisibility()
    }

    /**
     * Keeps the DOM fields of covered dialogs off the screen.
     *
     * A TextInput is the one control here that is not drawn with pixi - it
     * appends an <input> to document.body and keeps it positioned over the
     * canvas. Nothing pixi draws can cover it, so a dialog opened on top of
     * another leaves the one underneath showing its text through the new
     * dialog and still answering elementFromPoint, which eats the clicks meant
     * for the dialog above. Measured with the icon picker over Blueprint Info:
     * six fields, one of them visibly printing its text across the picker's
     * slots and five invisible only because their background is none.
     *
     * Topmost rather than "not overlapped" because occlusion is not a question
     * the DOM can answer for canvas content - there is no partial hiding to be
     * had, so the dialog stack decides it.
     */
    private static updateDOMInputVisibility(): void {
        const top = Dialog.s_openDialogs[Dialog.s_openDialogs.length - 1]
        for (const dialog of Dialog.s_openDialogs) {
            Dialog.setDOMInputsVisible(dialog, dialog === top)
        }
    }

    /** Walks the dialog's tree - a TextInput can sit inside a sub-container, as BlueprintAlignment's do. */
    private static setDOMInputsVisible(container: Container, visible: boolean): void {
        for (const child of container.children) {
            if (child instanceof TextInput) child.domVisible = visible
            else if (child instanceof Container) Dialog.setDOMInputsVisible(child, visible)
        }
    }

    /** Closes last open dialog */
    public static closeLast(): void {
        if (Dialog.anyOpen()) {
            Dialog.s_openDialogs[Dialog.s_openDialogs.length - 1].close()
        }
    }

    /** Closes all open dialogs */
    public static closeAll(): void {
        for (const d of Dialog.s_openDialogs) {
            d.close()
        }
    }

    /** @returns True if there is at least one dialog open */
    public static anyOpen(): boolean {
        return Dialog.s_openDialogs.length > 0
    }

    public static isOpen<T extends Dialog>(dialog: T): boolean {
        return !!Dialog.s_openDialogs.find(d => d === dialog)
    }

    /** Capitalize String */
    protected static capitalize(text: string): string {
        return text
            .split('_')
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ')
    }

    /** Automatically sets position of dialog to center screen */
    protected override setPosition(): void {
        this.position.set(
            G.app.screen.width / 2 - this.width / 2,
            G.app.screen.height / 2 - this.height / 2
        )
    }

    /** Close Dialog */
    public close(): void {
        Dialog.s_openDialogs = Dialog.s_openDialogs.filter(d => d !== this)

        this.emit('close')
        this.destroy()
        // The dialog underneath is the topmost one again and gets its fields
        // back. Runs after destroy so the closing dialog is gone from the tree
        // rather than being handed a visibility it will never render.
        Dialog.updateDOMInputVisibility()
    }

    /**
     * Add Label to Dialog
     * @description Defined in base dialog class so extensions of dialog can use it
     * @param x - Horizontal position of label from top left corner
     * @param y - Vertical position of label from top left corner
     * @param text - Text for label
     * @param style - Style of label
     * @returns Reference to Text for further usage
     */
    protected addLabel(x = 140, y = 56, text = 'Recipe:', style = styles.dialog.label): Text {
        const label = new Text({ text, style })
        label.position.set(x, y)
        this.addChild(label)

        // Return label in case extension wants to use it
        return label
    }
}
