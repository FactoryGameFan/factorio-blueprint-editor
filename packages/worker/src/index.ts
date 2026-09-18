import { checkProxyTarget, MAX_PROXY_BYTES, MAX_PROXY_REDIRECTS } from './proxyTarget'
import { ownHeaders, proxyResponseHeaders } from './responseHeaders'
import {
    DEDUPE_WINDOW_SECONDS,
    dedupeKey,
    isPageView,
    utcDay,
    visitorFingerprint,
} from './visitorCount'

interface Env {
    ASSETS: Fetcher
    /*
        Optional, and that is the whole reason this counter can ship without a
        dashboard visit first. An Analytics Engine dataset is created by its
        first write, so the binding needs no id in wrangler.jsonc - but a
        `wrangler dev` run started before the binding existed, or a future
        deploy that drops it, then finds `undefined` here rather than throwing
        on a page load. Optional plus the `?.` at the call site means the site
        serves either way and only the count stops.
    */
    VISITS?: AnalyticsEngineDataset
}

const LEGACY_HOSTNAME = 'fbeworkeyman.wormeyman.workers.dev'
const CUSTOM_ORIGIN = 'https://fbe.factorygamefan.com'

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

    Gists no longer come through here. The editor asks api.github.com directly,
    and checkProxyTarget refuses it, so no host this proxy still fetches is
    known to need the header. It stays because a fixed string is still the
    right way for the proxy to name itself to a target, and the paragraph above
    is why it must never become a copy of the caller's headers.
*/
const PROXY_USER_AGENT = 'factorio-blueprint-editor (+https://fbe.factorygamefan.com)'

/*
    Every Response this Worker builds goes through here or through
    proxyResponseHeaders, and nowhere else: the asset router applies
    public/_headers to what it serves, but a Response the Worker returns
    itself carries exactly the headers it was given. See responseHeaders.ts.
*/
const textResponse = (status: number, body: string): Response =>
    new Response(`${body}\n`, {
        status,
        headers: ownHeaders({ 'content-type': 'text/plain; charset=utf-8' }),
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

    return proxyHop(request.method, verdict.url, requestUrl, 0)
}

// The statuses the fetch standard follows. Any other 3xx is relayed as-is,
// as it was when the runtime did the following.
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/*
    One hop of a proxied request, and the next one if it redirects.

    Redirects are followed here rather than by the runtime, so that every URL
    this Worker fetches has passed checkProxyTarget - the first one in
    handleCorsProxy, and each Location below. With `redirect: 'follow'` the
    check bound the caller's URL only, and the runtime went wherever the
    target sent it next: measured under `wrangler dev --local`, workerd
    follows a 302 to another port without asking. `'manual'` hands back the
    3xx itself, status and Location intact, and a relative Location exactly
    as sent, which is why it is resolved against this hop's URL.

    A refused hop gets the status and reason the rule gives, as a refused
    first URL does: it is the same rule, and a 403 says the proxy refused
    rather than that something upstream failed. The two cases that are not a
    rule - a Location missing or unparseable, and a chain past
    MAX_PROXY_REDIRECTS - are 502, the proxy's own answer for an upstream it
    could not use. Relaying the 3xx instead would not help anyone: the
    Location is not among the headers proxyResponseHeaders passes through, so
    the editor would get a redirect with nowhere to go.

    Only GET and HEAD reach this far, so a 303's switch to GET never changes
    the method, and it is passed along unchanged.
*/
async function proxyHop(
    method: string,
    target: URL,
    requestUrl: URL,
    redirects: number
): Promise<Response> {
    let upstream: Response
    try {
        upstream = await fetch(target.href, {
            method,
            redirect: 'manual',
            headers: { 'user-agent': PROXY_USER_AGENT },
        })
    } catch {
        return textResponse(502, 'Could not reach the target')
    }

    if (REDIRECT_STATUSES.has(upstream.status)) {
        // Not followed through the body, so release the connection now, as
        // the 413 branch below does.
        void upstream.body?.cancel()

        const location = upstream.headers.get('location')
        let next: URL | undefined
        try {
            if (location !== null) next = new URL(location, target)
        } catch {
            // Unparseable, and answered below the same way as missing.
        }
        if (next === undefined) {
            return textResponse(502, 'The target redirected without a usable Location')
        }

        const verdict = checkProxyTarget(next.href, requestUrl.hostname)
        if (!verdict.ok) {
            return textResponse(
                verdict.status,
                `The target redirected to a URL that is not proxied: ${verdict.reason}`
            )
        }

        if (redirects >= MAX_PROXY_REDIRECTS) {
            return textResponse(502, 'The target redirected too many times')
        }

        return proxyHop(method, verdict.url, requestUrl, redirects + 1)
    }

    const declared = Number(upstream.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_PROXY_BYTES) {
        // Not relaying it is not the same as not receiving it: an unread body
        // holds the upstream connection open until the runtime gives up on it.
        void upstream.body?.cancel()
        return textResponse(413, 'The target response is too large to proxy')
    }

    return new Response(upstream.body === null ? null : capBody(upstream.body, MAX_PROXY_BYTES), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: proxyResponseHeaders(upstream.headers, requestUrl.origin),
    })
}

