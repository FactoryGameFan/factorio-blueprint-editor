import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import worker from '../packages/worker/src/index'
import { MAX_PROXY_REDIRECTS } from '../packages/worker/src/proxyTarget'

/*
    /corsproxy follows redirects itself, so every URL it fetches is judged by
    checkProxyTarget, not just the one in the query string. These drive the
    real handler with a stubbed fetch, the way gist-rate-limit.test.ts does.

    The stub stands in for the upstreams and for the runtime. Asked with
    `redirect: 'manual'` it returns each hop's 3xx as-is; asked with anything
    else it follows the chain itself before answering, which is what workerd
    did when measured under `wrangler dev --local` (a 302 to another port was
    followed, and the Worker saw only the final 200). So a handler that went
    back to letting the runtime follow would be tested against the runtime it
    would actually get, not against a stub that happens to stop at hop 0.

    It also refuses a fetch past SUBREQUEST_LIMIT, as the platform refuses one
    past its own limit. Without that, a handler with no hop cap would recurse
    around a redirect loop until the test worker ran out of memory, and the
    run would end in a crash that names no test.
*/

const SELF = 'fbe.factorygamefan.com'
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]
const SUBREQUEST_LIMIT = 50

interface Hop {
    status: number
    location?: string
    body?: string
    headers?: Record<string, string>
}

interface Call {
    url: string
    init: RequestInit
}

afterEach(() => vi.unstubAllGlobals())

/** Serves `hops`, keyed by absolute URL, and returns the log of fetches the Worker made. */
function stubUpstreams(hops: Record<string, Hop>): Call[] {
    const calls: Call[] = []

    const answer = (url: string): Response => {
        const hop = hops[url]
        if (hop === undefined) throw new TypeError(`no upstream at ${url}`)
        const headers = new Headers(hop.headers)
        if (hop.location !== undefined) headers.set('location', hop.location)
        return new Response(hop.body ?? `served ${url}`, { status: hop.status, headers })
    }

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init: RequestInit = {}) => {
            if (calls.length >= SUBREQUEST_LIMIT) throw new TypeError('too many subrequests')
            calls.push({ url: input, init })
            let url = input
            let response = answer(url)
            if (init.redirect === 'manual') return response

            for (let followed = 0; followed < 20; followed++) {
                const location = response.headers.get('location')
                if (!REDIRECT_STATUSES.includes(response.status) || location === null) break
                url = new URL(location, url).href
                response = answer(url)
            }
            return response
        })
    )

    return calls
}

function proxy(target: string, method = 'GET'): Promise<Response> {
    return worker.fetch(
        new Request(`https://${SELF}/corsproxy?url=${encodeURIComponent(target)}`, { method }),
        {} as never,
        {} as never
    )
}

/** A chain of `length` redirects starting at `https://example.com/0`, ending in a 200. */
function chain(length: number): Record<string, Hop> {
    const hops: Record<string, Hop> = {}
    for (let i = 0; i < length; i++) {
        hops[`https://example.com/${i}`] = { status: 302, location: `/${i + 1}` }
    }
    hops[`https://example.com/${length}`] = { status: 200, body: 'end of chain' }
    return hops
}

describe('/corsproxy follows an allowed redirect chain', () => {
    it('relays the final body under the proxy’s own headers', async () => {
        const calls = stubUpstreams({
            'https://factorio.school/api/blueprint/x': {
                status: 301,
                location: 'https://www.factorio.school/api/blueprint/x',
            },
            'https://www.factorio.school/api/blueprint/x': {
                status: 302,
                location: 'https://cdn.example.net/x',
            },
            'https://cdn.example.net/x': {
                status: 200,
                body: '0eNqBLUEPRINT',
                headers: {
                    'content-type': 'text/html',
                    'x-ratelimit-remaining': '41',
                    'set-cookie': 'session=upstream',
                },
            },
        })

        const response = await proxy('https://factorio.school/api/blueprint/x')

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('0eNqBLUEPRINT')
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        expect(response.headers.get('content-disposition')).toBe('attachment')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('content-security-policy')).toMatch(/sandbox/)
        expect(response.headers.get('x-ratelimit-remaining')).toBe('41')
        expect(response.headers.get('set-cookie')).toBeNull()
        expect(calls.map(call => call.url)).toEqual([
            'https://factorio.school/api/blueprint/x',
            'https://www.factorio.school/api/blueprint/x',
            'https://cdn.example.net/x',
        ])
    })

    it('asks the runtime not to follow, and sends its own user-agent, on every hop', async () => {
        const calls = stubUpstreams(chain(3))

        await proxy('https://example.com/0')

        expect(calls).toHaveLength(4)
        for (const { init } of calls) {
            expect(init.redirect).toBe('manual')
            expect(new Headers(init.headers).get('user-agent')).toMatch(/factorio-blueprint-editor/)
        }
    })

    it.each(REDIRECT_STATUSES)('follows a %i', async status => {
        const calls = stubUpstreams({
            'https://example.com/a': { status, location: 'https://example.com/b' },
            'https://example.com/b': { status: 200, body: 'moved' },
        })

        const response = await proxy('https://example.com/a')

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('moved')
        expect(calls).toHaveLength(2)
    })

    // 300 is a 3xx the fetch standard does not follow either, so it is relayed
    // as it always was.
    it('relays a 3xx that is not a redirect status', async () => {
        const calls = stubUpstreams({
            'https://example.com/a': { status: 300, location: 'https://example.com/b' },
            'https://example.com/b': { status: 200 },
        })

        const response = await proxy('https://example.com/a')

        expect(response.status).toBe(300)
        expect(calls).toHaveLength(1)
    })

    it.each([
        ['a sibling path', 'b', 'https://example.com/dir/b'],
        ['an absolute path', '/root/c', 'https://example.com/root/c'],
        ['a scheme-relative URL', '//example.net/d', 'https://example.net/d'],
        ['a query only', '?page=2', 'https://example.com/dir/a?page=2'],
    ])(
        'resolves a Location that is %s against the hop that sent it',
        async (_label, location, resolved) => {
            const calls = stubUpstreams({
                'https://example.com/dir/a': { status: 302, location },
                [resolved]: { status: 200, body: 'resolved' },
            })

            const response = await proxy('https://example.com/dir/a')

            expect(await response.text()).toBe('resolved')
            expect(calls.map(call => call.url)).toEqual(['https://example.com/dir/a', resolved])
        }
    )

    it('keeps a HEAD a HEAD on every hop', async () => {
        const calls = stubUpstreams({
            'https://example.com/a': { status: 303, location: 'https://example.com/b' },
            'https://example.com/b': { status: 200 },
        })

        const response = await proxy('https://example.com/a', 'HEAD')

        expect(response.status).toBe(200)
        expect(calls.map(call => call.init.method)).toEqual(['HEAD', 'HEAD'])
    })
})

