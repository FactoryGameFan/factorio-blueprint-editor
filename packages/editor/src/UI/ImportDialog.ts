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
const HEIGHT = ROW_Y + ROW_HEIGHT + ROW_BUTTON_HEIGHT + PADDING

/**
 * A textarea alternative to ToolsPanel's one-click import buttons, for a
 * browser that blocks `navigator.clipboard`, or a string being hand-edited
 * rather than pasted whole.
 *
 * Replace and Append both read the same textarea but do very different
 * things to the loaded blueprint - one throws it away, the other keeps it -
 * so each gets its own line of description rather than trusting the button
 * label alone to carry that distinction.
 */
export class ImportDialog extends Dialog {
    private readonly m_TextInput: TextInput

    public constructor() {
        super(WIDTH, HEIGHT, 'Import')

        this.m_TextInput = new TextInput(
            G.app.renderer,
            WIDTH - PADDING * 2,
            '',
            2 ** 20,
            false,
            true,
            FIELD_HEIGHT
        )
        this.m_TextInput.placeholder = 'Paste a blueprint string here...'
        this.m_TextInput.position.set(PADDING, FIELD_Y)
        this.addChild(this.m_TextInput)

        addDescribedButton(
            this,
            PADDING,
            ROW_Y,
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
            ROW_Y + ROW_HEIGHT,
            WIDTH,
            'Append',
            'Adds the one above on top of the current blueprint.',
            () => {
                G.quickActions.importAppend(this.m_TextInput.text)
                this.close()
            }
        )
    }
}
