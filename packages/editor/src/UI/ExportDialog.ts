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

/*
    How long to wait after the blueprint stops changing before re-encoding -
    see the field's own re-encoding comment below for why this exists at
    all. Reused from the interval this replaced (#242 review): a full
    serialize + deflate of the largest corpus blueprint measured at a 300-329
    ms median, so firing on every single history transaction during a burst
    of edits (a drag, a multi-entity delete) would each re-run that cost:
    debouncing collapses a burst to one re-encode after it settles, the same
    way a keystroke-driven text field would.
*/
const REENCODE_DEBOUNCE_MS = 500

/**
 * Shows the loaded blueprint's string in a real textarea - readable and
 * selectable without going through `navigator.clipboard` at all, for a
 * browser that blocks it or a string that needs to be seen rather than
 * silently placed on the clipboard. Pre-filled and pre-selected on open, so
 * a plain Ctrl/Cmd+C is enough once the dialog is up.
 */
export class ExportDialog extends Dialog {
    private readonly m_TextInput: TextInput
    private m_LastSeenRevision = -1
    private m_DebounceTimer: ReturnType<typeof setTimeout> | undefined
    private m_EncodeCount = 0

    /** How many times `refreshText` has actually run a `serialize` +
     * `deflate` this dialog's lifetime - the one thing that proves the
     * change-detection in the constructor is doing its job rather than
     * quietly falling back to encoding on every frame, which no assertion on
     * the field's own text could show (a re-encode of unchanged content is
     * textually identical to not encoding at all). See
     * tests/quick-actions.spec.ts. */
    public get encodeCount(): number {
        return this.m_EncodeCount
    }

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
        this.m_LastSeenRevision = G.bp.history.revision

        /*
            The field is encoded once at open and never touched again unless
            something reopens it - so a blueprint edited *behind* this dialog
            (it doesn't block the canvas) leaves a stale string on screen with
            nothing indicating it. This used to re-encode on a plain 500 ms
            interval regardless of whether anything had changed, which cost a
            full serialize + deflate of the largest corpus blueprint (median
            310 ms, ~62% of the main thread, 19 dropped frames) every cycle
            the dialog sat open, purely idle, being read - measured in the
            #242 review's follow-up pass. `History.revision` answers "did
            anything happen" for the price of an integer compare, so this
            polls that every frame instead (cheap enough to not need its own
            interval) and only starts a re-encode once it actually moves.
            Debounced rather than fired on the first change seen, because a
            burst of history transactions (a drag, a multi-entity delete)
            would otherwise re-run the same expensive encode once per
            transaction in the burst; each further change during the debounce
            window restarts it, so only the settled state after the burst
            gets encoded. Both the frame listener and any pending debounce are
            cleared on destroy so neither can fire against a closed dialog.
            Never re-selects on this path: the field is read-only but still
            click-selectable, and re-selecting the whole text out from under
            a user mid-way through selecting part of it by hand would fight
            them - see `select: true` only ever being passed on the initial
            open above.
        */
        const changeTick = (): void => {
            const revision = G.bp.history.revision
            if (revision === this.m_LastSeenRevision) return
            this.m_LastSeenRevision = revision

            if (this.m_DebounceTimer !== undefined) clearTimeout(this.m_DebounceTimer)
            this.m_DebounceTimer = setTimeout(() => {
                this.m_DebounceTimer = undefined
                this.refreshText({ select: false })
            }, REENCODE_DEBOUNCE_MS)
        }
        G.app.ticker.add(changeTick)
        this.once('destroyed', () => {
            G.app.ticker.remove(changeTick)
            if (this.m_DebounceTimer !== undefined) clearTimeout(this.m_DebounceTimer)
        })
    }

    private refreshText({ select }: { select: boolean }): void {
        this.m_EncodeCount += 1
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
