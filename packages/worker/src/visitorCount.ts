/*
    Deciding whether a request counts as one visitor, and what key dedupes it.

    Split out of index.ts for the same reason proxyTarget.ts was, and that file's
    header explains it at length: `packages/worker` sits in `lint.ignorePatterns`
    (vite.config.ts) and no test project collects from it, so a pure module is
    the only part of this Worker a test can reach. tests/visitor-count.test.ts
    runs everything below in the `unit` project. The Cache API lookup and the
    writeDataPoint call stay in index.ts and run nowhere but production.

    What "unique visitor" means here, stated plainly because every analytics
    product means something different by it:

      one GET of `/` per (IP + User-Agent + Accept-Language) per UTC day,
      counted once per Cloudflare colo.

    The colo qualifier is the honest part. The dedupe store is the Workers Cache
    API, which is per-colo and evictable, so a visitor who moves between colos
    inside a day - a phone leaving wifi, an anycast reroute - counts more than
    once. The bias is one-directional: this over-counts, never under-counts, and
    the overshoot is bounded by how many colos one person passes through in a
    day, which is normally one. That was the price of needing no provisioning:
    a KV namespace or a Durable Object would dedupe globally, but both need an
    id pasted into wrangler.jsonc from the dashboard before a deploy works, and
    a Worker whose deploy breaks on a missing binding id is a worse trade than a
    count that runs a few percent high. An Analytics Engine dataset, by
    contrast, is created by its first write.

    No visitor identifier is ever stored. The fingerprint below exists only as a
    cache key inside the 24h dedupe window; the data point written to Analytics
    Engine carries the day, the country and the number 1, and nothing that
    distinguishes one visitor from another. So there is nothing to leak from the
    queryable side and nothing to subject-access-request, which is also why this
    sets no cookie and needs no consent banner.
*/

/*
    The dedupe window. A UTC day rather than a rolling 24 hours because the day
    stamp is part of the fingerprint, so every visitor's window ends at the same
    instant and a daily query does not straddle two windows.

    The Cache API entry is given the same lifetime. It expiring early only
    re-counts a visitor who returns later the same day; it cannot double-count
    inside one page load, because a single navigation is a single request.
*/
export const DEDUPE_WINDOW_SECONDS = 86_400

/*
    What the Worker actually sees. `run_worker_first` in wrangler.jsonc is scoped
    to ["/", "/corsproxy"], so every other path - all 9,097 asset files - is
    served by ASSETS without this code running at all. That scoping is a cost
    control (read the comment there), but it is also what makes this counter
    cheap and accurate: the Worker runs about once per navigation, so counting
    here needs no filtering of sprite and bundle traffic.

    The editor is a single page app, so a deep link is still `/` with a query
    string - `?source=<blueprint>` does not change the path. One navigation, one
    candidate visit, whether the visitor typed the domain or followed a
    blueprint link.
*/
export interface PageViewCandidate {
    method: string
    pathname: string
    /** The request's `Accept` header, or null when it sent none. */
    accept: string | null
}

/*
    Three conditions, each of which excludes something real:

    GET drops HEAD, which uptime checks and link unfurlers send and which no
    human generates.

    `/` drops `/corsproxy`. That path reaches this Worker too, and a blueprint
    import fires one on top of the navigation that already counted - counting it
    would score anyone who imports from pastebin twice.

    An `Accept` that mentions HTML is what separates a browser navigating from a
    fetch of the same URL. `text/html` is what a navigation sends; a wildcard
    Accept is what a bare script or curl sends. This is a filter on shape, not a bot
    check: a crawler that sends a browser's Accept header still counts, and the
    only honest way to say how many of these are crawlers is to compare this
    number against the Web Analytics beacon, which runs JavaScript and so counts
    almost none of them. That divergence is the point of running both.
*/
export function isPageView({ method, pathname, accept }: PageViewCandidate): boolean {
    if (method !== 'GET') return false
    if (pathname !== '/') return false
    return accept !== null && accept.includes('text/html')
}

/** `2026-09-03` in UTC. The dedupe window and the reporting bucket both. */
export function utcDay(now: Date): string {
    return now.toISOString().slice(0, 10)
}

export interface VisitorSignal {
    /** `CF-Connecting-IP`. Absent on a request Cloudflare did not proxy. */
    ip: string | null
    userAgent: string | null
    acceptLanguage: string | null
    /** From utcDay(), so yesterday's fingerprint cannot match today's. */
    day: string
}

/*
    A fingerprint, not an identity. SHA-256 over the four fields below, hex, and
    the day stamp is in the hash rather than beside it so the value itself
    rotates every midnight UTC - a fingerprint kept past its window matches
    nobody.

    Deliberately not salted with a secret. A salt would make the hash harder to
    reverse, and reversing it is not the risk worth defending against here: the
    value never leaves the edge cache, never reaches Analytics Engine, and is
    gone within a day. A secret would have to live in wrangler.jsonc or in a
    Worker secret, which is one more thing to provision and rotate for a value
    that is already unlinkable across days.

    Missing headers collapse to empty strings rather than being rejected. Two
    visitors behind one IP with no User-Agent at all would then share a
    fingerprint and count once, which is the same direction as every other
    approximation here and rarer than all of them.
*/
export async function visitorFingerprint({
    ip,
    userAgent,
    acceptLanguage,
    day,
}: VisitorSignal): Promise<string> {
    const material = [day, ip ?? '', userAgent ?? '', acceptLanguage ?? ''].join('\n')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/*
    The cache key. Built on the deployment's own origin on purpose: the Workers
    Cache API keys on a URL, and one inside the zone the Worker already serves
    is the case Cloudflare documents. Nothing ever fetches it - `/__visitor/...`
    is not a route, and a request for it would be served the SPA like any other
    unknown path - so this reserves a key space rather than an endpoint.

    The day is in the path as well as in the fingerprint, which is redundant for
    matching and worth it for reading: a cache key that says which day it
    belongs to can be reasoned about from a log line.
*/
export function dedupeKey(origin: string, day: string, fingerprint: string): string {
    return `${origin}/__visitor/${day}/${fingerprint}`
}
