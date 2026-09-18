import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import {
    ALLOWED_HOSTS,
    checkProxyTarget,
    LEGACY_HOSTNAME,
} from '../packages/worker/src/proxyTarget'

/*
    The Cloudflare Worker's proxy guard, where CI can run it.

    `packages/worker` is in `lint.ignorePatterns` (vite.config.ts) and no test
    project collects from it, so nothing in that package is linted, type-checked
    or run by either gate. `checkProxyTarget` was split out of index.ts to be
    reachable from here, where the `unit` project in vite.config.ts does collect
    it and CI runs it in seconds.

    Less of the handler is uncovered than this comment once said, but not all of
    it is covered. tests/gist-rate-limit.test.ts drives the real handler with a
    stubbed fetch, and tests/worker-response-headers.test.ts calls the header
    rebuild directly, both under Node rather than the Workers runtime. Nothing
    drives the Content-Length precheck or the streaming size cap, and nothing
    here can see what the runtime itself does differently. That needs a Workers
    runtime pool this repo does not have, and adding one means a new dependency
    against a toolchain whose whole version story is "vite-plus pins
    everything" (CLAUDE.md, Version Constraints). Worth knowing before reading a
    green run here as "the proxy is covered".

    Same path convention as wire-switch-completeness.test.ts and for the reason
    written there: `import.meta.dirname` is undefined under the shared tsconfig's
    `module: ES6`, and vitest runs from the repo root.
*/

const SELF = 'fbe.factorygamefan.com'
// The other two kinds of hostname the same Worker answers on (#456).
const LEGACY = 'fbeworkeyman.wormeyman.workers.dev'
const PREVIEW = '1a2b3c4d-fbeworkeyman.wormeyman.workers.dev'

const allow = (target: string) => checkProxyTarget(target, SELF)

