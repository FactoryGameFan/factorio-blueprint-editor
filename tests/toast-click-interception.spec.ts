import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'
import { PERSISTENT_TOAST_CLASS } from '../packages/website/src/toasts'

/*
    Toasts and clicks meant for the canvas - issues #119 and #228.

    `.toasts-container` is `position: fixed; bottom: 0; right: 0; width: 320px;
    z-index: 20`, so a toast sits on top of an editor whose canvas fills the
    window. It used to take the click: pixi never saw a `pointerdown` and the
    action behind it never ran. Measured then, the lost click's target was
    `DIV#toast-3.toasts-toast` rather than `CANVAS#editor`.

    **These tests changed direction in #228 and the first one now asserts the
    opposite of what it used to.** Ordinary toasts are `pointer-events: none`,
    so the click goes past them. What is left to pin is that it really does go
    past, and that the one exception survives.

    Why the exception exists: a toast created with `timeout: Infinity` has no
    other way to be dismissed, so it keeps `pointer-events: auto` through
    `PERSISTENT_TOAST_CLASS`. There are two callers, both fatal - WebAssembly
    unsupported (`index.ts:107`) and an unrecoverable startup failure
    (`index.ts:176`) - and both `throw` immediately afterwards, so no editor
    exists underneath for such a toast to block.

    Why the container rule is not enough on its own, which is the thing to
    understand before touching the CSS: a toast is `position: relative` inside a
    320px container, so a **settled** toast spans the container's full width.
    Measured at 1280x720, container `x 960..1280, y 588..720` against toasts at
    `y 596..661` and `y 669..715` - the uncovered area is three margin bands
    totalling about 21px of height. `pointer-events` inherits, which is what
    makes the single declaration on the container reach the toasts at all.

    And a warning about measuring any of this: a toast animates in, and the same
    toast was measured at x=1280, then 960, then 986 on the way. A probe reading
    a point 500ms after load reports `DIV.toasts-container` where one reading
    after the stack settles reports `DIV.toasts-toast`. **An overlay measurement
    taken before the stack settles is measuring the animation**, which is why
    `settledTopToast` settles on identity and geometry together rather than
    waiting a fixed time.

    What the second test cannot see: it injects an element carrying
    `PERSISTENT_TOAST_CLASS` rather than driving a real `timeout: Infinity`
    toast, because neither caller is reachable from a spec - the WebAssembly
    branch is guarded by `typeof WebAssembly !== 'object' && ...`, which
    short-circuits in any browser that has it. So it pins the CSS exception and
    not the `timeout === Infinity` condition in `toasts.ts` that applies the
    class. Importing the class name from that module is what stops the two
    drifting: a rename reaches both or neither.
*/

type Page = import('@playwright/test').Page

const BP = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [{ entity_number: 1, name: 'steel-chest', position: { x: 0.5, y: 0.5 } }],
})

async function load(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, BP)
}

/**
 * The topmost toast: its id, and its centre, once the stack has stopped moving.
 *
 * Two separate races here, both measured, and the **id** is what makes the tests
 * that use it deterministic.
 *
 * A toast animates in - the same toast was measured at x=1280, then 960, then
 * 986 on the way - and that animation is the coin flip the whole issue turned
 * on. A test that read its box mid-slide would be measuring the flake rather
 * than the fix.
 *
 * And the stack itself changes. Loading raises three toasts: a `success` and an
 * `info` on 5s and 10s, then the **welcome** toast a further second later, on a
 * 30s timeout, prepended so that it becomes the new topmost. So `.first()` is
 * not one element - a Playwright locator re-resolves on every call, and a poll
 * built on it can compare the box of one toast against the box of another and
 * settle on a centre that belongs to neither. Hence settling on identity **and**
 * geometry together, and returning the id so the caller can hold on to the
 * element it actually measured.
 */
