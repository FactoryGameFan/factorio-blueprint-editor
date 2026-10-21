/*
    Reads `?source=` and `?index=` off the page's query string.

    Keys are matched exactly. The loop this replaced tested
    `p.includes('source')` against the whole `key=value` text and kept going,
    so a later parameter whose name or value held the word won: a share link
    with `&utm_source=reddit` on the end loaded "reddit" as the blueprint
    source, and `?resource=x` loaded "x". It also kept only the text between the
    first and second `=`, which cut the `=` padding off a blueprint string and
    the query off a source URL that had one.

    Not URLSearchParams, on purpose. It decodes `+` as a space, and a blueprint
    string is base64, so one pasted into a link without encoding would lose
    every `+` it holds - and bpString.ts strips whitespace before decoding, so
    the damage would be silent. decodeURIComponent leaves `+` alone, which is
    what this has always used.
*/
export interface SourceParams {
    /** `undefined` when there is no `source` key at all, `''` when it has no value. */
    source: string | undefined
    /** `0` when absent. Not validated: the caller treats anything falsy as "no index". */
    index: number
}

export function readSourceParams(search: string): SourceParams {
    let source: string | undefined
    let index = 0
    let sawIndex = false

    for (const pair of search.replace(/^\?/, '').split('&')) {
        const eq = pair.indexOf('=')
        const key = eq === -1 ? pair : pair.slice(0, eq)
        const raw = eq === -1 ? '' : pair.slice(eq + 1)

        // The first of each key wins, as URLSearchParams.get would have it.
        if (key === 'source' && source === undefined) {
            // decodeURIComponent throws URIError on malformed input (e.g.
            // ?source=%); fall back to the raw value so a bad param can't
            // abort app init.
            try {
                source = decodeURIComponent(raw)
            } catch {
                source = raw
            }
        } else if (key === 'index' && !sawIndex) {
            sawIndex = true
            index = Number(raw)
        }
    }

    return { source, index }
}

/**
 * The page's source, from the query or else from the fragment (#570).
 *
 * The query wins, and wins whole - its `index` comes with it - so every link
 * that worked before the fragment was read still loads the same blueprint:
 * the README's, and the ones factorio.school and factorioprints build. The
 * fragment is read with the same rules as the query, `+` included.
 */
export function readPageSourceParams(search: string, hash: string): SourceParams {
    const query = readSourceParams(search)
    if (query.source !== undefined) return query
    const fragment = readSourceParams(hash.replace(/^#/, ''))
    return fragment.source === undefined ? query : fragment
}

/**
 * A link that opens `bpString` in this editor, for ExportDialog's Copy link
 * button (#570).
 *
 * In the fragment rather than the query, for two reasons. A browser never
 * sends the fragment to the server, so the blueprint stays out of the
 * Worker's request logs, and Cloudflare's edge refuses a query over about
 * 64 KB with a 414, which 9 of the 16 corpus files exceed. The string goes in
 * as it is: base64's `+`, `/` and `=` are all legal in a fragment, and
 * `readSourceParams` keeps `+`. No `index`, because a book's string carries
 * its own `active_index`.
 */
export function buildShareLink(origin: string, bpString: string): string {
    return `${origin}/#source=${bpString}`
}

/**
 * Discord's message cap without Nitro, where most Factorio sharing happens.
 * A link longer than this still works; it just cannot be pasted there whole.
 */
export const DISCORD_MESSAGE_LIMIT = 2000

/** The toast after a link is copied: its length, when that is long enough to matter. */
export function shareLinkCopiedText(link: string): string {
    if (link.length <= DISCORD_MESSAGE_LIMIT) return 'Link copied to clipboard'
    return (
        `Link copied to clipboard. It is ${link.length.toLocaleString('en-US')} characters long; ` +
        `a Discord message allows ${DISCORD_MESSAGE_LIMIT.toLocaleString('en-US')}.`
    )
}