/*
    Count this navigation, unless the visitor already counted today.

    Runs inside ctx.waitUntil, so none of it is on the path to the response: the
    Cache API lookup and the data point are work the runtime finishes after the
    HTML has gone out. Nothing in here can fail the request either - the whole
    body is wrapped, because an analytics counter that can take the site down
    is a worse deal than no counter.

    The two halves are deliberately different stores. Dedupe state goes in the
    Cache API, which is per-colo, evictable and free; the count goes to Analytics
    Engine, which is durable and queryable. visitorCount.ts explains what the
    first of those costs in accuracy.

    One place the dedupe would do nothing at all: the Cache API is inert on
    workers.dev. Nothing on workers.dev reaches this point, though. Production
    is a custom domain (`routes` in wrangler.jsonc), the bare legacy hostname
    301s out above, and preview URLs are off. If they are ever turned back on,
    a load of a versioned preview hostname counts on every request rather than
    once a day, which is worth knowing before reading a preview's numbers as
    real.

    Reading the result. Analytics Engine has no dashboard view of its own - this
    is the number the beacon in packages/website/index.html cannot see, and it
    is read over the SQL API:

        SELECT blob1 AS day, SUM(_sample_interval) AS uniques
        FROM fbe_unique_visitors
        WHERE timestamp > NOW() - INTERVAL '30' DAY
        GROUP BY day ORDER BY day

    posted to /accounts/<id>/analytics_engine/sql. One data point is one
    deduped visitor-day, so that sum is the answer directly. It has to be
    written that way round: Analytics Engine has no uniq() or COUNT(DISTINCT),
    which is why the deduplication happens above at write time rather than in
    the query.
*/
async function recordVisit(request: Request, url: URL, env: Env): Promise<void> {
    try {
        const day = utcDay(new Date())
        const fingerprint = await visitorFingerprint({
            ip: request.headers.get('cf-connecting-ip'),
            userAgent: request.headers.get('user-agent'),
            acceptLanguage: request.headers.get('accept-language'),
            day,
        })

        const cache = caches.default
        const key = new Request(dedupeKey(url.origin, day, fingerprint), { method: 'GET' })
        if (await cache.match(key)) return

        /*
            A one-byte body rather than a bodiless 204. Only the presence of the
            entry is read, and the byte costs nothing, but a cache that declines
            to store an empty response would fail silently and count every
            visitor on every load - the failure would look exactly like traffic.
        */
        await cache.put(
            key,
            new Response('1', {
                status: 200,
                headers: { 'cache-control': `max-age=${DEDUPE_WINDOW_SECONDS}` },
            })
        )

        const country = typeof request.cf?.country === 'string' ? request.cf.country : 'XX'
        env.VISITS?.writeDataPoint({
            // The day is stored rather than derived from `timestamp` so a query
            // groups on the same UTC boundary the dedupe window uses.
            blobs: [day, country],
            doubles: [1],
            // Analytics Engine samples per index once a dataset gets busy, so
            // this is what SUM(_sample_interval) scales back up. Country rather
            // than the fingerprint: an index is a filter key, and putting a
            // per-visitor value there would both store the identifier this
            // design keeps out of the dataset and shard sampling per visitor.
            indexes: [country],
        })
    } catch {
        // Deliberately silent. Workers Logs is unsampled (wrangler.jsonc), and a
        // counter that logs its own failure once per request would be the
        // loudest thing in the log at exactly the moment something else is
        // wrong.
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url)

        // Redirect the legacy workers.dev hostname to the custom domain,
        // preserving the path and query string. It is the only workers.dev
        // name that reaches this Worker: preview URLs are off in
        // wrangler.jsonc, so no versioned hostname routes here at all.
        //
        // Built by hand rather than with Response.redirect, whose headers are
        // immutable: this is a Response the Worker returns itself, so it takes
        // the same policy as the rest.
        if (url.hostname === LEGACY_HOSTNAME) {
            return new Response(null, {
                status: 301,
                headers: ownHeaders({ location: `${CUSTOM_ORIGIN}${url.pathname}${url.search}` }),
            })
        }

        if (url.pathname === '/corsproxy') return handleCorsProxy(request, url)

        /*
            Count the navigation, then serve the app. After the legacy-hostname
            redirect above on purpose: a request that bounces to the custom
            domain is followed by a request that lands on it, and counting both
            would score one visitor twice.
        */
        if (
            isPageView({
                method: request.method,
                pathname: url.pathname,
                accept: request.headers.get('accept'),
            })
        ) {
            ctx.waitUntil(recordVisit(request, url, env))
        }

        // Serve static assets
        return env.ASSETS.fetch(request)
    },
} satisfies ExportedHandler<Env>
