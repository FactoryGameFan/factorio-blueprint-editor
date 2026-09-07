import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

const BLUEPRINT = encodeBlueprint({
    item: 'blueprint',
    version: packVersion(2, 0, 55),
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

test('native Ctrl+V uses event text even when clipboard readText is denied', async ({ page }) => {
    await waitForEditor(page)
    // Native copy seeds the clipboard without Chromium-only permission grants.
    await page.evaluate(text => {
        const field = document.createElement('textarea')
        field.id = 'clipboard-seed'
        field.value = text
        document.body.append(field)
        field.focus()
        field.select()
    }, BLUEPRINT)
    await page.keyboard.press('ControlOrMeta+c')
    await page.locator('#editor').focus()
    let reads = 0
    await page.exposeFunction('recordClipboardRead', () => reads++)
    await page.evaluate(() => {
        navigator.clipboard.readText = async () => {
            await (
                window as unknown as { recordClipboardRead: () => Promise<void> }
            ).recordClipboardRead()
            throw new DOMException('Clipboard read denied', 'NotAllowedError')
        }
    })
    await page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)
    expect(reads).toBe(0)
})

for (const data of ['empty', 'missing'] as const) {
    test(`paste with ${data} event data falls back to readText`, async ({ page }) => {
        await waitForEditor(page)
        await page.locator('#editor').focus()
        await page.evaluate(
            ({ text, data }) => {
                navigator.clipboard.readText = async () => text
                document.dispatchEvent(
                    new ClipboardEvent('paste', {
                        clipboardData: data === 'empty' ? new DataTransfer() : null,
                        cancelable: true,
                    })
                )
            },
            { text: BLUEPRINT, data }
        )
        await expect
            .poll(() => page.evaluate(() => window.__fbe_test.entityContainerCount()))
            .toBe(1)
    })
}
