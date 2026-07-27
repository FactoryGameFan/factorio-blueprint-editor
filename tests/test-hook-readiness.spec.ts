import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    That `window.__fbe_test` means what every other spec assumes it means
    (issue #109).

    The hook used to be assigned synchronously as `packages/website/src/index.ts`
    ran, while `editor.init()` - which fetches data.json and calls `loadData` -
    was still in flight. So the property every spec waits on appeared before
    `FD` had anything in it, and a spec that got there first ran against
    `FD.entities === undefined`.

    That is not hypothetical and it is not rare. Full runs of the suite were
    failing two to five specs, a different set each time, each passing when run
    alone: book-serialize, chest-editor, chest-filters, tiles, unknown-operator,
    paste-wires. All with the same error, from wherever that spec first touched
    the data:

        TypeError: Cannot read properties of undefined (reading 'wooden-chest')
            at stripBlueprint (bpString.ts:88)

    Warm, the window is 0ms wide and nothing fails. It opens when data.json is
    slow - a cold Vite start, or a loaded machine part way through a long run -
    which is exactly when a suite is least able to tell a race from a
    regression. This spec holds data.json back deliberately so the condition is
    always present rather than waited for.

    Note what this does NOT cover: the other route to an empty `FD` in #109 is
    editing `factorioData.ts` with the dev server live, where HMR re-evaluates
    the module without re-running `loadData`. That needs a file edit mid-run and
    is a separate mechanism with the same symptom.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

const CANVAS = '#editor'

/** How long to hold data.json back. Long enough to be unmissable if the race is open. */
const DELAY_MS = 1500

const ONE_CHEST = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

test('the test hook does not appear until the data behind it has loaded', async ({ page }) => {
    /*
        The delay is what a cold start does on its own. Everything else about
        startup runs at full speed, so if the hook still arrives early it is the
        ordering that is wrong and not the timing.
    */
    await page.route('**/data/data.json', async route => {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS))
        await route.continue()
    })

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    /*
        No retry, no polling, no waiting for anything else - the point is that
        the very first call after the hook appears is safe. Before the fix this
        threw `Cannot read properties of undefined (reading 'wooden-chest')`
        from stripUnknownPrototypes, which is the failure the whole suite was
        seeing at random.
    */
    const chestIsOnScreen = await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        // A position comes back only if the entity survived decode and was drawn.
        return t.entityScreenPosition(1) !== undefined
    }, ONE_CHEST)

    expect(chestIsOnScreen).toBe(true)
    await page.locator(CANVAS).waitFor()
})

test('the editor is fully started by the time the hook exists', async ({ page }) => {
    /*
        The hook is assigned at the end of the startup chain, after the initial
        blueprint has loaded - so a spec is never racing the editor's own load
        with one of its own. `editorMode` reads live editor state, which does
        not exist until `Editor.init` has assigned it; NONE is the mode with
        nothing hovered, which is where startup leaves it.
    */
    await page.route('**/data/data.json', async route => {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS))
        await route.continue()
    })

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('NONE')
})
