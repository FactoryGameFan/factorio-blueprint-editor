import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    The `?source=` handlers in bpString.ts - issue #124.

    `getBlueprintOrBookFromSource` switches on the hostname and rewrites the URL
    per host, then parses the response one of two ways. Nine arms, and until this
    spec nothing under tests/ mentioned `/corsproxy` or any of those hostnames:
    every arm could have been deleted, or given the wrong URL, with the suite
    green.

    The corpus cannot reach any of it by construction rather than by omission.
    Every file in test-blueprints/ is a raw blueprint string starting with `0`,
    which takes the `DATA[0] === '0'` branch and never builds a URL at all.

    Nor can a unit test. The function ends in `decode`, which validates against
    FD, and since #109 an unloaded FD throws by name - so reaching the switch
    means a browser with the editor initialised. What makes that cheap is that
    every arm fetches through `/corsproxy?url=<encoded>`, which `page.route` can
    intercept: the URL each host maps to is readable off the intercepted request
    without the network, and `route.fulfill` supplies the body, which is the only
    way to exercise the three arms that pluck a field out of JSON.

    Two things each case asserts, and both are needed. The rewritten URL is what
    a typo in a template literal would break. Loading the result is what a change
    to the *parse* step would break - gist reads `data.files[<first key>].content`
    and factorio.school reads `data.blueprintString.blueprintString`, and a
    rename at either end would leave the URL perfectly correct and the blueprint
    empty.
*/

type Page = import('@playwright/test').Page

/** Two entities, so a successful load is distinguishable from an empty one. */
const BP = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'steel-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'steel-chest', position: { x: 1.5, y: 0.5 } },
    ],
})

interface Fetched {
    /** The URL the handler asked the proxy for, decoded from `?url=`. */
    target: string
    /** How many entities reached the editor, so the parse step is covered too. */
    entities: number
}

/**
 * Drives one source through the real switch with the network intercepted.
 *
 * The route is registered before the call and removed after, so each case sees
 * exactly one request and cases cannot borrow each other's captures.
 */
async function fetchThrough(
    page: Page,
    source: string,
    body: string,
    contentType = 'text/plain'
): Promise<Fetched> {
    const targets: string[] = []

    await page.route('**/corsproxy*', async route => {
        const url = new URL(route.request().url())
        targets.push(url.searchParams.get('url') ?? '<no url param>')
        await route.fulfill({ status: 200, contentType, body })
    })

    const entities = await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        return t.entityContainerCount()
    }, source)

    await page.unroute('**/corsproxy*')

    if (targets.length !== 1) {
        throw new Error(`expected exactly one proxied request, saw ${targets.length}`)
    }
    return { target: targets[0], entities }
}

const gistBody = JSON.stringify({ files: { 'blueprint.txt': { content: BP } } })
const printsBody = JSON.stringify({ blueprintString: BP })
const schoolBody = JSON.stringify({ blueprintString: { blueprintString: BP } })

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

test('pastebin asks for the raw paste', async ({ page }) => {
    const r = await fetchThrough(page, 'https://pastebin.com/AbCd1234', BP)
    expect(r.target).toBe('https://pastebin.com/raw/AbCd1234')
    expect(r.entities).toBe(2)
})

test('hastebin asks for the raw paste', async ({ page }) => {
    const r = await fetchThrough(page, 'https://hastebin.com/xyz789', BP)
    expect(r.target).toBe('https://hastebin.com/raw/xyz789')
    expect(r.entities).toBe(2)
})

/*
    The three JSON arms. Their URLs are the least of it - each one reaches into a
    differently shaped response, and a rename upstream would empty the blueprint
    while leaving the request untouched, which is precisely the failure no
    URL-only assertion can see.
*/
test('gist asks the API and takes the first file, whatever it is called', async ({ page }) => {
    const r = await fetchThrough(page, 'https://gist.github.com/someone/dead1234', gistBody)
    expect(r.target).toBe('https://api.github.com/gists/dead1234')
    expect(r.entities).toBe(2)
})

