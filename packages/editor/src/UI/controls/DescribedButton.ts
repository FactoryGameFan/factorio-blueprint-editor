import { Container, Text, TextStyle } from 'pixi.js'
import { Button } from './Button'
import { colors, styles } from '../style'

export const ROW_BUTTON_WIDTH = 80
export const ROW_BUTTON_HEIGHT = 28

/**
 * A labeled button plus a short description to its right - the row shape
 * ImportDialog and ExportDialog both use because a button label alone
 * ("Replace"/"Append") doesn't say what happens to the loaded blueprint.
 */
export function addDescribedButton(
    parent: Container,
    x: number,
    y: number,
    dialogWidth: number,
    label: string,
    description: string,
    onClick: () => void
): void {
    const button = new Button<undefined>(undefined, ROW_BUTTON_WIDTH, ROW_BUTTON_HEIGHT)
    const buttonText = new Text({ text: label, style: styles.controls.checkbox })
    buttonText.anchor.set(0.5)
    button.content = buttonText
    button.position.set(x, y)
    button.on('pointerdown', e => {
        if (e.button === 0) onClick()
    })
    parent.addChild(button)

    const descriptionStyle = new TextStyle({
        fill: colors.text.normal,
        fontFamily: styles.dialog.label.fontFamily,
        fontWeight: '300',
        fontSize: 12,
        wordWrap: true,
        wordWrapWidth: dialogWidth - x - ROW_BUTTON_WIDTH - 12 - 10,
    })
    const text = new Text({ text: description, style: descriptionStyle })
    text.position.set(x + ROW_BUTTON_WIDTH + 10, y + (ROW_BUTTON_HEIGHT - text.height) / 2)
    parent.addChild(text)
}
