import { Container, FederatedPointerEvent } from 'pixi.js'
import G from '../common/globals'
import { Button } from './controls/Button'
import F from './controls/functions'

/**
 * Persistent top-right button that opens BlueprintInfoEditor.
 *
 * Positioned to the left of EntityInfoPanel's own 270px width rather than
 * flush in the corner, since EntityInfoPanel docks there too (whenever an
 * entity is hovered) and the two would otherwise overlap.
 */
export class BlueprintInfoButton extends Container {
    private readonly m_Button: Button<undefined>

    public constructor() {
        super()

        this.m_Button = new Button<undefined>(undefined, 36, 36)
        this.m_Button.content = F.CreateIcon('blueprint', 24)
        this.m_Button.on('pointerdown', this.onPointerDown)
        this.addChild(this.m_Button)

        this.setPosition()
        window.addEventListener('resize', this.setPosition)
    }

    public override destroy(): void {
        window.removeEventListener('resize', this.setPosition)
        super.destroy({ children: true })
    }

    private readonly setPosition = (): void => {
        this.position.set(G.app.screen.width - 270 - 12 - 36, 6)
    }

    private readonly onPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.toggleBlueprintInfoEditor(G.bp)
        }
    }
}
