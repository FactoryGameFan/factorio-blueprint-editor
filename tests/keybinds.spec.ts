import { test, expect } from '@playwright/test'

/*
    Keybind import, which runs at startup against whatever is in localStorage.

    That input is *persisted user data of unbounded age* - it survives every
    update - so it is the one place in the editor guaranteed to be handed names
    that no longer exist. An action renamed or removed in any release leaves a
    stale entry behind, and the entry stays there failing on every load, because
    nothing rewrites localStorage until keybinds are exported again.

    The corpus cannot reach any of this: it is neither a blueprint nor input, and
    the specs all start from an empty localStorage. Seeded with addInitScript,
    which runs before the page's own scripts.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/** Seeds localStorage the way a previous session would have left it. */
async function withStoredKeybinds(page: Page, keybinds: Record<string, string>): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.addInitScript((kb: Record<string, string>) => {
        localStorage.setItem('keybinds2', JSON.stringify(kb))
    }, keybinds)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    return errors
}

const keyCombos = (page: Page): Promise<Record<string, string>> =>
    page.evaluate(() => (window as any).__fbe_test.keyCombos())

test('stored keybinds are applied at startup', async ({ page }) => {
    const errors = await withStoredKeybinds(page, { rotate: 'KeyT', pipette: 'Shift+KeyP' })

    expect(await keyCombos(page)).toEqual({ rotate: 'KeyT', pipette: 'Shift+KeyP' })
    expect(errors.join(' | ')).not.toContain('TypeError')
})

test('a keybind naming an action that no longer exists is skipped, not fatal', async ({ page }) => {
    /*
        The stale entry used to throw - ActionRegistry.get was declared
        `: Action` but is a bare Map.get, so an unknown name gave undefined and
        `.keyCombo = kc` threw. Inside the import loop, so it was never one lost
        keybind: every entry after the stale one went with it, and which ones
        survived was an accident of Object.entries order.

        The stale entry is deliberately listed *first*, so a fix that only
        stopped the throw without continuing the loop still fails this.
    */
    const errors = await withStoredKeybinds(page, {
        'no-such-action-anymore': 'KeyZ',
        rotate: 'KeyT',
    })

    expect(errors.join(' | ')).not.toContain('TypeError')
    expect(await keyCombos(page)).toEqual({ rotate: 'KeyT' })
})

test('the stale entry is named in a warning rather than dropped silently', async ({ page }) => {
    /*
        Skipping quietly would leave a user whose keybind stopped working with
        nothing to look at. The name is the whole value of the message - it is
        what tells them which binding to set again.
    */
    const warnings: string[] = []
    page.on('console', m => {
        if (m.type() === 'warning') warnings.push(m.text())
    })

    await page.addInitScript(() => {
        localStorage.setItem('keybinds2', JSON.stringify({ 'no-such-action-anymore': 'KeyZ' }))
    })
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    expect(warnings.join(' | ')).toContain('no-such-action-anymore')
})
