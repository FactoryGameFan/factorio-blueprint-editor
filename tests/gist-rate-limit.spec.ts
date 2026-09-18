import { test, expect } from '@playwright/test'

/*
    A gist is asked of api.github.com directly, not through /corsproxy, so the
    route below stands in for GitHub itself. It has to answer the way GitHub
    does for a cross-origin request, or the browser hides the response from the
    editor: measured 2026-09-18, GitHub sends `access-control-allow-origin: *`
    and lists X-RateLimit-Remaining in `access-control-expose-headers`, on a 404
    as well as a 200. Without that second header the rate-limit check below
    could never see a 0.
*/
const GITHUB_CORS = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
}

/** Answers GitHub's API and the proxy alike, and records which one was asked. */
async function answer(
    page: import('@playwright/test').Page,
    status: number,
    headers: Record<string, string>,
    body: string
): Promise<string[]> {
    const asked: string[] = []
    await page.route('https://api.github.com/**', route => {
        asked.push('github')
        return route.fulfill({ status, headers: { ...GITHUB_CORS, ...headers }, body })
    })
    await page.route('**/corsproxy*', route => {
        asked.push('proxy')
        return route.fulfill({ status, headers, body })
    })
    return asked
}

for (const status of [429, 403]) {
    test(`GitHub ${status} rate limits show retry guidance`, async ({ page }) => {
        const asked = await answer(
            page,
            status,
            status === 403 ? { 'x-ratelimit-remaining': '0' } : {},
            '{"message":"API rate limit exceeded"}'
        )
        await page.goto('/?source=https://gist.github.com/someone/dead1234')
        await expect(
            page.getByText('GitHub rate limit reached. Please try importing again later.')
        ).toBeVisible()
        await expect(page.getByText('report this bug on github', { exact: false })).toHaveCount(0)
        expect(asked).toEqual(['github'])
    })
}

for (const [source, status, remaining, via] of [
    ['https://gist.github.com/someone/dead1234', 403, '1', 'github'],
    ['https://gist.github.com/someone/dead1234', 404, '0', 'github'],
    ['https://pastebin.com/AbCd1234', 429, '0', 'proxy'],
] as const) {
    test(`${source} HTTP ${status} without a GitHub rate limit stays a load error`, async ({
        page,
    }) => {
        const asked = await answer(
            page,
            status,
            { 'x-ratelimit-remaining': remaining },
            'request failed'
        )
        await page.goto(`/?source=${encodeURIComponent(source)}`)
        await expect(
            page.getByText('Blueprint string could not be loaded.', { exact: false })
        ).toBeVisible()
        await expect(page.getByText('GitHub rate limit reached.', { exact: false })).toHaveCount(0)
        expect(asked).toEqual([via])
    })
}
