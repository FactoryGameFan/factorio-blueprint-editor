import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import {
    OWN_RESPONSE_HEADERS,
    ownHeaders,
    PROXIED_CONTENT_TYPE,
    proxyResponseHeaders,
} from '../packages/worker/src/responseHeaders'

/*
    The headers on the Responses the Worker builds itself. Same arrangement as
    tests/corsproxy.test.ts and for the reason written there: packages/worker
    is neither linted nor collected by any test project, so the logic lives in
    a pure module the `unit` project can import, and what remains in index.ts
    is checked by reading it.

    `Headers` here is Node's, which is the same WHATWG class workerd ships, so
    a value that survives `set` here survives it there.
*/

const ORIGIN = 'https://fbe.factorygamefan.com'

describe('ownHeaders - the policy on every Worker-built Response', () => {
    it('carries nosniff, a referrer policy and a CSP', () => {
        const headers = ownHeaders()
        expect(headers.get('x-content-type-options')).toBe('nosniff')
        expect(headers.get('referrer-policy')).toBe('strict-origin')
        expect(headers.get('content-security-policy')).toContain("default-src 'none'")
        expect(headers.get('content-security-policy')).toContain('sandbox')
    })

    it('keeps what the caller passed', () => {
        const headers = ownHeaders({ location: 'https://example.com/' })
        expect(headers.get('location')).toBe('https://example.com/')
        expect(headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('does not let a caller override the policy', () => {
        for (const [name] of OWN_RESPONSE_HEADERS) {
            const headers = ownHeaders({ [name]: 'something-else' })
            expect(headers.get(name), name).not.toBe('something-else')
        }
    })
})

/*
    What the proxy says about a body it relays. None of it comes from the
    upstream: proxyResponseHeaders is not handed the upstream's headers, so an
    upstream content-type - the finding - has no way back in short of changing
    its signature. tests/gist-rate-limit.test.ts and
    tests/corsproxy-redirects.test.ts drive the handler with upstream headers
    and check that none of them arrive.
*/
describe('proxyResponseHeaders - what the proxy says about a relayed body', () => {
    it('emits a fixed non-executable content type', () => {
        const headers = proxyResponseHeaders(ORIGIN)
        expect(headers.get('content-type')).toBe(PROXIED_CONTENT_TYPE)
        expect(PROXIED_CONTENT_TYPE).toMatch(/^text\/plain/)
        expect(headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('marks the body as an attachment so a navigation downloads rather than renders', () => {
        expect(proxyResponseHeaders(ORIGIN).get('content-disposition')).toBe('attachment')
    })

    it('carries the policy every Worker-built Response has', () => {
        const headers = proxyResponseHeaders(ORIGIN)
        for (const [name, value] of OWN_RESPONSE_HEADERS) {
            expect(headers.get(name), name).toBe(value)
        }
    })

    it('names only this origin, and is not cached', () => {
        const headers = proxyResponseHeaders(ORIGIN)
        expect(headers.get('cache-control')).toBe('no-store')
        expect(headers.get('access-control-allow-origin')).toBe(ORIGIN)
    })
})

/*
    A source scan for the part the pure module cannot see: that index.ts
    actually routes every Response it builds through it. Same answer as the
    user-agent guard in tests/corsproxy.test.ts - a Response.redirect or a bare
    `new Response(body, { headers: {...} })` added later would ship with no
    policy and nothing else here would notice.
*/
describe('index.ts builds every Response with the policy', () => {
    const worker = fs.readFileSync(
        path.resolve(process.cwd(), 'packages/worker/src/index.ts'),
        'utf-8'
    )

    it('never uses Response.redirect, whose headers cannot be added to', () => {
        expect(worker).not.toMatch(/Response\.redirect\(/)
    })

    it('names ownHeaders or proxyResponseHeaders in every Response it constructs', () => {
        /*
            Each `new Response(` up to its matching `)`, minus the one in
            recordVisit: that is a Cache API entry, never sent to a client.
            The three that should be here: textResponse, the proxied body,
            and the legacy-hostname redirect.
        */
        const constructions: string[] = []
        for (const match of worker.matchAll(/new Response\(/g)) {
            let depth = 0
            for (let i = match.index + match[0].length - 1; i < worker.length; i++) {
                if (worker[i] === '(') depth += 1
                if (worker[i] === ')') depth -= 1
                if (depth === 0) {
                    constructions.push(worker.slice(match.index, i + 1))
                    break
                }
            }
        }
        const sent = constructions.filter(c => !c.includes('max-age='))
        expect(sent.length).toBe(3)
        for (const construction of sent) {
            expect(construction).toMatch(/ownHeaders\(|proxyResponseHeaders\(/)
        }
    })
})
