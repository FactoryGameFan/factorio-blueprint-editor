import { defineConfig } from '@playwright/test'

// THROWAWAY. Deleted before the PR for #186 lands - a measuring instrument,
// not a test, the same way tools/oracle/ treats a probe.
//
// Kept out of playwright.config.ts on purpose: that config's testMatch is
// Playwright's default (**/*.@(spec|test).?(c|m)[jt]s?(x)), which does not
// match *.recorder.ts, so `npx playwright test` never picks the recorder up.
// Run it deliberately:
//
//   FBE_RECORD_OUT=<dir> npx playwright test --config=playwright.recorder.config.ts
const baseURL = process.env.FBE_BASE_URL ?? 'http://localhost:8080'

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.recorder.ts',
    // The corpus walks are minutes each, not seconds - the normal 120s is for
    // one spec, and the recorder replays five of them back to back.
    timeout: 900_000,
    expect: { timeout: 120_000 },
    use: { baseURL, headless: true },
    retries: 0,
    workers: 1,
    reporter: [['list']],
})
