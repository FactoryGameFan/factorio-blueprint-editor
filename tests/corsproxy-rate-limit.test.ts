import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import worker from '../packages/worker/src/index'

/*
    The /corsproxy rate limit (#591), driven through the real handler with a
    stand-in for the Workers Rate Limiting binding. What the binding itself
    counts, and where, only production can show; this pins what the Worker
    does with its answer.
*/

afterEach(() => vi.unstubAllGlobals())

const IP = '203.0.113.7'

const limiter = (success: boolean) => ({ limit: vi.fn().mockResolvedValue({ success }) })

const proxy = (env: object, init?: RequestInit, target = 'https://pastebin.com/raw/dead1234') =>
    worker.fetch(
        new Request(`https://fbe.factorygamefan.com/corsproxy?url=${target}`, {
            ...init,
            headers: { 'cf-connecting-ip': IP },
        }),
        env as never,
        {} as never
    )

describe('the /corsproxy rate limit', () => {
    it('answers 429 over the limit, under the policy, without fetching', async () => {
        const upstream = vi.fn()
        vi.stubGlobal('fetch', upstream)
        const response = await proxy({ CORSPROXY_LIMIT: limiter(false) })
        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(upstream).not.toHaveBeenCalled()
    })

    it('proxies within the limit, keyed on the client IP', async () => {
        const upstream = vi.fn().mockResolvedValue(new Response('0eNq'))
        vi.stubGlobal('fetch', upstream)
        const binding = limiter(true)
        const response = await proxy({ CORSPROXY_LIMIT: binding })
        expect(response.status).toBe(200)
        expect(upstream).toHaveBeenCalledOnce()
        expect(binding.limit).toHaveBeenCalledWith({ key: `corsproxy:${IP}` })
    })

    // A refused request still bills as an invocation, so it counts too.
    it('counts requests the proxy goes on to refuse', async () => {
        vi.stubGlobal('fetch', vi.fn())
        const binding = limiter(true)
        expect((await proxy({ CORSPROXY_LIMIT: binding }, { method: 'POST' })).status).toBe(405)
        expect(
            (await proxy({ CORSPROXY_LIMIT: binding }, undefined, 'https://127.0.0.1/')).status
        ).toBe(403)
        expect(binding.limit).toHaveBeenCalledTimes(2)
    })

    it('lets the request through when the binding is missing or throws', async () => {
        const upstream = vi.fn().mockImplementation(() => Promise.resolve(new Response('0eNq')))
        vi.stubGlobal('fetch', upstream)
        const broken = { limit: vi.fn().mockRejectedValue(new Error('limiter unavailable')) }
        expect((await proxy({})).status).toBe(200)
        expect((await proxy({ CORSPROXY_LIMIT: broken })).status).toBe(200)
        expect(upstream).toHaveBeenCalledTimes(2)
    })

    // One shared key for every request without an IP would let one client
    // spend everyone's allowance.
    it('lets a request without a client IP through, without asking the limiter', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('0eNq')))
        const binding = limiter(false)
        const response = await worker.fetch(
            new Request('https://fbe.factorygamefan.com/corsproxy?url=https://pastebin.com/raw/x'),
            { CORSPROXY_LIMIT: binding } as never,
            {} as never
        )
        expect(response.status).toBe(200)
        expect(binding.limit).not.toHaveBeenCalled()
    })
})

/*
    A source scan for what the handler test above cannot see: that the binding
    the Worker reads is the one wrangler.jsonc declares. A rename on either
    side would leave the binding undefined, and the fail-open path above would
    then turn the limit off with every test still green.
*/
describe('the rate limit agrees with wrangler.jsonc', () => {
    const read = (relative: string) =>
        fs.readFileSync(path.resolve(process.cwd(), relative), 'utf-8')
    const config = read('packages/worker/wrangler.jsonc')
    const source = read('packages/worker/src/index.ts')

    const block = config.match(/"ratelimits":\s*\[([\s\S]*?)\]/)
    if (block === null) throw new Error('wrangler.jsonc declares no ratelimits')

    it('declares the binding index.ts reads', () => {
        expect(block[1]).toMatch(/"name":\s*"CORSPROXY_LIMIT"/)
        expect(source).toMatch(/CORSPROXY_LIMIT\?: RateLimit/)
    })

    // Cloudflare's docs: a positive integer, as a string, that we choose.
    it('uses a namespace_id that is a positive integer', () => {
        expect(block[1]).toMatch(/"namespace_id":\s*"[1-9]\d*"/)
    })

    // The 429's Retry-After says 60; the binding's period has to agree.
    it('counts over the period the 429 tells the client to wait', () => {
        expect(block[1]).toMatch(/"period":\s*60\b/)
        expect(source).toMatch(/'retry-after': '60'/)
    })
})
