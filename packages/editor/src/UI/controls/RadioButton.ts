import { Container, Graphics, Text } from 'pixi.js'
import { colors, styles } from '../style'
import F from './functions'

/**
 * A circular on/off indicator, visually distinct from `Checkbox`'s rounded
 * square - for a choice between mutually exclusive options (BlueprintAlignment's
 * Absolute/Relative) rather than an independent toggle. Does not enforce
 * exclusivity itself: same division of responsibility as `Checkbox`, which
 * doesn't know about any other checkbox either - the group is wired up by
 * whoever owns both.
 */
export class RadioButton extends Container {
    private m_Circle: Graphics
    private m_Hover: Graphics
    private m_Checked: boolean

    public constructor(checked = false, text?: string) {
        super()

        this.eventMode = 'static'

        this.m_Checked = checked
        this.m_Circle = RadioButton.drawGraphic(checked, false, true)
        this.m_Hover = RadioButton.drawGraphic(checked, true, false)
        this.addChild(this.m_Circle, this.m_Hover)

        if (text !== undefined) {
            const label = new Text({ text, style: styles.controls.checkbox })
            label.position.set(24, 0)
            this.addChild(label)
        }

        this.on('pointerdown', () => {
            this.checked = true
            this.emit('changed')
        })
        this.on('pointerover', () => {
            this.m_Hover.visible = true
        })
        this.on('pointerout', () => {
            this.m_Hover.visible = false
        })
    }

    private static drawGraphic(checked: boolean, hover: boolean, visible: boolean): Graphics {
        const graphic = new Graphics()
        graphic
            .circle(18, 18, 16)
            .fill(
                F.colorAndAlphaToColorSource(
                    hover
                        ? colors.controls.checkbox.hover.color
                        : colors.controls.checkbox.background.color,
                    hover
                        ? colors.controls.checkbox.hover.alpha
                        : colors.controls.checkbox.background.alpha
                )
            )
            .stroke({
                width: 2,
                color: colors.controls.checkbox.checkmark.color,
                alpha: colors.controls.checkbox.checkmark.alpha,
            })
        if (checked) {
            graphic
                .circle(18, 18, 8)
                .fill(
                    F.colorAndAlphaToColorSource(
                        colors.controls.checkbox.checkmark.color,
                        colors.controls.checkbox.checkmark.alpha
                    )
                )
        }
        graphic.cacheAsTexture(true)
        graphic.scale.set(0.5, 0.5)
        graphic.position.set(0, 0)
        graphic.visible = visible
        return graphic
    }

    public get checked(): boolean {
        return this.m_Checked
    }

    /** Setting `false` directly is legal (a group owner clearing every
     * option before picking one), unlike a click, which can only select. */
    public set checked(checked: boolean) {
        if (this.m_Checked === checked) return
        this.m_Checked = checked

        this.removeChild(this.m_Circle)
        this.m_Circle = RadioButton.drawGraphic(this.m_Checked, false, true)
        this.addChild(this.m_Circle)

        this.removeChild(this.m_Hover)
        this.m_Hover = RadioButton.drawGraphic(this.m_Checked, true, false)
        this.addChild(this.m_Hover)
    }
}