/*
    Hosts bpString.ts asks directly instead of through the proxy. They appear
    in its source like every other host, so the scan below skips them, and the
    proxy must refuse them rather than let the catch-all accept them.
*/
const ASKED_DIRECTLY = ['api.github.com']

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
        for (const host of ASKED_DIRECTLY) {
            expect(hosts.has(host), `${host} is no longer in bpString.ts`).toBe(true)
        }
        for (const host of hosts) {
            if (ASKED_DIRECTLY.includes(host)) continue
            expect(ALLOWED_HOSTS.has(host), `${host} is fetched but not allowlisted`).toBe(true)
        }
    })

    /*
        GitHub keys its anonymous allowance on the source address, and every
        request from the proxy shares one. Refused in every spelling, because
        the canonical form is what the rule compares.
    */
    it('refuses the hosts the editor asks directly', () => {
        for (const host of ASKED_DIRECTLY) {
            expect(ALLOWED_HOSTS.has(host), host).toBe(false)
            for (const spelling of [host, host.toUpperCase(), `${host}.`, `${host}..`]) {
                const target = `https://${spelling}/gists/dead1234`
                expect(allow(target), target).toMatchObject({ ok: false, status: 403 })
            }
        }
    })

    /*
        And the page may ask them. The dev server does not apply public/_headers,
        so every Playwright spec passes without this, and production would block
        the request with the CSP it serves.
    */
    it('lets the page ask them through connect-src', () => {
        const headers = fs.readFileSync(
            path.resolve(process.cwd(), 'packages/website/public/_headers'),
            'utf-8'
        )
        const connectSrc = headers.match(/connect-src ([^;]*);/)
        if (connectSrc === null) throw new Error('no connect-src directive in _headers')
        const sources = connectSrc[1].split(/\s+/)
        for (const host of ASKED_DIRECTLY) {
            expect(sources, host).toContain(`https://${host}`)
        }
    })

    /*
        The other direction of the same guard, for the arms that fetch `url.href`
        rather than a URL they build: their hosts appear nowhere in bpString.ts
        as a literal, so the scan above cannot see them, and dropping one to the
        catch-all would go unnoticed.
    */
    it('allowlists the hosts the pass-through arms fetch', () => {
        const passThrough = [
            'factorio.school',
            'www.factorio.school',
            'factorioprints.xyz',
            'www.factorioprints.xyz',
        ]

        for (const host of passThrough) {
            expect(ALLOWED_HOSTS.has(host), `${host} is passed through but not allowlisted`).toBe(
                true
            )
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

    // A trailing dot is a legal spelling of a public name, so it is accepted -
    // as the undotted name, so the guard and the fetch agree on what it is.
    it('accepts a public host with a trailing dot, and fetches it without one', () => {
        const verdict = allow('https://Example.com./blueprint.txt')
        expect(verdict).toMatchObject({ ok: true, allowlisted: false })
        if (verdict.ok) expect(verdict.url.href).toBe('https://example.com/blueprint.txt')
    })

    it('recognises an allowlisted host spelled with a trailing dot', () => {
        expect(allow('https://pastebin.com./raw/abc')).toMatchObject({
            ok: true,
            allowlisted: true,
        })
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
        /*
            The other hostnames this Worker answers on (#456). Comparing with
            the arrival hostname alone let both through. The legacy name
            re-enters the Worker and comes back as a 301 to /corsproxy, and a
            preview hostname runs a whole copy of the proxy, so a chain of
            different previews nests as deep as the URL allows.
        */
        ['the legacy workers.dev hostname', `https://${LEGACY}/corsproxy?url=x`, 403],
        ['a preview hostname', `https://${PREVIEW}/corsproxy?url=x`, 403],
        ['localhost', 'https://localhost/x', 403],
        ['an IPv4 literal', 'https://127.0.0.1/x', 403],
        ['a private IPv4 literal', 'https://10.0.0.1/x', 403],
        ['a link-local IPv4 literal', 'https://169.254.169.254/latest/meta-data/', 403],
        ['an IPv6 literal', 'https://[::1]/x', 403],
        ['a bare hostname with no dot', 'https://intranet/x', 403],
        ['a .local name', 'https://printer.local/x', 403],
        ['a .internal name', 'https://metadata.internal/x', 403],
        ['a non-default port on an unknown host', 'https://example.com:8080/x', 403],
        /*
            The same names with a trailing root label. The parser keeps it on a
            name, so each of these used to compare unequal to its refused
            spelling and pass. An IPv4-shaped host is different: the parser
            removes exactly one trailing empty label, so `127.0.0.1.` was
            already refused and it took two dots to get one past the literal
            regexp.
        */
        ['localhost with a trailing dot', 'https://localhost./x', 403],
        ['this deployment with a trailing dot', `https://${SELF}./corsproxy?url=x`, 403],
        ['the legacy hostname with a trailing dot', `https://${LEGACY}./corsproxy?url=x`, 403],
        ['a preview hostname with a trailing dot', `https://${PREVIEW}./corsproxy?url=x`, 403],
        ['a .local name with a trailing dot', 'https://printer.local./x', 403],
        ['a .internal name with a trailing dot', 'https://metadata.google.internal./x', 403],
        ['an IPv4 literal with two trailing dots', 'https://127.0.0.1../x', 403],
        ['the metadata address with two trailing dots', 'https://169.254.169.254../x', 403],
        ['a hostname of nothing but a dot', 'https://./x', 403],
    ])('refuses %s', (_label, target, status) => {
        expect(checkProxyTarget(target, SELF)).toMatchObject({ ok: false, status })
    })

    // The arrival hostname comes from the client's Host header, so the trailing
    // dot can be on that side of the comparison too.
    it('refuses this deployment when the arrival hostname carries the dot', () => {
        expect(checkProxyTarget(`https://${SELF}/corsproxy?url=x`, `${SELF}.`)).toMatchObject({
            ok: false,
            status: 403,
        })
    })

    // `wrangler dev` arrives on localhost, so the refusal cannot depend on
    // the request having arrived on the name it targets.
    it.each([SELF, LEGACY, PREVIEW])('refuses %s whatever the arrival hostname', hostname => {
        expect(checkProxyTarget(`https://${hostname}/corsproxy?url=x`, 'localhost')).toMatchObject({
            ok: false,
            status: 403,
        })
    })

    // And the other way round: a hostname the list does not know is still
    // refused when the request arrived on it, as a domain attached in the
    // dashboard would be.
    it('refuses the arrival hostname even when it is not on the list', () => {
        expect(
            checkProxyTarget(
                'https://blueprints.example.org/corsproxy?url=x',
                'blueprints.example.org'
            )
        ).toMatchObject({ ok: false, status: 403 })
    })

    /*
        The arms deliberately left open. Only this account's workers.dev
        subdomain is refused, so another account's Worker, a name that merely
        ends in the same letters, and a host that only starts with ours are all
        still ordinary public hosts.
    */
    it.each([
        'https://someone.otheraccount.workers.dev/x',
        'https://notwormeyman.workers.dev/x',
        `https://${LEGACY}.example.com/x`,
        `https://${SELF}.example.com/x`,
    ])('still accepts %s', target => {
        expect(checkProxyTarget(target, SELF)).toMatchObject({ ok: true, allowlisted: false })
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
    proxyTarget.ts writes this Worker's hostnames down by hand, but
    wrangler.jsonc is what decides them. A new route, or a renamed Worker,
    would leave the guard refusing names nothing serves while a real one
    passed, and no other test here would notice.
*/
describe('checkProxyTarget - agrees with wrangler.jsonc', () => {
    const config = fs.readFileSync(
        path.resolve(process.cwd(), 'packages/worker/wrangler.jsonc'),
        'utf-8'
    )

    it('refuses every custom domain the Worker is routed on', () => {
        const patterns = [...config.matchAll(/"pattern":\s*"([^"]+)"/g)].map(match => match[1])
        expect(patterns).not.toHaveLength(0)
        for (const pattern of patterns) {
            expect(checkProxyTarget(`https://${pattern}/x`, 'localhost')).toMatchObject({
                ok: false,
                status: 403,
            })
        }
    })

    it('names the legacy hostname after the Worker', () => {
        const name = config.match(/^ {4}"name":\s*"([^"]+)"/m)
        if (name === null) throw new Error('wrangler.jsonc names no Worker')
        expect(LEGACY_HOSTNAME.split('.')[0]).toBe(name[1])
    })
})

/*
    A source scan rather than a behaviour test, and it is the same answer
    tests/spec-modifier-keys.test.ts reached for its own class of bug: nothing
    that runs here can reach api.github.com, so no runner can catch the thing
    this guards.

    GitHub's API refuses a request with no User-Agent, and Cloudflare's fetch
    sends none of its own, so dropping this header silently broke the `gist`
    source in bpString.ts - and broke it in a way the whole suite stayed green
    for, because tests/blueprint-sources.spec.ts intercepts /corsproxy with
    page.route and never leaves the browser. That is exactly how it went
    unnoticed from March 2026 until it was probed against production.

    Gists now go to GitHub directly and the proxy refuses api.github.com, so
    that failure can no longer happen here. The guard stays for the second
    test: the header must remain a fixed string rather than a copy of the
    caller's, which would carry this site's cookies to the target.
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
