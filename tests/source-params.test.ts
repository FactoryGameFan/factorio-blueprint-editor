import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import {
    buildShareLink,
    DISCORD_MESSAGE_LIMIT,
    readPageSourceParams,
    readSourceParams,
    shareLinkCopiedText,
} from '../packages/website/src/sourceParams'

/*
    The editor's `?source=` and `?index=` reading, as a pure function so it runs
    here rather than only behind a page load. The first block is the defect it
    was split out to fix; the second pins what the old loop already did right,
    so the fix cannot trade one for the other.
*/
describe('readSourceParams matches keys exactly', () => {
    it.each([
        ['a tracking parameter after the source', '?source=0abc&utm_source=reddit', '0abc'],
        ['a key that only contains the word', '?resource=0abc', undefined],
        ['a value that only contains the word', '?ref=opensource', undefined],
    ])('%s', (_label, search, source) => {
        expect(readSourceParams(search).source).toBe(source)
    })

    it('keeps everything after the first = in a value', () => {
        // Base64 padding on a blueprint string, and a query on a source URL.
        expect(readSourceParams('?source=0eNqab/c==').source).toBe('0eNqab/c==')
        expect(readSourceParams('?source=pastebin.com/raw/abc?x=1').source).toBe(
            'pastebin.com/raw/abc?x=1'
        )
    })

    it('does not read an index out of a source that mentions the word', () => {
        expect(readSourceParams('?source=gitlab.com/a/b/index.txt').index).toBe(0)
    })

    it('treats a bare source key as present but empty', () => {
        // The old loop decoded `undefined`, giving the string "undefined".
        expect(readSourceParams('?source').source).toBe('')
    })
})

describe('readSourceParams keeps what already worked', () => {
    it('takes the source when a tracking parameter comes first', () => {
        // The old loop let the last match win, so this order already worked.
        expect(readSourceParams('?utm_source=reddit&source=0abc').source).toBe('0abc')
    })

    it('leaves + alone, since a blueprint string is base64', () => {
        expect(readSourceParams('?source=0eNq+ab+c').source).toBe('0eNq+ab+c')
    })

    it('percent-decodes the value', () => {
        expect(readSourceParams('?source=https%3A%2F%2Fpastebin.com%2Fraw%2Fabc').source).toBe(
            'https://pastebin.com/raw/abc'
        )
    })

    it('falls back to the raw value when it is not valid percent-encoding', () => {
        expect(readSourceParams('?source=%').source).toBe('%')
    })

    it('says undefined when there is no source key, and empty when it has no value', () => {
        expect(readSourceParams('').source).toBeUndefined()
        expect(readSourceParams('?index=2').source).toBeUndefined()
        expect(readSourceParams('?source=').source).toBe('')
    })

    it('reads the index, and defaults it to 0', () => {
        expect(readSourceParams('?source=0abc&index=3')).toEqual({ source: '0abc', index: 3 })
        expect(readSourceParams('?index=3&source=0abc')).toEqual({ source: '0abc', index: 3 })
        expect(readSourceParams('?source=0abc').index).toBe(0)
    })
})

/*
    The fragment form, `#source=`, that ExportDialog's Copy link button builds
    (#570). The query has to win, so every `?source=` link already out there -
    the README's, factorio.school's and factorioprints' buttons - loads what it
    loaded before.
*/
describe('readPageSourceParams reads the fragment', () => {
    it('reads a source from the fragment when the query has none', () => {
        expect(readPageSourceParams('', '#source=0eNq+ab/c==&index=2')).toEqual({
            source: '0eNq+ab/c==',
            index: 2,
        })
    })

    it('lets the query win, index and all', () => {
        expect(readPageSourceParams('?source=0query', '#source=0fragment&index=4')).toEqual({
            source: '0query',
            index: 0,
        })
    })

    it('keeps the query index when the fragment has no source either', () => {
        expect(readPageSourceParams('?index=3', '#top')).toEqual({ source: undefined, index: 3 })
    })

    it('says undefined when neither has a source', () => {
        expect(readPageSourceParams('', '').source).toBeUndefined()
        expect(readPageSourceParams('?utm_source=x', '#resource=0abc').source).toBeUndefined()
    })
})

describe('buildShareLink', () => {
    it('round-trips a real corpus string through the reader unchanged', () => {
        const bp = fs
            .readFileSync(
                path.resolve(
                    process.cwd(),
                    'test-blueprints/JEPAKAZOL/aquilo-cryogenic-science.txt'
                ),
                'utf8'
            )
            .trim()
        const link = new URL(buildShareLink('https://fbe.factorygamefan.com', bp))
        expect(link.search).toBe('')
        expect(readPageSourceParams(link.search, link.hash).source).toBe(bp)
    })

    it('names the length only once a link is too long for a Discord message', () => {
        const short = buildShareLink('https://x', '0'.repeat(DISCORD_MESSAGE_LIMIT - 20))
        expect(short.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
        expect(shareLinkCopiedText(short)).toBe('Link copied to clipboard')
        expect(shareLinkCopiedText('x'.repeat(13049))).toBe(
            'Link copied to clipboard. It is 13,049 characters long; ' +
                'a Discord message allows 2,000.'
        )
    })
})
