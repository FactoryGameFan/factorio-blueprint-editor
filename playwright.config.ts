import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests',
    timeout: 120_000,
    expect: {
        timeout: 60_000,
    },
    use: {
        baseURL: 'http://localhost:8080',
        headless: true,
    },
    retries: 0,
    workers: 1,
    reporter: [['list']],
})
