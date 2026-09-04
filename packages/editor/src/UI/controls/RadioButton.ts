import { Graphics } from 'pixi.js'
import { colors } from '../style'
import F from './functions'
import { ToggleControl } from './ToggleControl'

/**
 * A circular on/off indicator, visually distinct from `Checkbox`'s rounded
 * square - for a choice between mutually exclusive options (BlueprintAlignment's
 * Absolute/Relative) rather than an independent toggle. Does not enforce
 * exclusivity itself: same division of responsibility as `Checkbox`, which
 * doesn't know about any other checkbox either - the group is wired up by
 * whoever owns both.
 */
export class RadioButton extends ToggleControl {
    public constructor(checked = false, text?: string) {
        super(checked, text, RadioButton.drawGraphic, () => true)
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
}
