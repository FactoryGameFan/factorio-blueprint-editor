import { Container, FederatedPointerEvent } from 'pixi.js'
import G from '../common/globals'
import { Button } from './controls/Button'
import F from './controls/functions'

/**
 * Persistent top-left button that opens BookDialog, one slot pitch (36 + 2)
 * right of BlueprintInfoButton so the two read as a row rather than two
 * unrelated corner buttons.
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

        this.position.set(152 + 36 + 2, 6)
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
