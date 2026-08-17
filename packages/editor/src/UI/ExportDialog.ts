import G from '../common/globals'
import { Dialog } from './controls/Dialog'
import { TextInput } from './controls/TextInput'

const WIDTH = 320
const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const HEIGHT = FIELD_Y + FIELD_HEIGHT + PADDING

/**
 * Shows the loaded blueprint's string in a real textarea - readable and
 * selectable without going through `navigator.clipboard` at all, for a
 * browser that blocks it or a string that needs to be seen rather than
 * silently placed on the clipboard. Pre-filled and pre-selected on open, so
 * a plain Ctrl/Cmd+C is enough once the dialog is up.
 */
export class ExportDialog extends Dialog {
    private readonly m_TextInput: TextInput

    public constructor() {
        super(WIDTH, HEIGHT, 'Export')

        this.m_TextInput = new TextInput(
            G.app.renderer,
            WIDTH - PADDING * 2,
            '',
            // Same reasoning as ImportDialog's field - no honest cap on a
            // blueprint string's length.
            undefined,
            false,
            true,
            FIELD_HEIGHT
        )
        this.m_TextInput.placeholder = 'The current blueprint is empty.'
        this.m_TextInput.position.set(PADDING, FIELD_Y)
        this.addChild(this.m_TextInput)

        G.quickActions
            .encodeCurrent()
            .then(source => {
                this.m_TextInput.text = source ?? ''
                this.m_TextInput.select()
            })
            .catch((error: unknown) => {
                G.logger({ text: String(error), type: 'error' })
            })
    }
}
