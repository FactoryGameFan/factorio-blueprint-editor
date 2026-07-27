type Page = import('@playwright/test').Page

/**
 * The style that stops toasts intercepting pointer input, and nothing else -
 * they still render, so a trace or a screenshot shows what the editor said.
 */
const CSS = '.toasts-container { pointer-events: none !important; }'

/**
 * Stops the toast overlay swallowing clicks meant for the canvas (issue #119).
 *
 * `.toasts-container` is `position: fixed; bottom: 0; right: 0; width: 320px;
 * z-index: 20`, so every toast sits **on top of the editor**, and loading a
 * blueprint raises one that lives for five seconds. A click landing in that
 * column goes to the toast `div` instead of the canvas, pixi never sees a
 * `pointerdown`, and the action behind it never fires. Measured: the failing
 * click's target was `DIV#toast-3.toasts-toast`, not `CANVAS#editor`.
 *
 * That made every pointer-driven spec a coin flip, because the toast animates in
 * - its own bounding box moved between two runs of the same test - so whether a
 * click at a given point was swallowed depended on where the animation had got
 * to. The specs that failed were the ones whose second entity sits furthest
 * right: the pairs 12 and 14 tiles apart, never the 6-tile ones.
 *
 * The failure is silent and looks like a broken setter rather than a lost click,
 * which is what made it expensive: the pasted value is simply absent.
 *
 * **Call this before `page.goto`.** It registers an init script, so it applies to
 * that navigation and every later one, which `addStyleTag` would not - a spec
 * that reloads would lose the suppression and start flaking again.
 *
 * `tests/toast-click-interception.spec.ts` pins both halves: that a toast really
 * does cover the click point, and that this stops it mattering.
 */
export async function suppressToasts(page: Page): Promise<void> {
    await page.addInitScript(css => {
        const ID = 'fbe-test-toast-suppression'

        /*
            The DOMContentLoaded pass is the one that does the work, and the first
            draft did not have it. An init script runs at document start, where
            `document.head` and `document.documentElement` are still null, so the
            append threw, the error went nowhere, and every page came up with no
            suppression at all - measured: the injected style was simply absent
            and `getComputedStyle(container).pointerEvents` was still `auto`.

            A silent no-op in a test helper is the same shape as the bug this
            exists to fix, so both passes stay. The eager one covers a page that is
            somehow already parsed when this runs; removing it alone still passes,
            which is exactly why it is cheap to keep.
        */
        const inject = (): void => {
            if (document.getElementById(ID)) return
            const parent = document.head ?? document.documentElement
            if (!parent) return
            const style = document.createElement('style')
            style.id = ID
            style.textContent = css
            parent.appendChild(style)
        }

        inject()
        document.addEventListener('DOMContentLoaded', inject, { once: true })
    }, CSS)
}
