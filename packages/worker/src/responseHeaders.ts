/*
    The headers on every Response this Worker builds itself.

    Kept free of every Cloudflare type for the same reason proxyTarget.ts is:
    nothing in packages/worker is linted, type-checked or run by `vp check` or
    `vp test`, and a pure module can be imported from tests/corsproxy.test.ts,
    which the `unit` project does collect. `Headers` is a global in Node as it
    is in workerd, so what runs there is what runs in production.

    Why this exists. packages/website/public/_headers is the only place this
    project declares nosniff, Referrer-Policy and a CSP, and only Cloudflare's
    asset router reads it. `/corsproxy` is on `run_worker_first`, so its
    Response goes out exactly as the Worker built it - measured, `env.ASSETS`
    is never consulted on that route - and so did every error and redirect the
    Worker writes. That left the one route serving third-party bytes as the one
    route with no header policy at all.
*/

/*
    Stricter than the app's own CSP, on purpose. Nothing this Worker builds is
    a document anyone should run: a text/plain error, a redirect, or a proxied
    body the editor reads with `r.text()`. So `default-src 'none'` rather than
    the app's `'self'`, and `sandbox` on top, which for a visitor who navigates
    to one of these URLs means the page cannot run script, submit a form, or
    share the site's origin however it was sniffed.
*/
export const OWN_RESPONSE_HEADERS: ReadonlyArray<readonly [string, string]> = [
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin'],
    ['content-security-policy', "default-src 'none'; frame-ancestors 'none'; sandbox"],
]

/** `init` first, then the policy on top - the policy is not something a caller can unset. */
export function ownHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init)
    for (const [name, value] of OWN_RESPONSE_HEADERS) headers.set(name, value)
    return headers
}

/*
    Response headers the proxy re-emits from the upstream. Everything else it
    sent is dropped, which was the change from the old handler: that one did
    `new Headers(resp.headers)` and copied the lot, so a target's Set-Cookie
    landed on our origin and its caching directives spoke for our domain.

    `content-type` used to be on this list, and that was the hole. The
    catch-all in proxyTarget.ts accepts any public https host, so the upstream
    is whoever the link's author chose - and a visitor who navigated to a
    crafted `/corsproxy?url=` got that upstream's bytes rendered as whatever
    media type it declared, under this site's hostname. `Headers.set` refuses
    CR, LF and NUL, so the header itself could not be split; the value was the
    whole problem.
*/
export const PASSTHROUGH_RESPONSE_HEADERS: ReadonlySet<string> = new Set(['x-ratelimit-remaining'])

/*
    A fixed type, whatever the upstream said. Every consumer in bpString.ts
    reads the body with `r.text()` or `r.json()`, neither of which consults
    Content-Type, so this changes nothing for the editor - and it is what
    stops a navigation to the proxy from rendering a page.

    `attachment` is the second half of the same guard. With nosniff and a
    non-executable type a browser will not run the body, but it would still
    display it; a download prompt is the honest answer to a URL that was never
    meant to be visited. fetch() ignores Content-Disposition, so again the
    editor sees no difference.
*/
export const PROXIED_CONTENT_TYPE = 'text/plain; charset=utf-8'

export function proxyResponseHeaders(upstream: Headers, origin: string): Headers {
    const headers = ownHeaders()
    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
        const value = upstream.get(name)
        if (value !== null) headers.set(name, value)
    }

    headers.set('content-type', PROXIED_CONTENT_TYPE)
    headers.set('content-disposition', 'attachment')

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
    headers.set('access-control-allow-origin', origin)

    // Third-party content served from our origin should not be cached as though
    // we published it, and a blueprint is fetched once per load anyway.
    headers.set('cache-control', 'no-store')

    return headers
}