async function settledTopToast(page: Page): Promise<{ id: string; x: number; y: number }> {
    await page.locator('.toasts-toast').first().waitFor({ state: 'attached', timeout: 15_000 })

    let previous = ''
    let id = ''
    await expect
        .poll(
            async () => {
                const top = await page.evaluate(() => {
                    const el = document.querySelector('.toasts-toast')
                    if (!el) return null
                    const r = el.getBoundingClientRect()
                    return { id: el.id, box: `${r.x},${r.y},${r.width},${r.height}` }
                })
                if (top === null) return false
                const now = `${top.id}@${top.box}`
                const settled = now === previous
                previous = now
                id = top.id
                return settled
            },
            { timeout: 20_000, intervals: [150] }
        )
        .toBe(true)

    const box = await page.locator(`#${id}`).boundingBox()
    if (!box) throw new Error('the toast vanished between settling and measuring')
    return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Put a non-expiring toast on screen the way `toasts.ts` would, minus the
 * timer - see the header for why the real callers cannot be reached from here.
 *
 * `animation: none` because `.toasts-toast` slides in, and this element's box is
 * read immediately; the animation is not what is under test and waiting for it
 * would only add a second settle poll.
 */
async function injectPersistentToast(
    page: Page,
    cls: string
): Promise<{ id: string; x: number; y: number }> {
    const id = 'persistent-under-test'
    const box = await page.evaluate(
        ([elementId, persistentClass]: [string, string]) => {
            const container = document.querySelector('.toasts-container')
            if (!container) throw new Error('no toasts container')
            const el = document.createElement('div')
            el.id = elementId
            el.className = `toasts-toast toasts-error ${persistentClass}`
            el.style.animation = 'none'
            const text = document.createElement('span')
            text.className = 'toasts-text'
            text.textContent = 'unrecoverable error'
            el.appendChild(text)
            /*
                `insertBefore`, not `prepend`, which is what toasts.ts itself
                uses: the specs' tsconfig carries `node` in `types` and Node's
                own `prepend` overload wins here, so the DOM call does not type
                check inside a spec even though it does in the website package.
            */
            container.insertBefore(el, container.firstChild)
            const r = el.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        },
        [id, cls] as [string, string]
    )
    return { id, ...box }
}

/** What the browser says is on top at a point - a toast, or the canvas. */
const elementAt = (page: Page, at: { x: number; y: number }): Promise<string> =>
    page.evaluate(
        ([x, y]: [number, number]) => {
            const el = document.elementFromPoint(x, y)
            return el ? `${el.tagName}.${el.className}` : 'null'
        },
        [at.x, at.y] as [number, number]
    )

/** Whether that one toast is still in the document. */
const stillThere = (page: Page, id: string): Promise<boolean> =>
    page.evaluate((k: string) => document.getElementById(k) !== null, id)

test('an ordinary toast lets a click through to the canvas', async ({ page }) => {
    /*
        Deliberately WITHOUT `suppressOverlays`: this is the production
        behaviour, and the whole point of #228 is that a user gets it without a
        test helper. Before that change this same assertion read
        `toContain('toasts-toast')`.
    */
    await load(page)
    const at = await settledTopToast(page)

    expect(await elementAt(page, at)).toContain('CANVAS')

    /*
        And the click really is passing through rather than merely being routed
        past. A toast that receives one dismisses itself (`toasts.ts` races a
        click listener against the timeout), so **that** toast still standing is
        proof the click was not delivered to it.

        Keyed to its id rather than to the number of toasts on screen. Counting
        made the old version of this able to pass without the click doing
        anything: three toasts are raised and the `success` one expires on its
        own five seconds in, so "the count went down" was satisfied by a timer.
        The one measured here is the welcome toast, which lives thirty seconds,
        so it cannot disappear inside this window for any reason but a click.
    */
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(1500)
    expect(await stillThere(page, at.id), 'the toast took a click it should not have').toBe(true)
})

test('a non-expiring toast still takes one', async ({ page }) => {
    /*
        The control, and it can fail while the test above passes: dropping the
        `.toasts-persistent` rule from index.css makes every toast
        click-through, which satisfies the first test perfectly and leaves the
        two fatal error messages with no way to be dismissed at all.
    */
    await load(page)
    const at = await injectPersistentToast(page, PERSISTENT_TOAST_CLASS)

    expect(await elementAt(page, at)).toContain(PERSISTENT_TOAST_CLASS)
})

test('suppressOverlays covers the non-expiring one too', async ({ page }) => {
    /*
        The helper has to name `.toasts-persistent` as well as the container,
        because `pointer-events: auto` on a child is not overridden by any rule
        on its parent, `!important` included. Without that a spec would start
        losing clicks to exactly the toast that never goes away on its own -
        which is the #119 flake back again, on the one toast with no timer to
        end it.
    */
    await suppressOverlays(page)
    await load(page)
    const at = await injectPersistentToast(page, PERSISTENT_TOAST_CLASS)

    // Still drawn - the suppression takes the pointer away, not the notification.
    expect(await stillThere(page, at.id), 'the toast should still be rendered').toBe(true)
    expect(await elementAt(page, at)).toContain('CANVAS')
})