test('factorioprints reads blueprintString off the firebase record', async ({ page }) => {
    const r = await fetchThrough(page, 'https://factorioprints.com/view/abc987', printsBody)
    expect(r.target).toBe('https://facorio-blueprints.firebaseio.com/blueprints/abc987.json')
    expect(r.entities).toBe(2)
})

test('factorio.school reads the doubly nested blueprintString', async ({ page }) => {
    const r = await fetchThrough(page, 'https://www.factorio.school/view/xyz321', schoolBody)
    expect(r.target).toBe('https://www.factorio.school/api/blueprint/xyz321')
    expect(r.entities).toBe(2)
})

/*
    The fork inside the factorio.school arm: a URL already pointing at the API is
    passed through untouched and read as text, not JSON. One test covering only
    the /view/ shape would leave this half unexercised, and it is the shape
    CLAUDE.md tells people to paste for manual testing.
*/
test('a factorio.school API url is passed through unchanged and read as text', async ({ page }) => {
    const source = 'https://www.factorio.school/api/blueprintData/xyz321/'
    const r = await fetchThrough(page, source, BP)
    expect(r.target).toBe(source)
    expect(r.entities).toBe(2)
})

test('gitlab appends /raw to the whole path', async ({ page }) => {
    const r = await fetchThrough(page, 'https://gitlab.com/someone/proj/-/snippets/42', BP)
    expect(r.target).toBe('https://gitlab.com/someone/proj/-/snippets/42/raw')
    expect(r.entities).toBe(2)
})

test('factoriobin appends /blueprint.txt to the whole path', async ({ page }) => {
    const r = await fetchThrough(page, 'https://factoriobin.com/post/abc123', BP)
    expect(r.target).toBe('https://factoriobin.com/post/abc123/blueprint.txt')
    expect(r.entities).toBe(2)
})

test('a google doc is asked for its plain text export', async ({ page }) => {
    const r = await fetchThrough(page, 'https://docs.google.com/document/d/DOC_ID/edit', BP)
    expect(r.target).toBe('https://docs.google.com/document/d/DOC_ID/export?format=txt')
    expect(r.entities).toBe(2)
})

/*
    The default arm. Note what it means for the switch: the key is
    `hostname.replace(/^www\./, '').split('.')[0]`, so an unrecognised host is
    fetched exactly as given rather than rejected - which is what makes any
    static file a usable source.
*/
test('an unrecognised host is fetched exactly as given', async ({ page }) => {
    const source = 'https://example.com/some/blueprint.txt'
    const r = await fetchThrough(page, source, BP)
    expect(r.target).toBe(source)
    expect(r.entities).toBe(2)
})

/*
    Not a happy path, and the reason this file asserts more than URLs.

    `fetchData` rejects on `!response.ok` and nothing else, so a host answering
    200 with an HTML error or login page - a deleted paste, a share link missing
    its key - sails through the check and hands markup to decode(). Measured
    while probing #98: Dropbox does exactly this for a link with no `rlkey`.

    The user-visible result is a corrupt-blueprint-string error that says nothing
    about the URL being wrong. Pinning it is not an endorsement: it records what
    the editor does today so that improving it - sniffing the content type, or
    the leading `0` - shows up as a change here rather than passing unnoticed.
*/
test('a 200 that is really an HTML error page fails as a corrupt blueprint', async ({ page }) => {
    await page.route('**/corsproxy*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!DOCTYPE html><html><body>Sign in to continue</body></html>',
        })
    })

    const outcome = await page.evaluate(async (src: string) => {
        try {
            await window.__fbe_test.getBlueprintOrBookFromSource(src)
            return 'resolved'
        } catch (e) {
            return `rejected: ${e instanceof Error ? e.message : String(e)}`
        }
    }, 'https://pastebin.com/AbCd1234')

    await page.unroute('**/corsproxy*')

    // The rejection is the point; the wording is the editor's own and is only
    // asserted loosely so a reworded message does not fail this.
    expect(outcome).toContain('rejected')
    expect(outcome.toLowerCase()).not.toContain('network response was not ok')
})
