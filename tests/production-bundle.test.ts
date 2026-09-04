import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import * as path from 'path'
import { build } from 'vite-plus'

/*
    #292 put `window.__fbe_test` and the ~400-line test API behind
    `import.meta.env.DEV`, so a `vp build` folds that to `false`, drops the
    branch, and tree-shakes `testApi` and everything only it references. Nothing
    checked that it worked, and by construction nothing could: every Playwright
    spec waits on `window.__fbe_test`, which after #292 exists only under
    `vp dev`, so the e2e suite runs against the dev server and never sees a
    production build. `deploy` builds the site but only after `checks` and `e2e`
    have passed, with no smoke test after. A production-only regression - the
    guard reverted, or a `define`/DCE change that strips more or less than
    intended - had zero automated coverage in either direction (#322).

    This is the cheap half of the two options in #322: a build plus a string
    scan, no browser. It runs `build()` with the website's real `vite.config.js`
    - not a stripped-down config - so the `define` substitution and the
    tree-shake it enables are exactly the ones production gets, then greps the
    emitted chunks. Public source maps deliberately retain the original source
    for debugging (#328); the exclusion applies to executable JavaScript only.

    Why grep for these particular names. #292's own review found that three of
    the symbols first cited as evidence - `DIGESTED_FIELDS`, `spriteDataDigest`,
    `ThrowingDialog` - are module-local bindings that the minifier renames in
    every build, so a grep for them reads 0 whether or not the shake fired. The
    markers below are a `window` property and object keys; a minifier renames
    neither, so a hit in executable JavaScript means the code shipped. The positive control in the first
    test guards against the inverse false pass - a grep over an empty or partial
    `dist` - by asserting a string that production code always emits is there.

    A vitest test under tests/ rather than a Playwright spec, same as
    tests/wire-switch-completeness.test.ts and for the reasons written there:
    no browser is needed, so it belongs in the cheap `checks` gate rather than
    behind two dev servers. Path resolved from the working
    directory, not this file, because both runners start at the repo root and
    `import.meta.dirname` does not compile under the shared `module: ES6`.
*/

const websiteDir = path.resolve(process.cwd(), 'packages/website')

/*
    Strings that packages/website/src/index.ts uses only inside the test API or
    the `import.meta.env.DEV` assignment that exposes it. `__fbe_test` is the
    `window` property every spec waits on; the rest are keys on the `testApi`
    object literal and appear nowhere else in bundled code (the editor package
    mentions some in comments only). None is a local binding, so none is
    renamed - a match in a chunk means the guard did not hold.
*/
const TEST_API_MARKERS = [
    '__fbe_test',
    'spriteDataTally',
    'paintPreviewTally',
    'recipeShapeTally',
    'overlayInfoTally',
    'entityWireAttachment',
    'setWagonInventory',
]

let bundledJs = ''
let mappedSource = ''
let sourceMapCount = 0
const nodeEnvBefore = process.env.NODE_ENV

beforeAll(async () => {
    /*
        `vp build` sets NODE_ENV=production; `build()` called in-process does
        not, and vitest has already set it to `test`. Vite derives
        `import.meta.env.DEV` from NODE_ENV before it falls back to the mode, so
        without this the guard under test evaluates to `true` and the scan
        below always fails. Restored in afterAll so a later file in this project
        still sees the value vitest set.
    */
    process.env.NODE_ENV = 'production'
    // Inspect this build's output in memory. Writing to the shared dist would
    // overwrite a local preview and could scan stale files from an earlier build.
    const result = await build({ root: websiteDir, logLevel: 'silent', build: { write: false } })
    for (const bundle of Array.isArray(result) ? result : [result]) {
        if (!('output' in bundle)) throw new Error('expected a completed production build')
        for (const file of bundle.output) {
            if (file.type === 'chunk') {
                bundledJs += `${file.code}\n`
                mappedSource += (file.map?.sourcesContent ?? []).join('\n')
            } else if (file.fileName.endsWith('.js.map')) {
                sourceMapCount++
            }
        }
    }
}, 180_000)

afterAll(() => {
    if (nodeEnvBefore === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnvBefore
})

describe('the production website bundle', () => {
    it('was actually built, so the scan below is looking at real output', () => {
        // The console banner index.ts logs at module top level - always in the
        // bundle, and a plain string a minifier keeps verbatim. Without this an
        // empty or half-written dist would pass every assertion by having
        // nothing in it to match.
        expect(bundledJs).toContain('Looking for the source?')
        expect(bundledJs.length).toBeGreaterThan(100_000)
    })

    it('does not carry the Playwright test API in executable JavaScript', () => {
        const leaked = TEST_API_MARKERS.filter(marker => bundledJs.includes(marker))
        expect(
            leaked,
            `test-API symbols found in packages/website/dist/assets/*.js: ${leaked.join(', ')}. ` +
                'The import.meta.env.DEV guard in packages/website/src/index.ts is not holding.'
        ).toEqual([])
    })

    it('retains original source in public source maps for debugging', () => {
        expect(sourceMapCount).toBeGreaterThan(0)
        expect(bundledJs).toContain('sourceMappingURL=')
        for (const marker of TEST_API_MARKERS) expect(mappedSource).toContain(marker)
    })
})
