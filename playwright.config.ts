import { defineConfig } from '@playwright/test'

// Port 8080 is the default because that is what the Vite dev server picks, but it
// is not always free. Set FBE_BASE_URL to point the specs somewhere else - e.g.
// FBE_BASE_URL=http://localhost:8090 npx playwright test - rather than editing
// this file and having to remember to revert it before committing.
const baseURL = process.env.FBE_BASE_URL ?? 'http://localhost:8080'

export default defineConfig({
    testDir: './tests',
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
