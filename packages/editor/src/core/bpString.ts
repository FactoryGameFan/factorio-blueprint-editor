import Ajv, { KeywordDefinition } from 'ajv'
import * as pako from 'pako'
import { IBlueprint, IBlueprintBook, IBlueprintBookEntry } from '../types'
import G from '../common/globals'
import FD from './factorioData'
import blueprintSchema from './blueprintSchema.json'
import { Blueprint } from './Blueprint'
import { Book } from './Book'
import { migrateNames } from './nameMigrations'

/*
    Base64 without the `buffer` polyfill, which was pulled into the bundle for
    these two calls and nothing else - 26 kB of a 799 kB entry chunk, measured.

    The leniency is reproduced rather than dropped, because these two are the
    only way a blueprint string enters or leaves the editor and this change is
    meant to be invisible. `Buffer.from(s, 'base64')` ignores every character
    outside the alphabet and accepts the URL-safe one.

    `atob` covers **less** of that than it looks, and the split was measured
    rather than assumed - a first draft of this comment had it wrong. `atob`
    implements the WHATWG forgiving-base64 algorithm, so it strips ASCII
    whitespace and tolerates missing padding **on its own**: a wrapped string
    needs nothing from us. What it does throw on is the URL-safe alphabet
    (`a-b_` is a DOMException) and any single stray character, which is what a
    quote mark or an ellipsis picked up from a chat client or a PDF looks like.
    Those two are what the normalisation below is for, and mutation-checking
    says so - removing it fails exactly the URL-safe and stray-character tests
    in tests/blueprint-string-tolerance.spec.ts and leaves the whitespace ones
    passing.
*/
const base64ToBytes = (s: string): Uint8Array => {
    const normalised = s
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/[^A-Za-z0-9+/]/g, '')
    const binary = atob(normalised)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const bytesToBase64 = (bytes: Uint8Array): string => {
    /* Chunked because String.fromCharCode takes its input as arguments, and a
       blueprint of any size overflows the argument limit in one call. */
    const CHUNK = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
}

class CorruptedBlueprintStringError {
    public error: unknown
    public constructor(error: unknown) {
        this.error = error
    }
}

class BookWithNoBlueprintsError {
    public error = 'Blueprint book contains no blueprints!'
}

/**
 * There was nothing to import - an empty `?source=`, or a paste from an empty
 * clipboard (issue #298).
 *
 * A rejection rather than an empty `Blueprint`, which is what the issue first
 * proposed, because every caller pipes a resolved value straight into `loadBp`
 * -> `Editor.loadBlueprint`, which assigns `G.bp` and destroys the old
 * container. `History` is per-`Blueprint`, so the replacement carries an empty
 * undo stack - the mechanism issue #279 measured. Resolving would have turned a
 * confusing message into a silent wipe on any stray Ctrl+V. Rejecting reaches
 * the catch every caller already has, none of which loads anything.
 *
 * Its own class, and not a bare `Error`, so `createBPImportError` can tell it
 * from a real failure: an unrecognised error there renders through
 * `createErrorMessage`, which asks the user to report a bug on github. An empty
 * clipboard is not a bug to report.
 */
class EmptyBlueprintStringError {
    public error = 'There was nothing to import.'
}

