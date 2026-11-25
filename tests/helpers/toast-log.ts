import type { Page } from '@playwright/test'

/**
 * Every warning and error toast the page shows from now on, as its class and
 * text. Not the info ones: the welcome tip is an info toast that arrives
 * whenever it likes.
 * A second call replaces the first recording.
 */
export async function recordToasts(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __toasts: string[]; __toastWatch?: MutationObserver }
        w.__toastWatch?.disconnect()
        w.__toasts = []
        w.__toastWatch = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue
                    const kind = ['toasts-warning', 'toasts-error'].find(c =>
                        node.classList.contains(c)
                    )
                    if (kind !== undefined) w.__toasts.push(`${kind} | ${node.textContent?.trim()}`)
                }
            }
        })
        w.__toastWatch.observe(document.body, { childList: true, subtree: true })
    })
}
export const toastsSoFar = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)
