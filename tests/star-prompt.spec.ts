import { test, expect } from '@playwright/test'

test('star prompt is delayed, accessible, dismissible, and shown only once', async ({ page }) => {
    await page.clock.install()
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined)
    const link = page.getByRole('link', { name: 'Give us a star on GitHub' })
    await expect(link).toHaveCount(0)
    await page.clock.fastForward(59000)
    await expect(link).toHaveCount(0)
    await page.clock.fastForward(1000)
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute(
        'href',
        'https://github.com/FactoryGameFan/factorio-blueprint-editor'
    )
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveCSS('pointer-events', 'auto')
    await expect(page.getByRole('status')).toHaveText("Enjoying the editor? We're open source!")
    await expect(page.getByRole('status')).toHaveCSS('pointer-events', 'none')

    const dismiss = page.getByRole('button', { name: 'Dismiss star prompt' })
    await dismiss.focus()
    await page.keyboard.press('Enter')
    await expect(link).toHaveCount(0)

    await page.reload()
    await page.waitForFunction(() => window.__fbe_test !== undefined)
    await page.clock.fastForward(60000)
    await expect(link).toHaveCount(0)
})

test('star prompt expires without interaction', async ({ page }) => {
    await page.clock.install()
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined)
    await page.clock.fastForward(60000)
    const link = page.getByRole('link', { name: 'Give us a star on GitHub' })
    await expect(link).toBeVisible()
    await page.clock.fastForward(30000)
    await expect(link).toHaveCount(0)
})
