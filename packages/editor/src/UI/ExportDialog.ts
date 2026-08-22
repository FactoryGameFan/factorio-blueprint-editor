import { UPDATE_PRIORITY } from 'pixi.js'
import G from '../common/globals'
import { Dialog } from './controls/Dialog'
import { TextInput } from './controls/TextInput'

const WIDTH = 320
const PADDING = 12
const FIELD_Y = 40
const FIELD_HEIGHT = 90
const HEIGHT = FIELD_Y + FIELD_HEIGHT + PADDING

/** See `ImportDialog.PLACEHOLDER`'s own doc comment - the same reason, the
 * other dialog. */
export const PLACEHOLDER = 'The current blueprint is empty.'

// How long a re-encode is trusted before another one runs while the dialog
// stays open - see the field's own re-encoding comment below for why this
// exists at all, and why it isn't every tick.
const REENCODE_INTERVAL_MS = 500

/**
 * Shows the loaded blueprint's string in a real textarea - readable and
 * selectable without going through `navigator.clipboard` at all, for a
 * browser that blocks it or a string that needs to be seen rather than
 * silently placed on the clipboard. Pre-filled and pre-selected on open, so
 * a plain Ctrl/Cmd+C is enough once the dialog is up.
 */
export class ExportDialog extends Dialog {
    private readonly m_TextInput: TextInput
    private m_LastEncodeAt = 0

    public constructor() {
        super(WIDTH, HEIGHT, 'Export')

        this.m_TextInput = new TextInput(
            G.app.renderer,
            WIDTH - PADDING * 2,
            '',
            // Same reasoning as ImportDialog's field - no honest cap on a
            // blueprint string's length.
            undefined,
            false,
            true,
            FIELD_HEIGHT
        )
        this.m_TextInput.placeholder = PLACEHOLDER
        this.m_TextInput.position.set(PADDING, FIELD_Y)
        /*
            Read-only, not just conventionally treated as such - this field
            looks exactly like ImportDialog's identically styled one, which
            *does* respond to editing, so leaving this one silently editable
            (and discarding whatever was typed on close) reads as a bug
            rather than a design choice. `disabled` was the other option
            TextInput already exposes, but it also flips the box into the
            DISABLED visual state, which reads as "nothing to see here"
            rather than "here is the string, you can't change it".
        */
        this.m_TextInput.htmlInput.readOnly = true
        this.addChild(this.m_TextInput)

        // Same trap and the same fix as ImportDialog's own Escape listener -
        // see its doc comment.
        this.m_TextInput.htmlInput.addEventListener('keydown', e => {
            if (e instanceof KeyboardEvent && e.key === 'Escape') this.close()
        })

        this.refreshText({ select: true })

        /*
            The field is encoded once at open and never touched again unless
            something reopens it - so a blueprint edited *behind* this dialog
            (it doesn't block the canvas) leaves a stale string on screen with
            nothing indicating it. Re-encoding on every render tick would
            re-run a full serialize + deflate of a multi-megabyte blueprint
            up to 60 times a second for no visible benefit, so this instead
            re-encodes on a plain interval while the dialog is open, which is
            enough to keep the field honest without the per-frame cost -
            cleared on destroy so it can't fire against a closed dialog. Never
            re-selects: the field is read-only but still click-selectable, and
            re-selecting the whole text every interval would fight a user
            mid-way through selecting part of it by hand.
        */
        const reencodeTick = (): void => {
            const now = performance.now()
            if (now - this.m_LastEncodeAt < REENCODE_INTERVAL_MS) return
            this.refreshText({ select: false })
        }
        G.app.ticker.add(reencodeTick)
        this.once('destroyed', () => G.app.ticker.remove(reencodeTick))
    }

    private refreshText({ select }: { select: boolean }): void {
        this.m_LastEncodeAt = performance.now()
        G.quickActions
            .encodeCurrent()
            .then(source => {
                this.m_TextInput.text = source ?? ''
                if (!select) return
                /*
                    `select()` calls `focus()` then `_dom_input.select()`, and
                    both are no-ops on an element the browser has never
                    painted - `TextInput._onAdded` sets `display: none` on
                    `addChild` above, and nothing shows it `block` again until
                    a render tick runs `_updateDOMInput`. This Promise
                    resolves inside a microtask, before that tick, so calling
                    `select()` straight from `.then` selected nothing and
                    left `document.activeElement` on the canvas - Ctrl/Cmd+C
                    then fell through to the `copy` listener's
                    `navigator.clipboard.writeText` instead, defeating the
                    one thing this dialog exists to offer a clipboard-blocked
                    browser. Scheduled at UTILITY priority, below
                    Application's own LOW-priority render step, so it runs
                    once a render (and so `_updateDOMInput`) has actually
                    happened this tick.
                */
                G.app.ticker.addOnce(
                    () => this.m_TextInput.select(),
                    undefined,
                    UPDATE_PRIORITY.UTILITY
                )
            })
            .catch((error: unknown) => {
                G.logger({ text: String(error), type: 'error' })
            })
    }
}
