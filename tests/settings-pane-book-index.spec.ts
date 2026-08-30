import { test, expect } from '@playwright/test'
import {
    encodeBlueprintBook as encodeBook,
    packVersion as version,
} from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'

/*
    The settings pane's BP Book Index box, and the first coverage its arrow
    keys have ever had - `git grep ArrowUp tests/` was empty before this file.

    `packages/website/src/settingsPane.ts` hangs its own `keydown` listener on
    that dat.gui `<input>` so ArrowUp/ArrowDown step the index. Stepping is
    the whole reason the listener exists, and stepping means the *second*
    press has to work as well as the first - which is what makes this
    reachable at all, and what nothing else here can see.

    Written for a regression the #242 focus hand-back introduced (see
    `Dialog.close()`). Each step calls `changeBookIndex` ->
    `editor.loadBlueprint` -> `Dialog.closeAll()`, so with any dialog open the
    first arrow closes it, and an unconditional `G.app.canvas.focus()` on that
    close pulled the focus off the live <input>. The second arrow then reached
    the editor's keybinds instead of the box. Measured 0 -> 1 -> 1 against the
    0 -> 1 -> 2 the control gives.

    Two things this spec is shaped by.

    The pair is a real pair, not a test and a restatement. Only the second
    test fails against the unconditional guard; the first passes there, and
    both pass with the focus hand-back deleted outright. So the control says
    the arrows work at all and the treatment says a dialog does not break
    them, and neither one alone distinguishes the three states.

    It does not call `suppressOverlays`. That helper sets `pointer-events:
    none` on `.dg.main`, which is this pane - the very thing the test has to
    click. The pane is bottom *left* and the toasts are bottom *right*, so
    there is nothing here for the suppression to protect against anyway.

    The book entries carry a different entity count each, and that is the
    synchronisation. `setValue` writes the box synchronously and only then
    starts an async load, so waiting on the box's own value proves nothing
    about whether the load - and the `closeAll` inside it - has run yet.
    Pressing the second arrow into that gap passes whatever the guard does.
    `entityContainerCount()` moves only when a load finishes, and it names
    *which* entry finished.
*/

const VERSION = version(2, 0, 55)

const chests = (n: number): Record<string, unknown>[] =>
    Array.from({ length: n }, (_, i) => ({
        entity_number: i + 1,
        name: 'wooden-chest',
        position: { x: i + 0.5, y: 0.5 },
    }))

/** Entry i holds i+1 chests, so entityContainerCount() names the loaded entry. */
const BOOK = encodeBook({
    item: 'blueprint_book',
    version: VERSION,
    active_index: 0,
    blueprints: [0, 1, 2].map(index => ({
        index,
        blueprint: { item: 'blueprint', version: VERSION, entities: chests(index + 1) },
    })),
})

type Page = import('@playwright/test').Page

const bpIndexInput = (page: Page) =>
    page.locator('.dg .property-name:has-text("BP Book Index")').locator('..').locator('input')

const activeTag = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => document.activeElement?.tagName)

/** Waits for the load the arrow started to finish, by the entry it landed on. */
const waitForEntry = (page: Page, index: number): Promise<unknown> =>
    page.waitForFunction(n => window.__fbe_test.entityContainerCount() === n, index + 1)

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

test('CONTROL: the arrow keys step the book index twice over, with no dialog involved', async ({
    page,
}) => {
    await loadBlueprint(page, BOOK)
    const input = bpIndexInput(page)
    await input.click()
    expect(await activeTag(page)).toBe('INPUT')

    await page.keyboard.press('ArrowUp')
    await waitForEntry(page, 1)
    expect(await activeTag(page)).toBe('INPUT')

    await page.keyboard.press('ArrowUp')
    await waitForEntry(page, 2)

    await expect(input).toHaveValue('2')
})

test('a dialog closing on the first arrow does not steal the focus off the index box', async ({
    page,
}) => {
    await loadBlueprint(page, BOOK)
    await page.evaluate(() => window.__fbe_test.openExportDialog())
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)

    const input = bpIndexInput(page)
    await input.click()
    expect(await activeTag(page)).toBe('INPUT')

    await page.keyboard.press('ArrowUp')
    await waitForEntry(page, 1)

    // Load-bearing: without this the test could pass on a dialog that never
    // closed, which is the one state that cannot exercise the guard at all.
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
    expect(await activeTag(page)).toBe('INPUT')

    await page.keyboard.press('ArrowUp')
    await waitForEntry(page, 2)

    await expect(input).toHaveValue('2')
})