describe('/corsproxy judges every Location by the same rules as the first URL', () => {
    /*
        Each target here is refused as a first URL in corsproxy.test.ts. The
        upstream it names is served, so a handler that fetched it anyway would
        relay 'not for relay' rather than refuse.
    */
    it.each([
        ['switches to http', 'http://example.com/next', 'Only https targets are proxied'],
        [
            'names a non-default port on an unrecognised host',
            'https://example.com:8443/next',
            'Only the default https port is proxied',
        ],
        ['names an IPv4 literal', 'https://127.0.0.1/next', 'Targets must be a public hostname'],
        [
            'names the cloud metadata address',
            'https://169.254.169.254/latest/meta-data/',
            'Targets must be a public hostname',
        ],
        [
            'names a .internal host',
            'https://metadata.google.internal/computeMetadata/v1/',
            'Targets must be a public hostname',
        ],
        [
            'names localhost with a trailing dot',
            'https://localhost./x',
            'Targets must be a public hostname',
        ],
        [
            'carries credentials',
            'https://user:pw@example.com/x',
            'Targets may not carry credentials',
        ],
        [
            'names this deployment',
            `https://${SELF}/corsproxy?url=https://example.com/x`,
            'Refusing to proxy this deployment',
        ],
    ])('refuses a Location that %s, without fetching it', async (_label, location, reason) => {
        const calls = stubUpstreams({
            'https://example.com/start': { status: 302, location },
            [new URL(location).href]: { status: 200, body: 'not for relay' },
        })

        const response = await proxy('https://example.com/start')

        expect(response.status).toBe(403)
        const body = await response.text()
        expect(body).toContain('redirected to a URL that is not proxied')
        expect(body).toContain(reason)
        expect(response.headers.get('content-security-policy')).toMatch(/sandbox/)
        expect(calls.map(call => call.url)).toEqual(['https://example.com/start'])
    })

    // An allowlisted host is exempt from the port rule as a first URL. The
    // exemption belongs to that host, so it does not carry to where it points.
    it('does not extend an allowlisted host’s port exemption to its Location', async () => {
        const calls = stubUpstreams({
            'https://pastebin.com/raw/abc': { status: 302, location: 'https://example.com:8443/x' },
            'https://example.com:8443/x': { status: 200, body: 'not for relay' },
        })

        const response = await proxy('https://pastebin.com/raw/abc')

        expect(response.status).toBe(403)
        expect(calls).toHaveLength(1)
    })
})

describe('/corsproxy answers 502 for a redirect it cannot use', () => {
    it(`follows ${MAX_PROXY_REDIRECTS} redirects`, async () => {
        const calls = stubUpstreams(chain(MAX_PROXY_REDIRECTS))

        const response = await proxy('https://example.com/0')

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('end of chain')
        expect(calls).toHaveLength(MAX_PROXY_REDIRECTS + 1)
    })

    it('refuses the redirect after that, without fetching it', async () => {
        const calls = stubUpstreams(chain(MAX_PROXY_REDIRECTS + 1))

        const response = await proxy('https://example.com/0')

        expect(response.status).toBe(502)
        expect(await response.text()).toContain('redirected too many times')
        expect(calls).toHaveLength(MAX_PROXY_REDIRECTS + 1)
    })

    it('stops a redirect loop', async () => {
        const calls = stubUpstreams({
            'https://example.com/a': { status: 302, location: '/b' },
            'https://example.com/b': { status: 302, location: '/a' },
        })

        const response = await proxy('https://example.com/a')

        expect(response.status).toBe(502)
        expect(await response.text()).toContain('redirected too many times')
        expect(calls).toHaveLength(MAX_PROXY_REDIRECTS + 1)
    })

    it.each([
        ['no Location', undefined],
        ['a Location that is not a URL', 'https://'],
    ])('refuses a redirect with %s', async (_label, location) => {
        const calls = stubUpstreams({ 'https://example.com/a': { status: 302, location } })

        const response = await proxy('https://example.com/a')

        expect(response.status).toBe(502)
        expect(await response.text()).toContain('without a usable Location')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(calls).toHaveLength(1)
    })
})
