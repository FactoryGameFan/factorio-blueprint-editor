import { deflateSync, inflateSync } from 'zlib'

/*
    Builds the blueprint strings bpString.decode() reads, for the specs whose case
    cannot come out of test-blueprints/ - anything about a version other than the
    2.0.32+ the corpus declares, or about a prototype name that is deliberately
    not in FD.

    The other two synthetic builders (all-entities-blueprint, all-recipes-blueprint)
    hand back a source string of their own and do not need this; they are building a
    corpus, this is for hand-written one-off cases.
*/

/** The encoding decode() expects: a version byte, then deflated JSON. */
export function encodeBlueprint(blueprint: Record<string, unknown>): string {
    return wrap({ blueprint })
}

/**
 * The same, for a book. The corpus has books, but every one of them is a real
 * export whose nesting and active_index the spec did not choose - which is no
 * use for asserting that a particular index resolves to a particular blueprint.
 */
export function encodeBlueprintBook(blueprint_book: Record<string, unknown>): string {
    return wrap({ blueprint_book })
}

function wrap(data: Record<string, unknown>): string {
    return `0${deflateSync(Buffer.from(JSON.stringify(data))).toString('base64')}`
}

/**
 * The inverse, for reading back what the editor encoded. Asserting on the
 * decoded object rather than on a reload is the point where a book is concerned:
 * `active_index` decides nothing about which entities come back, so a reload
 * cannot see it being written wrong.
 */
export function decodeBlueprintString(source: string): Record<string, any> {
    return JSON.parse(inflateSync(Buffer.from(source.slice(1), 'base64')).toString())
}

/** How Factorio packs a version into the blueprint's `version` field. */
export function packVersion(main: number, major: number, minor: number, dev = 0): number {
    return main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16 + dev
}
