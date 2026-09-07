import { Container, FederatedPointerEvent } from 'pixi.js'
import G from '../common/globals'
import { Button } from './controls/Button'
import F from './controls/functions'

/** Opens the loaded book beside BlueprintInfoButton. Visibility updates on load. */
export class BookButton extends Container {
    private readonly m_Button: Button<undefined>

    public constructor() {
        super()

        this.m_Button = new Button<undefined>(undefined, 36, 36)
        this.m_Button.content = F.SafeIcon('blueprint-book', () =>
            F.CreateIcon('blueprint-book', 24)
        )
        this.m_Button.on('pointerdown', this.onPointerDown)
        this.addChild(this.m_Button)

        this.position.set(194, 6)
        this.visible = false
    }

    private readonly onPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.toggleBookDialog()
        }
    }
}
