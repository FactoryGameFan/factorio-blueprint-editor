import { Text, TextStyle } from 'pixi.js'
import G from '../common/globals'
import { Dialog } from './controls/Dialog'
import { TextInput } from './controls/TextInput'
import { Button } from './controls/Button'
import { colors, styles } from './style'

const WIDTH = 320
const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const ROW_Y = FIELD_Y + FIELD_HEIGHT + PADDING
const ROW_HEIGHT = 38
const ROW_BUTTON_WIDTH = 80
const ROW_BUTTON_HEIGHT = 28
const ROW_COUNT = 3
const HEIGHT = ROW_Y + ROW_HEIGHT * (ROW_COUNT - 1) + ROW_BUTTON_HEIGHT + PADDING

const descriptionStyle = new TextStyle({
    fill: colors.text.normal,
    fontFamily: styles.dialog.label.fontFamily,
    fontWeight: '300',
    fontSize: 12,
    wordWrap: true,
    wordWrapWidth: WIDTH - PADDING * 2 - ROW_BUTTON_WIDTH - 10,
})

function createTextButton(label: string, onClick: () => void): Button<undefined> {
    const button = new Button<undefined>(undefined, ROW_BUTTON_WIDTH, ROW_BUTTON_HEIGHT)
    const text = new Text({ text: label, style: styles.controls.checkbox })
    text.anchor.set(0.5)
    button.content = text
    button.on('pointerdown', e => {
        if (e.button === 0) onClick()
    })
    return button
}

/**
 * A textarea alternative to the WiresPanel one-click buttons, for a blueprint
 * string that has to be seen or edited rather than round-tripped straight
 * through the OS clipboard - a browser that blocks `navigator.clipboard`, or
 * a string being hand-edited rather than pasted whole.
 *
 * The two import buttons both read the same textarea, but do very different
 * things to the loaded blueprint - one throws it away, the other keeps it -
 * so each gets its own line of description rather than trusting the button
 * label alone to carry that distinction.
 */
export class ImportExportDialog extends Dialog {
    private readonly m_TextInput: TextInput

    public constructor() {
        super(WIDTH, HEIGHT, 'Import / Export')

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

        this.addRow(ROW_Y, 'Replace', 'Replaces the whole blueprint with the one above.', () => {
            G.quickActions.importReplace(this.m_TextInput.text)
            this.close()
        })

        this.addRow(
            ROW_Y + ROW_HEIGHT,
            'Append',
            'Adds the one above on top of the current blueprint.',
            () => {
                G.quickActions.importAppend(this.m_TextInput.text)
                this.close()
            }
        )

        this.addRow(
            ROW_Y + ROW_HEIGHT * 2,
            'Export',
            "Fills the field above with the current blueprint's string.",
            () => {
                G.quickActions
                    .encodeCurrent()
                    .then(source => {
                        this.m_TextInput.text = source ?? ''
                    })
                    .catch((error: unknown) => {
                        G.logger({ text: String(error), type: 'error' })
                    })
            }
        )
    }

    private addRow(y: number, label: string, description: string, onClick: () => void): void {
        const button = createTextButton(label, onClick)
        button.position.set(PADDING, y)
        this.addChild(button)

        const text = new Text({ text: description, style: descriptionStyle })
        text.position.set(
            PADDING + ROW_BUTTON_WIDTH + 10,
            y + (ROW_BUTTON_HEIGHT - text.height) / 2
        )
        this.addChild(text)
    }
}
