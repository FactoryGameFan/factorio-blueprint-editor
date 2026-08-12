import { defineConfig } from '@playwright/test'

// Port 8080 is the default because that is what the Vite dev server picks, but it
// is not always free. Set FBE_BASE_URL to point the specs somewhere else - e.g.
// FBE_BASE_URL=http://localhost:8090 npx playwright test - rather than editing
// this file and having to remember to revert it before committing.
const baseURL = process.env.FBE_BASE_URL ?? 'http://localhost:8080'

export default defineConfig({
    testDir: './tests',
    /*
        Specs only. Playwright's default also collects *.test.ts, and tests/
        now holds one - blueprint-files.test.ts, a vitest test, because the
        corpus guard in #190 wants the fast gate rather than this one (see the
        `corpus` project in vite.config.ts). That reasoning survived Playwright
        joining CI: the browser suite is a separate ~5-minute job behind two dev
        servers, `vp test` is seconds inside `checks`, and a guard on a stray
        committed file needs neither a browser nor the wait. Without this
        testMatch it would be collected by both runners and fail under
        Playwright, which cannot supply `describe`/`it`.

        A no-op for what actually runs: all 40 existing files here are .spec.ts.
    */
    testMatch: '**/*.spec.ts',
    timeout: 120_000,
    expect: {
        timeout: 60_000,
    },
    use: {
        baseURL,
        headless: true,
    },
    retries: 0,
    workers: 1,
    reporter: [['list']],
})
