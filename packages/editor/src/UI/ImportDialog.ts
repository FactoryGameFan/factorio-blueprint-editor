import G from '../common/globals'
import { Dialog } from './controls/Dialog'
import { TextInput } from './controls/TextInput'
import { addDescribedButton, ROW_BUTTON_HEIGHT } from './controls/DescribedButton'

const WIDTH = 320
const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const ROW_Y = FIELD_Y + FIELD_HEIGHT + PADDING
const ROW_HEIGHT = 38
// Wider than the 2-3px between rows in the same group, so Paste - a field
// operation, not a blueprint one - reads as set apart from Replace/Append
// rather than a third option alongside them.
const GROUP_GAP = 14
const REPLACE_Y = ROW_Y + ROW_HEIGHT + GROUP_GAP
const APPEND_Y = REPLACE_Y + ROW_HEIGHT
const HEIGHT = APPEND_Y + ROW_BUTTON_HEIGHT + PADDING

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
        this.m_TextInput.placeholder = 'Paste a blueprint string here...'
        this.m_TextInput.position.set(PADDING, FIELD_Y)
        this.addChild(this.m_TextInput)

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
            () => {
                G.quickActions.importReplace(this.m_TextInput.text)
                this.close()
            }
        )

        addDescribedButton(
            this,
            PADDING,
            APPEND_Y,
            WIDTH,
            'Append',
            'Allows to add the one above on top of the current blueprint.',
            () => {
                G.quickActions.importAppend(this.m_TextInput.text)
                this.close()
            }
        )
    }
}
