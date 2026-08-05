import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    What `decode` accepts around the edges of a blueprint string's base64.

    This exists because dropping the `buffer` polyfill made it possible to lose
    something silently. `bpString.ts` used to decode with
    `Buffer.from(str, 'base64')`, which ignores every character outside the
    alphabet and accepts the URL-safe one. Nothing in the suite would have
    noticed the difference: every string the corpus and the other specs feed the
    editor is already clean, so even a bare `atob` passes all 367 of them.

    **The two halves of this file guard different things, and mutation-checking
    is what separated them** - the first draft of this docstring had all four
    lumped together as "atob is stricter", which is wrong.

    - Whitespace and padding: `atob` implements the WHATWG forgiving-base64
      algorithm and handles both **itself**. Removing the normalisation from
      `base64ToBytes` leaves those tests passing. They are here because the
      property is user-facing and untested anywhere else - a string copied out
      of a forum post or a wrapped text file arrives with newlines - and because
      the obvious future refactor, `Uint8Array.fromBase64`, is strict and would
      break it silently.
    - The URL-safe alphabet and stray characters: `atob` throws a DOMException
      on both, so these are the tests that actually pin the normalisation.
      Measured, removing it fails exactly these two.

    Either way the user-visible failure is the same and is why this matters at
    all: the throw is caught in `decode` and becomes the generic
    corrupt-blueprint toast, a message naming nothing about the string, for a
    blueprint the user can see is the right one.

    Not a fixed point. Each test states a property, and a diff here means the
    editor accepts a different set of strings than it did.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const V_2_0 = version(2, 0, 55)

const blueprint = (): string =>
    encode({
        item: 'blueprint',
        version: V_2_0,
        entities: [
            { entity_number: 1, name: 'steel-chest', position: { x: 0.5, y: 0.5 } },
            {
                entity_number: 2,
                name: 'transport-belt',
                position: { x: 1.5, y: 0.5 },
                direction: 4,
            },
        ],
    })

/** The entity names the string decodes to, or the error class that stopped it. */
async function load(page: import('@playwright/test').Page, source: string): Promise<string[]> {
    return page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        const bp = await api.getBlueprintOrBookFromSource(str)
        return [...bp.entities.values()].map((e: any): string => e.name).sort()
    }, source)
}

const EXPECTED = ['steel-chest', 'transport-belt']

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
})

test('the control: a clean string decodes', async ({ page }) => {
    /*
        Every other test here mutates this string, so if this one breaks they all
        report a tolerance failure for a reason that has nothing to do with
        tolerance.
    */
    expect(await load(page, blueprint())).toEqual(EXPECTED)
})

test('a string wrapped across lines still decodes', async ({ page }) => {
    const s = blueprint()
    /* 76 columns, which is what an email client and `base64` both wrap at. */
    const wrapped = s[0] + (s.slice(1).match(/.{1,76}/g) ?? []).join('\n')
    expect(wrapped).toContain('\n')
    expect(await load(page, wrapped)).toEqual(EXPECTED)
})

test('surrounding whitespace does not stop it', async ({ page }) => {
    /*
        The leading `0` has to survive: `decode` slices it off by position, so a
        space in front of it would shift the whole string by one and this would
        fail for a different reason than the one under test.
    */
    expect(await load(page, `${blueprint()}\n  \t\n`)).toEqual(EXPECTED)
})

test('the URL-safe alphabet decodes to the same blueprint', async ({ page }) => {
    const s = blueprint()
    const urlSafe = s[0] + s.slice(1).replace(/\+/g, '-').replace(/\//g, '_')
    /*
        A short blueprint need not contain either character, in which case this
        test would pass without testing anything - so say so rather than assert
        on an unmodified string.
    */
    test.skip(urlSafe === s, 'this blueprint happens to contain no + or / to swap')
    expect(await load(page, urlSafe)).toEqual(EXPECTED)
})

test('a stray character from a mangled copy does not stop it', async ({ page }) => {
    /*
        The other half of what the normalisation buys, and the case that is
        easiest to hit by accident: a chat client or a PDF substitutes a
        character, or one gets picked up at a selection boundary. `atob` throws
        a DOMException on a single `.`, where `Buffer.from` ignored it.
    */
    const s = blueprint()
    const mangled = `${s.slice(0, 30)}.${s.slice(30)}`
    expect(await load(page, mangled)).toEqual(EXPECTED)
})

test('a genuinely corrupt string is still rejected', async ({ page }) => {
    /*
        The other direction, and the reason the normalisation strips rather than
        accepts anything: a tolerance wide enough to swallow real corruption
        would turn a broken paste into an empty editor instead of an error.
    */
    const truncated = blueprint().slice(0, 20)
    const failed = await page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        try {
            await api.getBlueprintOrBookFromSource(str)
            return false
        } catch {
            return true
        }
    }, truncated)
    expect(failed).toBe(true)
})
