import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import {
    DEDUPE_WINDOW_SECONDS,
    dedupeKey,
    isPageView,
    utcDay,
    visitorFingerprint,
} from '../packages/worker/src/visitorCount'

/*
    The unique-visitor counter's decisions, which are the half of it a test can
    reach. tests/corsproxy.test.ts explains why that split exists at all:
    `packages/worker` is linted, type-checked and collected by nothing, so only
    a pure module imported from here runs in CI.

    Uncovered, and it is the half that touches the network: the Cache API
    lookup, the writeDataPoint call and ctx.waitUntil all live in index.ts and
    run nowhere but production. A green run here says the rules below hold, not
    that a visit was counted.

    Same path convention as corsproxy.test.ts, for the reason written there.
*/

const pageView = (over: Partial<Parameters<typeof isPageView>[0]> = {}) =>
    isPageView({ method: 'GET', pathname: '/', accept: 'text/html,*/*;q=0.8', ...over })

describe('isPageView - what counts as one visit', () => {
    it('counts a browser navigating to the editor', () => {
        expect(pageView()).toBe(true)
    })

    /*
        The editor is a single page app, so a blueprint deep link is `/` with a
        query string. The Worker sees the same path either way, and a visitor
        who arrives on a shared blueprint is as much a visitor as one who typed
        the domain.
    */
    it('counts a deep link, which is still the root path', () => {
        expect(pageView({ pathname: '/' })).toBe(true)
    })

    it('ignores HEAD, which uptime checks and unfurlers send', () => {
        expect(pageView({ method: 'HEAD' })).toBe(false)
    })

    /*
        /corsproxy reaches this Worker too - it is the other half of
        `run_worker_first` in wrangler.jsonc. A blueprint import fires one on
        top of the navigation that already counted.
    */
    it('ignores the proxy endpoint an import calls after the page loaded', () => {
        expect(pageView({ pathname: '/corsproxy' })).toBe(false)
    })

    it('ignores a fetch that does not ask for HTML', () => {
        expect(pageView({ accept: '*/*' })).toBe(false)
        expect(pageView({ accept: 'application/json' })).toBe(false)
        expect(pageView({ accept: null })).toBe(false)
    })
})

describe('utcDay - the dedupe window and the reporting bucket', () => {
    it('is the UTC calendar day, not the local one', () => {
        expect(utcDay(new Date('2026-09-03T23:59:59Z'))).toBe('2026-09-03')
        expect(utcDay(new Date('2026-09-04T00:00:00Z'))).toBe('2026-09-04')
    })

    it('matches the cache lifetime the Worker sets', () => {
        expect(DEDUPE_WINDOW_SECONDS).toBe(24 * 60 * 60)
    })
})

describe('visitorFingerprint - one visitor, one day', () => {
    const visitor = {
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0',
        acceptLanguage: 'en-GB,en;q=0.9',
        day: '2026-09-03',
    }

    it('gives one value for the same visitor on the same day', async () => {
        expect(await visitorFingerprint(visitor)).toBe(await visitorFingerprint(visitor))
    })

    /*
        The day is inside the hash rather than beside it, so a value cannot be
        carried across midnight to match the same person tomorrow. This is what
        makes the fingerprint unlinkable over time, and it is the reason the
        design needs no salt.
    */
    it('rotates at midnight UTC', async () => {
        expect(await visitorFingerprint({ ...visitor, day: '2026-09-04' })).not.toBe(
            await visitorFingerprint(visitor)
        )
    })

    it('separates two visitors who differ in any one signal', async () => {
        const mine = await visitorFingerprint(visitor)
        expect(await visitorFingerprint({ ...visitor, ip: '203.0.113.8' })).not.toBe(mine)
        expect(await visitorFingerprint({ ...visitor, userAgent: 'curl/8.7.1' })).not.toBe(mine)
        expect(await visitorFingerprint({ ...visitor, acceptLanguage: 'de' })).not.toBe(mine)
    })

    /*
        A request Cloudflare did not proxy, or one from a client that sends no
        User-Agent, still has to produce a key rather than throw on the response
        path. Everyone in that bucket collapses to one fingerprint, which
        under-counts - the one place this design does.
    */
    it('handles a request that is missing every header', async () => {
        const blank = await visitorFingerprint({
            ip: null,
            userAgent: null,
            acceptLanguage: null,
            day: visitor.day,
        })
        expect(blank).toMatch(/^[0-9a-f]{64}$/)
        expect(blank).not.toBe(await visitorFingerprint(visitor))
    })

    /*
        No visitor identifier is stored anywhere queryable, so what the hash is
        made of matters less than that it is a hash. This pins the shape rather
        than the value: a digest, not the material.
    */
    it('is a hex SHA-256 digest, never the inputs', async () => {
        const fingerprint = await visitorFingerprint(visitor)
        expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
        expect(fingerprint).not.toContain('203.0.113.7')
    })
})

describe('dedupeKey - a cache key, not a route', () => {
    it('is built on the deployment’s own origin', () => {
        expect(dedupeKey('https://fbe.factorygamefan.com', '2026-09-03', 'abc')).toBe(
            'https://fbe.factorygamefan.com/__visitor/2026-09-03/abc'
        )
    })

    it('separates days, so yesterday’s entry cannot answer today', () => {
        const key = (day: string) => dedupeKey('https://fbe.factorygamefan.com', day, 'abc')
        expect(key('2026-09-03')).not.toBe(key('2026-09-04'))
    })
})

/*
    The beacon and the header that permits it, pinned together.

    packages/website/vite.config.js injects a script from
    static.cloudflareinsights.com which reports to cloudflareinsights.com. The
    Content-Security-Policy in public/_headers already allowed both before this
    counter existed, so nothing in the beacon change had to touch it - and that
    is exactly the arrangement that breaks quietly. Tightening the CSP would not
    fail a build, would not fail a Playwright run, and would stop analytics
    reaching Cloudflare with no error anywhere but a visitor's console.

    A source-reading test for a production-only interaction, the same answer
    corsproxy.test.ts reached for its User-Agent header.
*/
describe('the Web Analytics beacon is permitted by the CSP that ships with it', () => {
    const read = (relative: string) =>
        fs.readFileSync(path.resolve(process.cwd(), relative), 'utf-8')

    const headers = read('packages/website/public/_headers')
    const viteConfig = read('packages/website/vite.config.js')

    it('serves the beacon script from a host script-src allows', () => {
        expect(viteConfig).toContain('https://static.cloudflareinsights.com/beacon.min.js')
        expect(headers).toContain('script-src')
        expect(headers).toContain('https://static.cloudflareinsights.com')
    })

    it('lets the beacon report back through connect-src', () => {
        expect(headers).toContain('connect-src')
        expect(headers).toContain('https://cloudflareinsights.com')
    })

    /*
        The token comes from the environment, never from the repo. A literal in
        vite.config.js would be a working site token committed in public - not a
        credential that can write anything, but one anybody could point their
        own traffic at to poison the numbers.
    */
    it('takes its site token from the environment', () => {
        expect(viteConfig).toContain('process.env.CF_BEACON_TOKEN')
    })
})
