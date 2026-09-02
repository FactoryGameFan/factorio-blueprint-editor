import { Container, Sprite } from 'pixi.js'
import { colors } from '../style'
import F from './functions'

/** Panel */
/**
 * Base Panel for usage whenever a permanent panel shall be shown to the user
 *
 * Per default the panel
 *  + is visible (this.visible = true)
 *  + is interactive (this.eventMode = 'static')
 *  + has interactive children (this.interactiveChildren = true)
 *  + automatically calls 'setPosition()' on Browser Resizing
 *  + does not automatically set its position (hint: override setPosition())
 */
export abstract class Panel extends Container {
    /** Background Graphic */
    private readonly m_Background: Sprite

    private _setPosition: () => void

    /**
     * Constructor
     *
     * @param width - Width of the Control
     * @param height - Height of the Control
     * @param background - Background Color of the Control
     * @param alpha - Background Alpha of the Control (1...no transparency)
     * @param border - Border Width of the Control (0...no border)
     */
    public constructor(
        width: number,
        height: number,
        background: number = colors.controls.panel.background.color,
        alpha: number = colors.controls.panel.background.alpha,
        border: number = colors.controls.panel.background.border
    ) {
        super()

        this.eventMode = 'static'
        this.interactiveChildren = true

        this.m_Background = F.DrawRectangle(width, height, background, alpha, border, false)
        this.addChild(this.m_Background)

        this._setPosition = () => this.setPosition()

        /*
            Registered when the panel joins the display tree, not here.

            This used to be a bare `window.addEventListener` in the constructor,
            with `destroy()` below as the only thing that ever took it off again.
            A constructor is the one place a panel cannot safely claim the
            window from: `super()` runs before any subclass body, so a subclass
            that throws afterwards leaves a listener for a panel that was never
            shown and that nothing holds a reference to. It cannot be destroyed,
            because nothing has it - so the listener stays on `window` for the
            life of the page, keeps the half-built panel and its whole subtree
            alive, and calls `setPosition()` on it at every resize (issue #287).

            Exactly the shape of #280 one constructor lower down:
            `Editor extends Dialog extends Panel`, so every entity editor is a
            `Panel` and this is the first constructor to run. #280's own
            measured path - `DisplayPanelEditor` drawing a planet icon - threw
            well after this line, and #286 records the same for `Recipe.ts`.

            `added`/`removed` rather than `once`, because a panel may leave the
            tree and come back, and the pair has to stay balanced. Re-adding is
            safe: the DOM ignores an identical (type, listener) pair, and
            `_setPosition` is one closure per panel.

            `destroy()` still removes it as well. `removed` covers a panel that
            is destroyed while in the tree, which is all of them today, but a
            panel destroyed after being detached would emit nothing - and
            removing a listener that is not registered is a no-op, so keeping
            both costs nothing and does not depend on that staying true.
        */
        this.on('added', () => window.addEventListener('resize', this._setPosition))
        this.on('removed', () => window.removeEventListener('resize', this._setPosition))

        this.setPosition()
    }

    public destroy(): void {
        window.removeEventListener('resize', this._setPosition)
        super.destroy({ children: true })
    }

    /** Width of the Control */
    public get width(): number {
        return this.m_Background.width
    }

    /** Height of the Control */
    public get height(): number {
        return this.m_Background.height
    }

    /** Called by when the browser is resized */
    protected abstract setPosition(): void
}
