import { Graphics } from 'pixi.js'
import { colors } from '../style'
import F from './functions'
import { ToggleControl } from './ToggleControl'

/** Base Checkbox */
export class Checkbox extends ToggleControl {
    /** Checkmark Polygon */
    // prettier-ignore
    private static readonly CHECK_POLYGON = [
        8,  8, 12,  8, 16, 12, 20, 12, 24,  8,
       28,  8, 28, 12, 24, 16, 24, 20, 28, 24,
       28, 28, 24, 28, 20, 24, 16, 24, 12, 28,
        8, 28,  8, 24, 12, 20, 12, 16,  8, 12,
        8,  8]

    public constructor(checked = false, text?: string) {
        super(checked, text, Checkbox.drawGraphic, current => !current)
    }

    /**
     * Draw Checkbox Graphic
     * @param checked - Whether the checkbox graphic shall be checked
     * @param hover - Whether the checkbox graphic shall be shown hovered
     */
    private static drawGraphic(checked: boolean, hover: boolean, visible: boolean): Graphics {
        const graphic = new Graphics()
        graphic
            .rect(2, 2, 32, 32)
            .fill(
                F.colorAndAlphaToColorSource(
                    colors.controls.checkbox.background.color,
                    colors.controls.checkbox.background.alpha
                )
            )
            .roundRect(0, 0, 36, 36, 10)
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
                .poly(Checkbox.CHECK_POLYGON)
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
