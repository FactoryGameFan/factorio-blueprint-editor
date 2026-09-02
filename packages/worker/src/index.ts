import { checkProxyTarget, MAX_PROXY_BYTES } from './proxyTarget'

interface Env {
    ASSETS: Fetcher
}

const LEGACY_HOSTNAME = 'fbeworkeyman.wormeyman.workers.dev'
const CUSTOM_ORIGIN = 'https://fbe.factorygamefan.com'

/*
    Response headers the proxy re-emits. Everything else upstream sent is
    dropped, which is the change from the old handler: that one did
    `new Headers(resp.headers)` and copied the lot, so a target's Set-Cookie
    landed on our origin and its caching directives spoke for our domain.
*/
const PASSTHROUGH_RESPONSE_HEADERS = ['content-type']

/*
    Sent on every outbound fetch, because GitHub's API refuses a request without
    one: `api.github.com` answers 403 "Request forbidden by administrative rules.
    Please make sure your request has a User-Agent header." Cloudflare's fetch
    sends none of its own, so the `gist` source in bpString.ts has been broken
    since this Worker replaced the Cloudflare Pages deploy in March 2026 - the
    Pages handler used `new Request(apiUrl, request)`, which copied the browser's
    User-Agent along with everything else.

    A fixed string rather than the caller's, and that distinction is the whole
    reason this is one line instead of a header copy. Forwarding the client's
    headers is what the old handler did, and for a same-origin call those include
    cookies for fbe.factorygamefan.com - which would then be handed to pastebin.

    Nothing can test this. tests/blueprint-sources.spec.ts covers the gist arm and
    is green, because it intercepts /corsproxy with page.route and never reaches
    GitHub; no runner here has network access to it either. The guard in
    tests/corsproxy.test.ts reads this file instead, which is the same answer
    tests/spec-modifier-keys.test.ts reached for its own untestable class.

    Measured 2026-08-25: of the eight allowlisted hosts, api.github.com is the
    only one that answers differently with and without this header.
*/
const PROXY_USER_AGENT = 'factorio-blueprint-editor (+https://fbe.factorygamefan.com)'

const textResponse = (status: number, body: string): Response =>
    new Response(`${body}\n`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    })

/*
    Fail the stream once a target has sent more than MAX_PROXY_BYTES rather than
    relaying it. Content-Length is checked first where the target declares one,
    but it is optional and a chunked response omits it, so the counter is what
    actually enforces the bound.

    Erroring mid-body means the caller sees a 200 whose read then fails.
    packages/editor/src/core/bpString.ts only inspects `response.ok`, so that
    surfaces as a corrupt-blueprint error - the same shape as the HTML-login-page
    case already recorded in that file's comment (issue #98).
*/
function capBody(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
    let seen = 0
    return body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                seen += chunk.byteLength
                if (seen > max) {
                    controller.error(new Error(`Proxied response exceeded ${max} bytes`))
                    return
                }
                controller.enqueue(chunk)
            },
        })
    )
}

async function handleCorsProxy(request: Request, requestUrl: URL): Promise<Response> {
    // The editor only ever GETs. Forwarding request.method the way the old
    // handler did turned this into a relay for POST and DELETE as well.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse(405, 'Only GET and HEAD are proxied')
    }

    const verdict = checkProxyTarget(requestUrl.searchParams.get('url'), requestUrl.hostname)
    if (!verdict.ok) return textResponse(verdict.status, verdict.reason)

    let upstream: Response
    try {
        upstream = await fetch(verdict.url.href, {
            method: request.method,
            redirect: 'follow',
            headers: { 'user-agent': PROXY_USER_AGENT },
        })
    } catch {
        return textResponse(502, 'Could not reach the target')
    }

    const declared = Number(upstream.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_PROXY_BYTES) {
        return textResponse(413, 'The target response is too large to proxy')
    }

    const headers = new Headers()
    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value !== null) headers.set(name, value)
    }

    /*
        Scoped to this deployment's own origin rather than `*`.

        The editor's own call is same-origin - bpString.ts fetches the relative
        `/corsproxy?url=...` - so it needs no CORS header at all, and naming our
        own origin is the narrowest value that still says out loud who the
        endpoint is for. The old `*` handed every proxied body to any page on
        the internet that cared to ask.

        No Vary: Origin, deliberately, though the dead Pages handler carried one.
        Vary earns its place when the header reflects the request's Origin; this
        value is constant, so a shared cache cannot mix two callers up and the
        header would only be cargo. There is no OPTIONS arm for the same reason:
        a same-origin simple GET never preflights, and a cross-origin caller is
        refused by the line below before a preflight would matter.
    */
    headers.set('access-control-allow-origin', requestUrl.origin)

    // Third-party content served from our origin should not be cached as though
    // we published it, and a blueprint is fetched once per load anyway.
    headers.set('cache-control', 'no-store')

    return new Response(upstream.body === null ? null : capBody(upstream.body, MAX_PROXY_BYTES), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    })
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)

        // Redirect the legacy workers.dev hostname to the custom domain,
        // preserving the path and query string. Exact-match on purpose: the
        // versioned preview hostnames (<version>-fbeworkeyman.workers.dev) are
        // meant to serve the app rather than bounce to production.
        if (url.hostname === LEGACY_HOSTNAME) {
            return Response.redirect(`${CUSTOM_ORIGIN}${url.pathname}${url.search}`, 301)
        }

        if (url.pathname === '/corsproxy') return handleCorsProxy(request, url)

        // Serve static assets
        return env.ASSETS.fetch(request)
    },
} satisfies ExportedHandler<Env>
