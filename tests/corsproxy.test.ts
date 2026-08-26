import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import { ALLOWED_HOSTS, checkProxyTarget } from '../packages/worker/src/proxyTarget'

/*
    The only automated coverage the Cloudflare Worker has.

    `packages/worker` is in `lint.ignorePatterns` (vite.config.ts) and no test
    project collects from it, so nothing in that package is linted, type-checked
    or run by either gate. `checkProxyTarget` was split out of index.ts to be
    reachable from here, where the `unit` project in vite.config.ts does collect
    it and CI runs it in seconds.

    What is still uncovered, and it is most of the handler: the fetch, the
    header rebuild, the Content-Length precheck and the streaming size cap all
    live in index.ts and run nowhere but production. Testing those needs a
    Workers runtime pool this repo does not have, and adding one means a new
    dependency against a toolchain whose whole version story is "vite-plus pins
    everything" (CLAUDE.md, Version Constraints). Worth knowing before reading a
    green run here as "the proxy is covered".

    Same path convention as wire-switch-completeness.test.ts and for the reason
    written there: `import.meta.dirname` is undefined under the shared tsconfig's
    `module: ES6`, and vitest runs from the repo root.
*/

const SELF = 'fbe.factorygamefan.com'

const allow = (target: string) => checkProxyTarget(target, SELF)

describe('checkProxyTarget - the editor’s own sources', () => {
    it('accepts every host on the allowlist', () => {
        for (const host of ALLOWED_HOSTS) {
            const verdict = allow(`https://${host}/some/path`)
            expect(verdict, host).toMatchObject({ ok: true, allowlisted: true })
        }
    })

    /*
        A one-directional guard, and the direction matters. Every host
        bpString.ts builds a URL for must be on the allowlist, or that source
        silently drops to the catch-all and starts being judged by the guards
        below - it still works, which is exactly why nothing else would notice.

        The reverse does not hold and must not be asserted: `factorio.school`
        without the `www.` is on the allowlist because the pass-through arm
        fetches `url.href` for a URL the *user* typed, so it never appears as a
        literal here.
    */
    it('covers every host bpString.ts builds a URL for', () => {
        const source = fs.readFileSync(
            path.resolve(process.cwd(), 'packages/editor/src/core/bpString.ts'),
            'utf-8'
        )

        const hosts = new Set(
            [...source.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map(match => match[1])
        )

        expect(hosts.size).toBeGreaterThan(0)
        for (const host of hosts) {
            expect(ALLOWED_HOSTS.has(host), `${host} is fetched but not allowlisted`).toBe(true)
        }
    })

    // The allowlist is checked before the catch-all guards, so a named host is
    // exempt from the port rule. Pinned because it is a consequence of the
    // ordering rather than a decision anyone would find by reading the guards.
    it('exempts an allowlisted host from the port restriction', () => {
        expect(allow('https://pastebin.com:8443/raw/abc')).toMatchObject({ ok: true })
    })
})

describe('checkProxyTarget - the catch-all stays open', () => {
    /*
        This is the feature, not an oversight. bpString.ts ends its switch in a
        `default:` arm that fetches whatever host was pasted, and
        tests/blueprint-sources.spec.ts:168 pins it from the editor side - but
        that spec intercepts /corsproxy with page.route and never reaches this
        code, so refusing an unknown host here would break the feature with the
        whole Playwright suite still green. This is the test that would fail.
    */
    it('accepts an ordinary public host that is not on the allowlist', () => {
        expect(allow('https://example.com/blueprint.txt')).toMatchObject({
            ok: true,
            allowlisted: false,
        })
    })

    it('accepts a subdomain of an ordinary public host', () => {
        expect(allow('https://files.example.co.uk/a/b.txt')).toMatchObject({ ok: true })
    })
})

describe('checkProxyTarget - refusals', () => {
    it.each([
        ['a missing parameter', null, 400],
        ['an empty parameter', '', 400],
        ['something that is not a URL', 'not a url', 400],
        ['a relative path', '/etc/passwd', 400],
        ['http rather than https', 'http://example.com/x', 403],
        ['a file: URL', 'file:///etc/passwd', 403],
        ['a data: URL', 'data:text/plain,hello', 403],
        ['credentials in the URL', 'https://user:pw@example.com/x', 403],
        ['this deployment itself', `https://${SELF}/corsproxy?url=x`, 403],
        ['localhost', 'https://localhost/x', 403],
        ['an IPv4 literal', 'https://127.0.0.1/x', 403],
        ['a private IPv4 literal', 'https://10.0.0.1/x', 403],
        ['a link-local IPv4 literal', 'https://169.254.169.254/latest/meta-data/', 403],
        ['an IPv6 literal', 'https://[::1]/x', 403],
        ['a bare hostname with no dot', 'https://intranet/x', 403],
        ['a .local name', 'https://printer.local/x', 403],
        ['a .internal name', 'https://metadata.internal/x', 403],
        ['a non-default port on an unknown host', 'https://example.com:8080/x', 403],
    ])('refuses %s', (_label, target, status) => {
        expect(checkProxyTarget(target, SELF)).toMatchObject({ ok: false, status })
    })

    // The cloud-metadata address is the one refusal worth naming on its own:
    // it is the single most-requested target for an open relay, and it is a
    // plain IPv4 literal, so the blanket literal rule is what stops it.
    it('refuses the cloud metadata address specifically', () => {
        const verdict = checkProxyTarget('https://169.254.169.254/latest/meta-data/', SELF)
        expect(verdict.ok).toBe(false)
    })
})

/*
    A source scan rather than a behaviour test, and it is the same answer
    tests/spec-modifier-keys.test.ts reached for its own class of bug: nothing
    that runs here can reach api.github.com, so no runner can catch the thing
    this guards.

    GitHub's API refuses a request with no User-Agent, and Cloudflare's fetch
    sends none of its own, so dropping this header silently breaks the `gist`
    source in bpString.ts - and breaks it in a way the whole suite stays green
    for, because tests/blueprint-sources.spec.ts intercepts /corsproxy with
    page.route and never leaves the browser. That is exactly how it went
    unnoticed from March 2026 until it was probed against production.
*/
describe('the outbound fetch identifies itself', () => {
    const worker = fs.readFileSync(
        path.resolve(process.cwd(), 'packages/worker/src/index.ts'),
        'utf-8'
    )

    it('sends a user-agent on the proxied request', () => {
        const call = worker.match(/upstream = await fetch\([\s\S]*?\n {8}\}\)/)
        if (call === null) throw new Error('the outbound fetch call could not be located')
        expect(call[0]).toMatch(/'user-agent':/)
    })

    it('uses a fixed string that names the project, not the caller’s header', () => {
        const declared = worker.match(/const PROXY_USER_AGENT = '([^']+)'/)
        if (declared === null) throw new Error('PROXY_USER_AGENT is not declared')
        expect(declared[1]).toMatch(/factorio-blueprint-editor/)
        // Forwarding request.headers would carry our own cookies to the target.
        expect(worker).not.toMatch(/headers:\s*request\.headers/)
    })
})
