import G from '../common/globals'
import { Dialog } from './controls/Dialog'
import { TextInput } from './controls/TextInput'
import { addDescribedButton, ROW_BUTTON_HEIGHT } from './controls/DescribedButton'

// Exported for tests - tests/tools-panel.spec.ts and tests/quick-actions.spec.ts
// both used to carry their own hand-copied version of this layout as bare
// literals (#242 review), which a change here could silently desync from
// either without anything failing at the source of the change.
export const WIDTH = 320
export const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const ROW_Y = FIELD_Y + FIELD_HEIGHT + PADDING
const ROW_HEIGHT = 38
// Wider than the 2-3px between rows in the same group, so Paste - a field
// operation, not a blueprint one - reads as set apart from Replace/Append
// rather than a third option alongside them.
const GROUP_GAP = 14
export const REPLACE_Y = ROW_Y + ROW_HEIGHT + GROUP_GAP
export const APPEND_Y = REPLACE_Y + ROW_HEIGHT
const HEIGHT = APPEND_Y + ROW_BUTTON_HEIGHT + PADDING

/** ImportDialog's and ExportDialog's textarea placeholders - the only thing
 * that tells their otherwise identically styled `<textarea>` elements apart
 * in the DOM, which is what tests/helpers/dialog-textareas.ts keys on. */
export const PLACEHOLDER = 'Paste a blueprint string here...'

/**
 * The game's own import-string field colour - sampled from a screenshot of
 * it, since nothing in `style.ts` names this shade and every other
 * TextInput in the editor shares one background regardless of what it holds.
 */
const IMPORT_FIELD_COLOR = 0xf0d9ab

/**
 * A textarea alternative to ToolsPanel's one-click import buttons, for a
 * browser that blocks `navigator.clipboard`, or a string being hand-edited
 * rather than pasted whole.
 *
 * Paste only fills the field - it's the one action here that doesn't touch
 * the loaded blueprint, unlike Replace and Append, which both read the same
 * textarea but do very different things to it - one throws it away, the
 * other keeps it - so each of those three gets its own line of description
 * rather than trusting a button label alone to carry the distinction.
 */
export class ImportDialog extends Dialog {
    private readonly m_TextInput: TextInput

    public constructor() {
        super(WIDTH, HEIGHT, 'Import')

        this.m_TextInput = new TextInput(
            G.app.renderer,
            WIDTH - PADDING * 2,
            '',
            // No cap - a blueprint string has no honest upper bound, and the
            // corpus's largest (2.4 MB) already exceeds a hardcoded 1 MiB
            // this field used to carry, which silently truncated it on paste.
            undefined,
            false,
            true,
            FIELD_HEIGHT,
            IMPORT_FIELD_COLOR
        )
        this.m_TextInput.placeholder = PLACEHOLDER
        this.m_TextInput.position.set(PADDING, FIELD_Y)
        this.addChild(this.m_TextInput)

        /*
            Escape does not otherwise reach this dialog once the textarea has
            focus: Editor.ts's own keydown listener drops every key while an
            <input>/<textarea> is the event target, so the app-level
            `closeWindow` action (and `Dialog.closeLast()` behind it) never
            runs, and Dialog itself draws no close button. Without this, the
            only way out of the dialog's own primary flow - paste a string,
            change your mind - is clicking the ToolsPanel slot again or
            clicking the canvas first to blur.
        */
        this.m_TextInput.htmlInput.addEventListener('keydown', e => {
            if (e instanceof KeyboardEvent && e.key === 'Escape') this.close()
        })

        addDescribedButton(
            this,
            PADDING,
            ROW_Y,
            WIDTH,
            'Paste',
            "Fills the field above with the clipboard's contents.",
            () => {
                G.quickActions
                    .readClipboardText()
                    .then(source => {
                        this.m_TextInput.text = source
                    })
                    .catch((error: unknown) => {
                        G.logger({ text: String(error), type: 'error' })
                    })
            }
        )

        addDescribedButton(
            this,
            PADDING,
            REPLACE_Y,
            WIDTH,
            'Replace',
            'Replaces the whole blueprint with the one above.',
            () => this.runImport(G.quickActions.importReplace)
        )

        addDescribedButton(
            this,
            PADDING,
            APPEND_Y,
            WIDTH,
            'Append',
            'Allows to add the one above on top of the current blueprint.',
            () => this.runImport(G.quickActions.importAppend)
        )
    }

    /**
     * Shared by Replace and Append: guards the empty field up front rather
     * than handing it to `action`, and closes only once `action` actually
     * succeeds. `action` used to run and this dialog close in the same
     * synchronous breath, before the async import chain it kicked off could
     * even fail - so a bad string took the user's hand-edited text down
     * with it, which is exactly the case this dialog's own class doc names
     * as its reason to exist. The empty case was worse: an empty field
     * reached `getBlueprintOrBookFromSource('')`, which fell past the
     * `DATA[0] === '0'` branch into `new URL('https://')` and threw -
     * reported as "Invalid URL" rather than anything naming the real
     * problem, which is that there was nothing to import.
     *
     * That last throw is gone as of issue #298. The diagnosis above was
     * right and the guard landed one level too high to act on it: two other
     * callers reach the same function with an empty string and neither
     * passes through here, so `getBlueprintOrBookFromSource` now rejects an
     * empty source itself with `EmptyBlueprintStringError`. This check is
     * therefore no longer what stands between a blank field and a
     * `TypeError`, and it stays for a smaller reason - "Paste a blueprint
     * string first." names the field the user is looking at, where the
     * function can only say there was nothing to import.
     */
    private runImport(action: (source: string) => Promise<boolean>): void {
        const text = this.m_TextInput.text
        if (text.trim() === '') {
            G.logger({ text: 'Paste a blueprint string first.', type: 'warning' })
            return
        }

        action(text)
            .then(success => {
                // The dialog may already be gone by the time this resolves -
                // closed by Escape, or by the ToolsPanel slot toggling it
                // again - and Dialog.close() is not safe to call twice.
                if (success && Dialog.isOpen(this)) this.close()
            })
            .catch(() => {
                // action() (importReplace/importAppend) already reports its
                // own failure - see QuickActions' doc comment - so nothing
                // reaches here in practice; kept as a backstop against a
                // future implementation that lets a rejection through
                // instead of resolving false.
            })
    }
}
