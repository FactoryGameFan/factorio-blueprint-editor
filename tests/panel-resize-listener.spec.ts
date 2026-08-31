import { test, expect } from '@playwright/test'
import { suppressOverlays } from './helpers/overlays'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    `Panel`'s window resize listener, and what happens to it when a subclass
    constructor throws (issue #287).

    `Panel`'s constructor put the listener on `window` and `destroy()` was the
    only thing that took it off. A subclass constructor that throws after
    `super()` returns never hands back the object, so nothing can ever call
    `destroy()` on it: the listener stayed on `window` for the life of the page,
    holding the half-built panel and its whole pixi subtree alive, and calling
    `setPosition()` on that object at every resize.

    Same class of bug as #280's registry leak, one constructor lower down -
    `Editor extends Dialog extends Panel`, so `Panel`'s constructor is the first
    to run and the last thing a throwing subclass can undo. The fix is the same
    move: register when the panel joins the display tree rather than when it is
    built, and deregister when it leaves.

    Nothing else in tests/ can see any of this. A leaked listener costs no
    assertion anywhere - the app looks and behaves identically, it simply retains
    an object forever - so this spec counts listeners directly, by wrapping
    `window.addEventListener`/`removeEventListener` before the page's own scripts
    run. It tracks the listener *functions* rather than counting calls, because
    the DOM dedupes an identical (type, listener) pair and a count of calls would
    disagree with what is actually registered.

    Where the throwing panel comes from. Every icon site that used to throw in an
    editor constructor was guarded in #286, so there is no live bug left to
    borrow - which is the point, and is why `__fbe_test.throwingDialogAttempt`
    exists. `ThrowingDialog` extends `Dialog`, so it is a `Panel`, and its
    constructor throws after `super()` has run: exactly the shape this leaks on.

    THE THIRD TEST IS THE ONE TO READ FIRST. A "fix" that simply never registers
    the listener passes both of the others perfectly - nothing leaks if nothing
    is ever added - and quietly stops every panel following the window. That is
    what test 3 is for, and `tests/tools-panel.spec.ts`'s narrow-viewport case
    would catch it too.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

declare global {
    interface Window {
        /** How many distinct `resize` listeners are registered right now. */
        __resizeListeners: () => number
    }
}

/*
    Installed before any page script, so it sees the editor's own registrations
    as they happen. `addInitScript` rather than an `evaluate` for the reason
    `suppressOverlays` gives: it has to survive the navigation, and the panels
    are built during startup.
*/
async function countResizeListeners(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const live = new Set<unknown>()
        const add = window.addEventListener.bind(window)
        const remove = window.removeEventListener.bind(window)

        window.addEventListener = ((type: string, listener: unknown, options: unknown) => {
            if (type === 'resize') live.add(listener)
            return add(type as 'resize', listener as EventListener, options as boolean)
        }) as typeof window.addEventListener

        window.removeEventListener = ((type: string, listener: unknown, options: unknown) => {
            if (type === 'resize') live.delete(listener)
            return remove(type as 'resize', listener as EventListener, options as boolean)
        }) as typeof window.removeEventListener

        window.__resizeListeners = () => live.size
    })
}

const listenerCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__resizeListeners())

const dialogCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.openDialogCount())

async function load(page: Page): Promise<void> {
    await countResizeListeners(page)
    await suppressOverlays(page)
    await waitForEditor(page)
}

test('a panel constructor that throws leaves no resize listener behind', async ({ page }) => {
    await load(page)
    const before = await listenerCount(page)

    /*
        Twice, and the return value is the control: it says the constructor
        really threw. Without it a `ThrowingDialog` that quietly stopped throwing
        would leave the assertion below passing while measuring nothing.
    */
    const attempt = (): Promise<boolean> =>
        page.evaluate(() => window.__fbe_test.throwingDialogAttempt())
    expect(await attempt()).toBe(true)
    expect(await attempt()).toBe(true)

    expect(await listenerCount(page)).toBe(before)
})

test('opening and closing a dialog leaves no resize listener behind', async ({ page }) => {
    await load(page)
    const before = await listenerCount(page)

    await page.evaluate(() => window.__fbe_test.openImportDialog())
    expect(await dialogCount(page)).toBe(1)

    await page.keyboard.press('Escape')
    expect(await dialogCount(page)).toBe(0)

    expect(await listenerCount(page)).toBe(before)
})

test('an open dialog still follows a window resize', async ({ page }) => {
    /*
        The control for the other two. Deregistering is trivially correct if the
        listener is never registered at all, and that mistake is invisible to
        both of them - so this asserts the panel actually moves when the window
        does, which is the whole reason the listener exists.

        `Dialog.setPosition` centres on `G.app.screen`, so a narrower window puts
        the dialog at a smaller x. Read through `topDialogBounds`, the same hook
        chest-editor.spec.ts locates dialog controls with.
    */
    await load(page)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.evaluate(() => window.__fbe_test.openImportDialog())
    expect(await dialogCount(page)).toBe(1)

    const wide = await page.evaluate(() => window.__fbe_test.topDialogBounds())

    await page.setViewportSize({ width: 800, height: 720 })
    /*
        The resize has to reach pixi's own renderer before the dialog is asked
        where it is: `setViewportSize` resolves once the browser has resized, not
        once the page has handled the event. Same race tools-panel.spec.ts
        documents, and the same fix - wait for the value to settle rather than
        for a fixed delay.
    */
    await expect
        .poll(async () => (await page.evaluate(() => window.__fbe_test.topDialogBounds())).x)
        .toBeLessThan(wide.x)
})
