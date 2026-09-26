import { Container, Graphics, Text } from 'pixi.js'
import G from '../../common/globals'
import { colors, styles } from '../style'

/**
 * The box a bottom bar shows above one of its buttons while the pointer is
 * over it (#505, #509). Add one to the panel, and show it from the button's
 * `pointerover` and hide it from its `pointerout`.
 *
 * One box per panel, reused for every hover. A fresh `Text` per hover would
 * leak: pixi's text listens for changes on its style, which here is the shared
 * `styles.dialog.label`, and does not stop listening when destroyed.
 */
export class HoverText extends Container {
    private readonly background = new Graphics()
    private readonly caption = new Text({ style: styles.dialog.label })
    private owner: Container | undefined

    public constructor() {
        super()
        this.caption.position.set(8, 5)
        this.addChild(this.background, this.caption)
        this.eventMode = 'none'
        this.visible = false
    }

    /** The text on show, or undefined when there is none. */
    public get shown(): string | undefined {
        return this.visible ? this.caption.text : undefined
    }

    /**
     * Shows `text` just above the panel's top edge, with its left edge at `x`
     * in the panel's own coordinates, and kept on screen at a narrow width.
     * Assumes the panel's parent sits at the screen origin, as every bottom
     * bar's does.
     */
    public show(owner: Container, text: string, x: number): void {
        this.caption.text = text

        const width = Math.ceil(this.caption.width) + 16
        const height = Math.ceil(this.caption.height) + 10
        this.background
            .clear()
            .rect(0, 0, width, height)
            .fill(colors.dialog.background.color)
            .stroke({ width: 1, color: colors.controls.button.background.color, alignment: 1 })

        const panelX = this.parent?.x ?? 0
        this.position.set(
            Math.max(-panelX, Math.min(x, G.app.screen.width - panelX - width)),
            -height - 4
        )
        this.visible = true
        this.owner = owner
    }

    /** Hides the text - only if `owner` is the one showing it, when given. */
    public hide(owner?: Container): void {
        // pointerout on one button can arrive after pointerover on the next.
        if (owner !== undefined && this.owner !== owner) return
        this.visible = false
        this.owner = undefined
    }
}
