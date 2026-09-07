import { afterEach, expect, it, vi } from 'vite-plus/test'
import worker from '../packages/worker/src/index'

afterEach(() => vi.unstubAllGlobals())

it('preserves GitHub rate-limit status and signal without forwarding unsafe headers', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
            new Response('rate limited', {
                status: 403,
                headers: {
                    'content-type': 'application/json',
                    'x-ratelimit-remaining': '0',
                    'set-cookie': 'session=untrusted',
                    'cache-control': 'public, max-age=86400',
                    location: 'https://untrusted.example',
                },
            })
        )
    )
    const response = await worker.fetch(
        new Request(
            'https://fbe.factorygamefan.com/corsproxy?url=https://api.github.com/gists/dead1234'
        ),
        {} as never,
        {} as never
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('rate limited')
})