const keywords: KeywordDefinition[] = [
    {
        keyword: 'entityName',
        validate: (data: string) => !!FD.entities[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'itemName',
        validate: (data: string) => !!FD.items[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'fluidName',
        validate: (data: string) => !!FD.fluids[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'recipeName',
        validate: (data: string) => !!FD.recipes[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'tileName',
        validate: (data: string) => !!FD.tiles[data],
        errors: false,
        schema: false,
    },
    {
        keyword: 'itemFluidSignalRecipeEntityName',
        validate: () => true,
        errors: false,
        schema: false,
    },
]

type StringData = { blueprint?: IBlueprint; blueprint_book?: IBlueprintBook }

const validate = new Ajv({
    keywords,
    verbose: true,
    strict: true,
    allowUnionTypes: true,
}).compile<StringData>(blueprintSchema)

let loadWarnings: string[] = []

function getAndClearLoadWarnings(): string[] {
    const warnings = loadWarnings
    loadWarnings = []
    return warnings
}

/**
 * The prototype names a blueprint used that this build does not have, by kind.
 * Both kinds have to be dropped before the blueprint reaches the model: an
 * unknown entity throws in the sprite builder, and an unknown tile throws in
 * TileContainer, which reads `FD.tiles[name].variants` (issue #46).
 */
interface StrippedNames {
    entities: string[]
    tiles: string[]
}

function stripUnknownPrototypes(data: StringData): StrippedNames {
    const strippedEntities = new Set<string>()
    const strippedTiles = new Set<string>()
    const stripBlueprint = (bp: IBlueprint): void => {
        if (bp.entities) {
            const before = bp.entities.length
            bp.entities = bp.entities.filter(e => {
                if (!FD.entities[e.name]) {
                    strippedEntities.add(e.name)
                    return false
                }
                return true
            })
            if (bp.entities.length < before) {
                console.warn(`Stripped ${before - bp.entities.length} unknown entities`)
            }
        }
        if (bp.tiles) {
            const before = bp.tiles.length
            bp.tiles = bp.tiles.filter(t => {
                if (!FD.tiles[t.name]) {
                    strippedTiles.add(t.name)
                    return false
                }
                return true
            })
            if (bp.tiles.length < before) {
                console.warn(`Stripped ${before - bp.tiles.length} unknown tiles`)
            }
        }
    }

    const stripBook = (entries: IBlueprintBookEntry[] = []): void => {
        for (const entry of entries) {
            if (entry.blueprint) stripBlueprint(entry.blueprint)
            if (entry.blueprint_book) stripBook(entry.blueprint_book.blueprints)
        }
    }

    if (data.blueprint) {
        stripBlueprint(data.blueprint)
    } else if (data.blueprint_book) {
        stripBook(data.blueprint_book.blueprints)
    }
    return { entities: [...strippedEntities], tiles: [...strippedTiles] }
}

function decode(str: string): Promise<Blueprint | Book> {
    return new Promise((resolve, reject) => {
        try {
            const decodedStr = base64ToBytes(str.slice(1))
            const parsedData = JSON.parse(pako.inflate(decodedStr, { toText: true }))
            // Before validation, since the schema checks names against FD.
            migrateNames(parsedData)
            resolve(parsedData)
        } catch (e) {
            reject(new CorruptedBlueprintStringError(e))
        }
    }).then(data => {
        if (G.debug) console.log(data)
        loadWarnings = []
        if (!validate(data)) {
            const errors = validate.errors
            // Log validation warnings but try to load the blueprint anyway
            console.warn('Blueprint validation warnings (loading anyway):', JSON.stringify(errors))
            loadWarnings.push('Blueprint had validation warnings (loaded anyway)')
        }
        // Always strip unknown names - they crash during rendering if they reach
        // Blueprint.ts (e.g., mod entities like ee-infinity-loader, or a tile from
        // a Factorio version newer than the exporter ran against)
        const stripped = stripUnknownPrototypes(data as StringData)
        if (stripped.entities.length > 0) {
            loadWarnings.push(
                `Skipped ${stripped.entities.length} unknown entit${stripped.entities.length === 1 ? 'y' : 'ies'}: ${stripped.entities.join(', ')}`
            )
        }
        if (stripped.tiles.length > 0) {
            loadWarnings.push(
                `Skipped ${stripped.tiles.length} unknown tile${stripped.tiles.length === 1 ? '' : 's'}: ${stripped.tiles.join(', ')}`
            )
        }

        const bpData = data as StringData
        if (bpData.blueprint_book === undefined) {
            return new Blueprint(bpData.blueprint)
        } else {
            const hasBlueprint = (entries: IBlueprintBookEntry[] = []): boolean => {
                for (const entry of entries) {
                    if (entry.blueprint) return true
                    if (entry.blueprint_book && hasBlueprint(entry.blueprint_book.blueprints))
                        return true
                }
                return false
            }
            if (hasBlueprint(bpData.blueprint_book.blueprints)) {
                return new Book(bpData.blueprint_book)
            } else {
                throw new BookWithNoBlueprintsError()
            }
        }
    })
}

function encode(bpOrBook: Blueprint | Book): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const keyName = bpOrBook instanceof Blueprint ? 'blueprint' : 'blueprint_book'
            const data = { [keyName]: bpOrBook.serialize() }
            const string = JSON.stringify(data)
            resolve(`0${bytesToBase64(pako.deflate(string))}`)
        } catch (e) {
            reject(e)
        }
    })
}

