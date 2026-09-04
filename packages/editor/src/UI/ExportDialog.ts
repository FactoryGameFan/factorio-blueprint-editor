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

    A `let` rather than a `const` only so `setReencodeDebounceMsForTests` can
    widen it. tests/quick-actions.spec.ts needs a window longer than any
    round-trip it makes so the re-encode cannot fire on its own between two
    edits it is checking coalesce (#313); nothing in the app reassigns this.
*/
let reencodeDebounceMs = 500

/** See `reencodeDebounceMs`. Test-only; the app never calls this. */
export function setReencodeDebounceMsForTests(ms: number): void {
    reencodeDebounceMs = ms
}

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
    // `performance.now()` timestamp the next debounced re-encode is due at, or
    // undefined when none is pending. One value, pushed forward on every
    // further change - see `changeTick`.
    private m_ReencodeDueAt: number | undefined
    private m_EncodeCount = 0

    /**
     * How many times `refreshText` has been *called* this dialog's lifetime
     * - not how many times the `serialize` + `deflate` it starts has
     * actually finished, which this used to claim (#242 review):
     * `m_EncodeCount += 1` is `refreshText`'s first line, so it moves
     * synchronously, before `encodeCurrent()`'s promise resolves. That is
     * also why a caller does not need to poll for the value right after
     * `openExportDialog()` returns - it is already whatever it will be, the
     * constructor having called `refreshText` synchronously too.
     *
     * The one thing that proves the change-detection in the constructor is
     * doing its job rather than quietly falling back to encoding on every
     * frame, which no assertion on the field's own text could show (a
     * re-encode of unchanged content is textually identical to not
     * encoding at all). See tests/quick-actions.spec.ts.
     */
    public get encodeCount(): number {
        return this.m_EncodeCount
    }

    /**
     * Whether a debounced re-encode is waiting for its window to elapse. See
     * tests/quick-actions.spec.ts, which reads this to tell "the burst pushed
     * the same pending encode out again" from "a second one got scheduled".
     */
    public get reencodePending(): boolean {
        return this.m_ReencodeDueAt !== undefined
    }

    /**
     * Runs a pending debounced re-encode now instead of waiting out the rest
     * of its window, and answers whether there was one to run. For
     * tests/quick-actions.spec.ts: it widens the window past any wall-clock
     * slop so the pending re-encode cannot mature on its own mid-test (#313),
     * makes its burst of edits, then calls this to observe the single
     * coalesced result.
     */
    public flushPendingReencode(): boolean {
        if (this.m_ReencodeDueAt === undefined) return false
        this.m_ReencodeDueAt = undefined
        this.refreshText({ select: false })
        return true
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
            transaction in the burst. The debounce is one due-time that every
            further change pushes forward, checked against `performance.now()`
            on the same frame poll - not a `setTimeout` per change. So a burst
            collapses to a single encode by construction: there is no way to
            leave a second timer running, which the previous `clearTimeout` +
            reschedule had to get right and which nothing could observe
            without racing the very window it was measuring (#313). Removing
            the frame listener on destroy is enough to stop it firing against
            a closed dialog. Never re-selects on this path: the field is
            read-only but still click-selectable, and re-selecting the whole
            text out from under a user mid-way through selecting part of it by
            hand would fight them - see `select: true` only ever being passed
            on the initial open above.
        */
        const changeTick = (): void => {
            const revision = G.bp.history.revision
            if (revision !== this.m_LastSeenRevision) {
                this.m_LastSeenRevision = revision
                this.m_ReencodeDueAt = performance.now() + reencodeDebounceMs
                return
            }
            if (this.m_ReencodeDueAt !== undefined && performance.now() >= this.m_ReencodeDueAt) {
                this.m_ReencodeDueAt = undefined
                this.refreshText({ select: false })
            }
        }
        G.app.ticker.add(changeTick)
        this.once('destroyed', () => G.app.ticker.remove(changeTick))
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
