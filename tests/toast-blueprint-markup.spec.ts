import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'

/*
    A blueprint's own strings reach the toast column. The "Skipped N unknown
    entities" warning names the unknown prototypes verbatim, and a blueprint is
    something one person hands to another - a `?source=` link is enough. So the
    toast must render that text as text: with innerHTML it was markup, and an
    entity called `<img src=x onerror=...>` ran script in whoever opened the
    link.

    Through the URL rather than `__fbe_test`, because the URL is the vector. The
    payload is an unknown entity name because that is the shortest path from a
    blueprint string to a toast, but the fix is in the toast, not the warning:
    SafeIcon quotes a blueprint-chosen name the same way, and any future caller
    would too.
*/

/** Current, so no name migration applies - see nameMigrations.ts. */
const VERSION = packVersion(2, 0, 55)

const PAYLOAD = '<img src=x onerror="window.__toastMarkupRan = true">'

test('markup in a blueprint entity name is shown in the toast, not parsed', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const source = encodeBlueprint({
        item: 'blueprint',
        version: VERSION,
        entities: [
            { entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 } },
            { entity_number: 2, name: PAYLOAD, position: { x: 20.5, y: 0.5 } },
        ],
    })
    await page.goto(`/?source=${encodeURIComponent(source)}`)

    const toast = page.locator('.toasts-warning .toasts-text', { hasText: 'unknown entit' })
    await expect(toast).toBeVisible({ timeout: 60_000 })

    // The name is on screen exactly as written, and nothing was made of it.
    await expect(toast).toContainText(PAYLOAD)
    expect(await toast.locator('*').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).__toastMarkupRan)).toBeUndefined()
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a toast still breaks lines where a caller asks for one', async ({ page }) => {
    /*
        The callers that used to write `<br>` now write `\n`, and `.toasts-text`
        is `white-space: pre-line` to honour it. A toast whose text can be
        measured as two lines is the check that the CSS made it to the page:
        without it the newline collapses to a space and the span is one line.
    */
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const lines = await page.evaluate(() => {
        const text = document.createElement('span')
        text.className = 'toasts-text'
        text.textContent = 'first\nsecond'
        document.body.appendChild(text)
        const single = document.createElement('span')
        single.className = 'toasts-text'
        single.textContent = 'first second'
        document.body.appendChild(single)
        return text.getBoundingClientRect().height / single.getBoundingClientRect().height
    })
    expect(lines).toBeGreaterThan(1.5)
})
