import { deflateSync } from 'zlib'

/*
    Builds the blueprint strings bpString.decode() reads, for the specs whose case
    cannot come out of wormeyman-tests/ - anything about a version other than the
    2.0.45+ the corpus declares, or about a prototype name that is deliberately
    not in FD.

    The other two synthetic builders (all-entities-blueprint, all-recipes-blueprint)
    hand back a source string of their own and do not need this; they are building a
    corpus, this is for hand-written one-off cases.
*/

/** The encoding decode() expects: a version byte, then deflated JSON. */
export function encodeBlueprint(blueprint: Record<string, unknown>): string {
    return `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`
}

/** How Factorio packs a version into the blueprint's `version` field. */
export function packVersion(main: number, major: number, minor: number, dev = 0): number {
    return main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16 + dev
}
