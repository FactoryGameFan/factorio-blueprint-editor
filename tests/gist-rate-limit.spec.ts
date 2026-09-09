import { test, expect } from '@playwright/test'

for (const status of [429, 403]) {
    test(`GitHub ${status} rate limits show retry guidance`, async ({ page }) => {
        await page.route('**/corsproxy*', route =>
            route.fulfill({
                status,
                headers: status === 403 ? { 'x-ratelimit-remaining': '0' } : {},
                body: '{"message":"API rate limit exceeded"}',
            })
        )
        await page.goto('/?source=https://gist.github.com/someone/dead1234')
        await expect(
            page.getByText('GitHub rate limit reached. Please try importing again later.')
        ).toBeVisible()
        await expect(page.getByText('report this bug on github', { exact: false })).toHaveCount(0)
    })
}

for (const [source, status, remaining] of [
    ['https://gist.github.com/someone/dead1234', 403, '1'],
    ['https://gist.github.com/someone/dead1234', 404, '0'],
    ['https://pastebin.com/AbCd1234', 429, '0'],
] as const) {
    test(`${source} HTTP ${status} without a GitHub rate limit stays a load error`, async ({
        page,
    }) => {
        await page.route('**/corsproxy*', route =>
            route.fulfill({
                status,
                headers: { 'x-ratelimit-remaining': remaining },
                body: 'request failed',
            })
        )
        await page.goto(`/?source=${encodeURIComponent(source)}`)
        await expect(
            page.getByText('Blueprint string could not be loaded.', { exact: false })
        ).toBeVisible()
        await expect(page.getByText('GitHub rate limit reached.', { exact: false })).toHaveCount(0)
    })
}
