import { Container, Graphics, Text } from 'pixi.js'
import { styles } from '../style'

/**
 * Shared machinery behind `Checkbox` and `RadioButton` - a boolean on/off
 * indicator with an optional label, redrawn (not just recoloured) on every
 * state change, plus hover feedback. What differs between the two is only
 * the shape drawn (rounded square + checkmark polygon vs circle + circle)
 * and what a click does to the state (toggle vs always-select) - both
 * supplied as plain functions rather than overridden methods, so neither
 * needs `this` before `super()` has run.
 */
export abstract class ToggleControl extends Container {
    private m_Graphic: Graphics
    private m_Hover: Graphics
    private m_Checked: boolean
    private readonly m_DrawGraphic: (checked: boolean, hover: boolean, visible: boolean) => Graphics

    protected constructor(
        checked: boolean,
        text: string | undefined,
        drawGraphic: (checked: boolean, hover: boolean, visible: boolean) => Graphics,
        /** What `checked` becomes on a click, given its current value - `c
         * => !c` for Checkbox, `() => true` for RadioButton (only ever
         * selects; a group owner clears the others by setting `checked`
         * directly, not through a click). */
        nextChecked: (current: boolean) => boolean
    ) {
        super()

        this.eventMode = 'static'
        this.m_DrawGraphic = drawGraphic

        /*
            Drawn here rather than by assigning `this.checked`, which is what
            this used to do (issue #81's Checkbox fix). That setter is
            guarded by `if (this.m_Checked !== checked)` and only ran at all
            because `m_Checked` started undefined, so `undefined !== false`
            was true. Initialising the field without also moving the drawing
            out would make `new Checkbox(false)` - the default, and what
            every caller uses - take the early return and never build either
            graphic, leaving `m_Hover.visible` in the pointerover handler
            below to throw on undefined.
        */
        this.m_Checked = checked
        this.m_Graphic = this.m_DrawGraphic(checked, false, true)
        this.m_Hover = this.m_DrawGraphic(checked, true, false)
        this.addChild(this.m_Graphic, this.m_Hover)

        if (text !== undefined) {
            const label = new Text({ text, style: styles.controls.checkbox })
            label.position.set(24, 0)
            this.addChild(label)
        }

        this.on('pointerdown', () => {
            this.checked = nextChecked(this.checked)
            this.emit('changed')
        })
        this.on('pointerover', () => {
            this.m_Hover.visible = true
        })
        this.on('pointerout', () => {
            this.m_Hover.visible = false
        })
    }

    public get checked(): boolean {
        return this.m_Checked
    }

    public set checked(checked: boolean) {
        if (this.m_Checked === checked) return
        this.m_Checked = checked

        this.removeChild(this.m_Graphic)
        this.m_Graphic = this.m_DrawGraphic(this.m_Checked, false, true)
        this.addChild(this.m_Graphic)

        this.removeChild(this.m_Hover)
        this.m_Hover = this.m_DrawGraphic(this.m_Checked, true, false)
        this.addChild(this.m_Hover)
    }
}
