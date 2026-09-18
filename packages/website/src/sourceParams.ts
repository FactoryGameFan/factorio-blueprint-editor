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
