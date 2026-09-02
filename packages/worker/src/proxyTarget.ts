/*
    Deciding whether /corsproxy may fetch a given target.

    Split out of index.ts and kept free of every Cloudflare type on purpose.
    `packages/worker` sits in `lint.ignorePatterns` (vite.config.ts), so nothing
    in this package is linted or type-checked by `vp check`, and no test project
    collects from it either - `vp test` reads packages/editor, scripts/ and
    tests/, and that is all. A pure module can be imported from
    tests/corsproxy.test.ts, which the `unit` project does collect, so the
    allowlist and the guards below run in CI. The fetch itself, the header
    rebuild and the size cap in index.ts still run nowhere but production.

    What this can and cannot do. It reads the URL it is handed and nothing else:
    a Worker has no DNS resolution API, so a perfectly ordinary public hostname
    that resolves to 127.0.0.1 passes every check here. That is not the hole it
    looks like - Cloudflare does not route Workers' fetch into RFC1918 space -
    but it is the reason the literal-IP rule below is written as defence in
    depth rather than as the boundary.
*/

/*
    The hosts the editor itself asks for, which are the rewritten targets rather
    than the ones a user types: packages/editor/src/core/bpString.ts turns a
    pastebin page URL into pastebin.com/raw/<id>, a gist URL into api.github.com,
    and so on. Read them off the `switch` there, not off its doc comment.

    `facorio-blueprints` is spelled that way upstream - it is the real Firebase
    project name behind factorioprints, typo included, and correcting it here
    would break the one source it serves.
*/
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
    'pastebin.com',
    'hastebin.com',
    'api.github.com',
    'gitlab.com',
    'facorio-blueprints.firebaseio.com',
    'www.factorio.school',
    'factorio.school',
    'factorioprints.xyz',
    'www.factorioprints.xyz',
    'factoriobin.com',
    'docs.google.com',
])

/*
    16 MiB, and the number is measured rather than picked. The largest real
    blueprint in test-blueprints/ is pocket-base-space-age-v22.1.2.txt at
    2,417,093 bytes, and several sources wrap that string in JSON on the way
    back (the gist API, factorio.school, the firebase record), so the transferred
    payload runs above the string itself. This leaves roughly 6x headroom over
    the largest thing known to be legitimate while still bounding what the proxy
    will relay in one request.
*/
export const MAX_PROXY_BYTES = 16 * 1024 * 1024

export type TargetVerdict =
    | { ok: true; url: URL; allowlisted: boolean }
    | { ok: false; status: number; reason: string }

const deny = (status: number, reason: string): TargetVerdict => ({ ok: false, status, reason })

/*
    An IPv4 literal, an IPv6 literal in brackets, or a bare hostname with no dot.

    Every literal is rejected for a non-allowlisted target rather than only the
    private ranges. Parsing 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 and
    their IPv6 equivalents correctly is more code than it looks, gets the
    IPv4-mapped forms wrong on the first try, and buys nothing here: no
    blueprint host is an IP address, so the complete rule is both simpler and
    stricter than the partial one.
*/
function isAddressLiteralOrBareName(hostname: string): boolean {
    if (hostname.startsWith('[')) return true
    if (/^\d+(\.\d+)*$/.test(hostname)) return true
    return !hostname.includes('.')
}

const INTERNAL_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']

export function checkProxyTarget(raw: string | null, selfHostname: string): TargetVerdict {
    if (raw === null || raw === '') return deny(400, 'Missing url parameter')

    let url: URL
    try {
        url = new URL(raw)
    } catch {
        return deny(400, 'The url parameter is not a valid URL')
    }

    // Every arm of bpString.ts builds an https URL - the catch-all does
    // `https://${DATA.replace(/https?:\/\//g, '')}` - so nothing legitimate
    // arrives on another scheme, and this closes file:, data: and blob:.
    if (url.protocol !== 'https:') return deny(403, 'Only https targets are proxied')

    // Credentials in a proxied URL are never something the editor produced.
    if (url.username !== '' || url.password !== '') {
        return deny(403, 'Targets may not carry credentials')
    }

    // Without this the Worker will happily fetch itself, and /corsproxy?url=
    // pointing at /corsproxy?url= is a loop that costs a subrequest per hop.
    if (url.hostname === selfHostname) return deny(403, 'Refusing to proxy this deployment')

    if (ALLOWED_HOSTS.has(url.hostname)) return { ok: true, url, allowlisted: true }

    /*
        Everything below applies only to the catch-all. The editor's `default:`
        arm fetches whatever host a user pasted, which is a real feature -
        tests/blueprint-sources.spec.ts:168 pins it - so the answer here is to
        narrow what an arbitrary target may be, not to refuse one.
    */
    const hostname = url.hostname.toLowerCase()

    if (hostname === 'localhost' || isAddressLiteralOrBareName(hostname)) {
        return deny(403, 'Targets must be a public hostname')
    }

    if (INTERNAL_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
        return deny(403, 'Targets must be a public hostname')
    }

    // A non-default port on an arbitrary host is port scanning far more often
    // than it is a blueprint. Allowlisted hosts are exempt above.
    if (url.port !== '' && url.port !== '443') {
        return deny(403, 'Only the default https port is proxied for unrecognised hosts')
    }

    return { ok: true, url, allowlisted: false }
}
