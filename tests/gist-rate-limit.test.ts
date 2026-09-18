import { afterEach, expect, it, vi } from 'vite-plus/test'
import worker from '../packages/worker/src/index'

afterEach(() => vi.unstubAllGlobals())

const proxy = (target: string) =>
    worker.fetch(
        new Request(`https://fbe.factorygamefan.com/corsproxy?url=${target}`),
        {} as never,
        {} as never
    )

/*
    The editor asks GitHub for a gist directly, so a request for GitHub's API
    arriving here is someone spending the site's shared allowance on purpose.
    Refused before any fetch, which is the part that matters: a refusal after
    the fetch would still have spent it.
*/
it('refuses GitHub’s API without fetching it', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const response = await proxy('https://api.github.com/gists/dead1234')
    expect(response.status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
})

it('passes an upstream refusal through without forwarding unsafe headers', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
            new Response('rate limited', {
                status: 429,
                headers: {
                    'content-type': 'application/json',
                    'set-cookie': 'session=untrusted',
                    'cache-control': 'public, max-age=86400',
                    location: 'https://untrusted.example',
                },
            })
        )
    )
    const response = await proxy('https://pastebin.com/raw/dead1234')
    expect(response.status).toBe(429)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('rate limited')
})
