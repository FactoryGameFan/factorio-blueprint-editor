import { Container, FederatedPointerEvent } from 'pixi.js'
import G from '../common/globals'
import { Button } from './controls/Button'
import F from './controls/functions'

/**
 * Persistent top-left button that opens BookDialog.
 *
 * Positioned just right of the website's own DOM corner overlay (the FBE logo
 * plus the Discord/Github buttons in packages/website/index.html), which is
 * 140px wide and sits at the fixed (0, 0) corner - a canvas-drawn button at
 * that x would render underneath it. Left rather than right avoids
 * EntityInfoPanel instead, which docks flush against the right edge whenever
 * an entity is hovered. A standalone corner button rather than a ToolsPanel
 * slot, since "is a book loaded" is orthogonal to which quick-action panel
 * happens to exist.
 *
 * Visible only while a book is loaded - polls `G.quickActions.getCurrentBook()`
 * from the ticker rather than checking once, since "is a book loaded" changes
 * at runtime (a book replaced by a bare blueprint, or the reverse) with
 * nothing here to be re-constructed and notice it.
 */
export class BookButton extends Container {
    private readonly m_Button: Button<undefined>

    public constructor() {
        super()

        this.m_Button = new Button<undefined>(undefined, 36, 36)
        this.m_Button.content = F.CreateIcon('blueprint-book', 24)
        this.m_Button.on('pointerdown', this.onPointerDown)
        this.addChild(this.m_Button)

        this.position.set(152, 6)
        this.visible = false

        G.app.ticker.add(() => {
            this.visible = G.quickActions.getCurrentBook() !== undefined
        })
    }

    private readonly onPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.toggleBookDialog()
        }
    }
}
