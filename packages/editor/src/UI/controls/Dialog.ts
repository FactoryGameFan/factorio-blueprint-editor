import { Text } from 'pixi.js'
import G from '../../common/globals'
import { colors, styles } from '../style'
import { Panel } from './Panel'

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

        /*
            Hand the keyboard focus back to the canvas whenever nothing else
            holds it.

            `destroy()` above takes any TextInput this dialog held with it,
            and `TextInput._onRemoved` removes that <input> from
            document.body - removing the focused element resets
            `document.activeElement` to <body>, and nothing else in the app
            ever focuses the canvas back (TextInput's own two calls are the
            only other `.focus()` in the package). Both clipboard listeners in
            packages/website/src/index.ts require the canvas to be holding the
            focus, so Ctrl+C and Ctrl+V went silently dead - no toast, no
            error - from the moment any dialog with a field had been open
            until the user clicked the canvas (#242 review). Described rather
            than quoted, because that condition has since grown a second half
            (issue #279) and a copy of it here would go stale without anyone
            opening this file.

            <body> is the whole condition, and reading it is what separates
            "the field that held the focus was just destroyed" from
            "something else still holds it". Note it cannot separate either of
            those from "nothing held the focus to begin with", and does not
            try to: dragging the BP Book Index *slider* rather than typing in
            its box leaves <body> focused, because dat.gui blurs on mousedown
            and its track is a plain <div>, and an InventoryDialog owns no
            <input> at all, so closing one can never orphan anything. Both
            reach a true condition here and both get a focused canvas, which
            is the right answer for them anyway. So this is "claim the focus
            when nothing else wants it", not "detect that I orphaned it" -
            the subject line of the commit that introduced it says the latter
            and overstates what the check can see.

            An unconditional call took the focus off a live element: the
            settings pane's BP Book Index box
            steps on ArrowUp through `changeBookIndex` ->
            `Editor.loadBlueprint` -> `Dialog.closeAll()`, so with any dialog
            open the first arrow closed it and this pulled the focus off the
            <input> the user was still in. The second arrow then reached the
            editor's keybinds instead of the box - measured 0 -> 1 -> 1
            against the 0 -> 1 -> 2 with no dialog open (#242 review, and
            tests/settings-pane-book-index.spec.ts, which is also the first
            coverage those arrow keys have had).

            Deliberately not also conditional on this being the last dialog.
            An earlier version was, on the grounds that a surviving dialog's
            field is what the keyboard should be talking to - which is not
            true of this code: only ExportDialog focuses its own field
            (`ExportDialog.ts`), ImportDialog never does. So closing the
            topmost of two left `document.activeElement` on <body> with a
            field on screen and nothing focused, which is the same dead
            keyboard this exists to remove, just with a dialog still open
            (#242 review). Whatever genuinely holds the focus - the surviving
            dialog's field once it is clicked, or a DOM control outside the
            canvas entirely - is not <body>, and so is not touched here.
        */
        if (document.activeElement === document.body) G.app.canvas.focus()
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
