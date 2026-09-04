import { Container, FederatedPointerEvent } from 'pixi.js'
import G from '../common/globals'
import { Button } from './controls/Button'
import F from './controls/functions'

/**
 * Persistent top-left button that opens BlueprintInfoEditor.
 *
 * Positioned just right of the website's own DOM corner overlay (the FBE logo
 * plus the Discord/Github buttons in packages/website/index.html), which is
 * 140px wide and sits at the fixed (0, 0) corner - a canvas-drawn button at
 * that x would render underneath it. Left rather than right avoids
 * EntityInfoPanel instead, which docks flush against the right edge whenever
 * an entity is hovered.
 */
export class BlueprintInfoButton extends Container {
    private readonly m_Button: Button<undefined>

    public constructor() {
        super()

        this.m_Button = new Button<undefined>(undefined, 36, 36)
        this.m_Button.content = F.CreateIcon('blueprint', 24)
        this.m_Button.on('pointerdown', this.onPointerDown)
        this.addChild(this.m_Button)

        // Independent of screen size, unlike a right-docked position would be.
        this.position.set(152, 6)
    }

    private readonly onPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.toggleBlueprintInfoEditor(G.bp)
        }
    }
}
