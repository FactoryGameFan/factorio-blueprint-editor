type Page = import('@playwright/test').Page

/**
 * The styles that stop the editor's DOM overlays intercepting pointer input, and
 * nothing else - both still render, so a trace or a screenshot shows what the
 * editor was displaying.
 */
const CSS = `
    .toasts-container { pointer-events: none !important; }
    .dg.main { pointer-events: none !important; }
`

/**
 * Stops the editor's DOM overlays swallowing clicks meant for the canvas -
 * issues #119 and #130.
 *
 * There are two, in opposite corners, and they are the same bug twice. This was
 * `suppressOverlays` and covered only the first; the second then kept
 * `paste-cross-type-settings.spec.ts` intermittent through the #77 batches,
 * presenting as a hover that timed out.
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
 * The second is the dat.gui settings pane, `.dg.main`, which
 * `packages/website/src/index.css` pins at `position: fixed; bottom: 0; left: 0`
 * with `z-index: 5`. It is open by default, since `closed` reads a
 * `localStorage` key a fresh profile does not have. Measured at the 1280x720 the
 * config runs: 320x236 at (0, 484) over a full-viewport canvas, with
 * `elementFromPoint` at its centre answering `DIV.c` rather than `CANVAS#editor`
 * - a dead rectangle over about 8% of the canvas, and unlike a toast it never
 * goes away on its own.
 *
 * `tests/toast-click-interception.spec.ts` and
 * `tests/settings-pane-click-interception.spec.ts` pin both halves of each: that
 * the overlay really does cover the point, and that this stops it mattering.
 */
export async function suppressOverlays(page: Page): Promise<void> {
    await page.addInitScript(css => {
        const ID = 'fbe-test-overlay-suppression'

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