function getBlueprintOrBookFromSource(source: string): Promise<Blueprint | Book> {
    if (source === undefined) return Promise.resolve(new Blueprint())

    // trim whitespace
    const DATA = source.replace(/\s/g, '')

    /*
        After the strip, not before it: a whitespace-only source has to reach
        this and not `new URL('https://')`, which is what an empty one used to
        hit - `DATA[0]` is undefined, so the `'0'` test fails and the URL branch
        builds a scheme with no host. That threw `TypeError: Invalid URL`, an
        error naming neither the source nor the real problem (issue #298).

        `undefined` above is a different case and stays silent: it means no
        `?source=` param at all, which is how the editor opens for most
        visitors. `?source=` with an empty value is someone who meant to pass
        something, and is worth saying so.
    */
    if (DATA === '') return Promise.reject(new EmptyBlueprintStringError())

    let bpString
    if (DATA[0] === '0') {
        bpString = Promise.resolve(DATA)
    } else {
        bpString = new Promise<URL>((resolve, reject) => {
            const url = `https://${DATA.replace(/https?:\/\//g, '')}`
            try {
                resolve(new URL(url))
            } catch (e) {
                reject(e)
            }
        }).then((url: URL) => {
            console.log(`Loading data from: ${url}`)
            const pathParts = url.pathname.slice(1).split('/')
            // One strip, read by both the switch discriminant and the
            // factorioprints host check below - the two have to agree on what
            // "the host" is, and a second copy is a bound written down twice.
            const host = url.hostname.replace(/^www\./, '')

            const fetchData = (url: string): Promise<Response> =>
                fetch(`/corsproxy?url=${encodeURIComponent(url)}`).then(response => {
                    if (response.ok) return response
                    throw new Error('Network response was not ok.')
                })

            /*
                Dropbox is deliberately unsupported - see #98, closed wontfix, which
                records the probes. Two things a future handler would have to reckon
                with, neither obvious from the cases below: a share link is now
                `/scl/fi/<id>/<name>?rlkey=...`, and the `rlkey` is required, so the
                handler would have to preserve the incoming query string - every case
                here rebuilds from `pathParts` and throws the query away. And a link
                missing it answers the HTML login page at status 200, so the `ok`
                check above passes and the markup reaches decode() as a corrupt
                blueprint string. That second one is a property of fetchData rather
                than of Dropbox, and so applies to every source below.
            */
            switch (host.split('.')[0]) {
                case 'pastebin':
                    /*
                        A raw link - `pastebin.com/raw/<id>`, what the paste's
                        own "raw" button gives you - is already the URL this arm
                        would rewrite to, so pass it through. Rewriting it blind
                        makes `pathParts[0]` the literal `raw` and fetches
                        `pastebin.com/raw/raw`, a 404 (issue #297). Same fork as
                        the `factorio` and `factorioprints` arms below.
                    */
                    if (pathParts[0] === 'raw') {
                        return fetchData(url.href).then(r => r.text())
                    }

                    return fetchData(`https://pastebin.com/raw/${pathParts[0]}`).then(r => r.text())
                case 'hastebin':
                    return fetchData(`https://hastebin.com/raw/${pathParts[0]}`).then(r => r.text())
                case 'gist':
                    return fetchData(`https://api.github.com/gists/${pathParts[1]}`)
                        .then(r => r.json())
                        .then(data => data.files[Object.keys(data.files)[0]].content)
                case 'gitlab':
                    return fetchData(`https://gitlab.com/${pathParts.join('/')}/raw`).then(r =>
                        r.text()
                    )
                case 'factorioprints':
                    /*
                        A pass-through like the factorio.school arm below, but a
                        narrower one: that arm keys on the path alone, this arm
                        has to check the host as well. `factorioprints.xyz` is
                        the API, and a link to one blueprint *inside a book* is
                        an `/api/blueprintData/<sha>/position/<i>` URL, which the
                        pass-through hands to the proxy untouched. The firebase
                        rewrite below cannot serve that link: `pathParts[1]` of
                        an API path is the literal string `blueprintData`, not a
                        blueprint key, so the rewrite fetches
                        `blueprints/blueprintData.json`, which answers 200 with a
                        body of `null`, and `data.blueprintString` throws.

                        The host check is what keeps `factorioprints.com` out.
                        This arm is reached by first label alone, so
                        `factorioprints` under *any* TLD lands here, and `.com`
                        is the site rather than the API: `factorioprints.com/api/
                        ...` answers the SPA's index.html at status 200, which
                        would reach `decode` as a page of HTML. Routing it to the
                        firebase rewrite instead is not a fix - it hits the same
                        missing-record throw as above - so both routes fail for a
                        `.com` API link, and the host check only decides which
                        failure it is.
                    */
                    if (host === 'factorioprints.xyz' && pathParts[0] === 'api') {
                        return fetchData(url.href).then(r => r.text())
                    }

                    return fetchData(
                        `https://facorio-blueprints.firebaseio.com/blueprints/${pathParts[1]}.json`
                    )
                        .then(r => r.json())
                        .then(data => data.blueprintString)
                case 'factorio': // factorio.school
                    /*
                        Keyed on the path alone, unlike the factorioprints arm
                        above - not because that is safer, but because no other
                        `factorio.<tld>` is known to reach this case. Any
                        `factorio.<tld>` lands here, an `/api/` path is passed
                        through and every other path is rewritten to
                        `www.factorio.school/api/blueprint/<pathParts[1]>`. If a
                        second `factorio.<tld>` ever serves blueprints, this arm
                        needs the same host check #291 added above.
                    */
                    if (pathParts[0] === 'api') {
                        return fetchData(url.href).then(r => r.text())
                    }

                    return fetchData(`https://www.factorio.school/api/blueprint/${pathParts[1]}`)
                        .then(r => r.json())
                        .then(data => data.blueprintString.blueprintString)
                // Factoriobin support added by wormeyman, originally by nyakokitsu (upstream PR #272)
                case 'factoriobin':
                    return fetchData(
                        `https://factoriobin.com/${pathParts.join('/')}/blueprint.txt`
                    ).then(r => r.text())
                case 'docs':
                    return fetchData(
                        `https://docs.google.com/document/d/${pathParts[2]}/export?format=txt`
                    ).then(r => r.text())
                default:
                    return fetchData(url.href).then(r => r.text())
            }
        })
    }

    return bpString.then(decode)
}

export {
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
    EmptyBlueprintStringError,
    encode,
    getBlueprintOrBookFromSource,
    getAndClearLoadWarnings,
}
