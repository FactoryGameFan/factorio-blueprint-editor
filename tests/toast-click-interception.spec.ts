import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Toasts swallowing clicks meant for the canvas - issue #119.

    `.toasts-container` is `position: fixed; bottom: 0; right: 0; width: 320px;
    z-index: 20`, so a toast sits on top of the editor. A click in that column
    goes to the toast `div`, pixi never sees a `pointerdown`, and the action
    behind it never runs. Measured, the lost click's target was
    `DIV#toast-3.toasts-toast` rather than `CANVAS#editor`.

    Loading raises **three** toasts, not one, and they expire at different times:
    a `success` on 5s, an `info` on 10s, and - a second later, prepended above
    both - the welcome toast on 30s. That detail is not trivia; assuming a single
    five-second toast is what made these two tests race a timer, see
    `settledTopToast` and the note in the second test.

    That is what made nine pointer-driven specs intermittent, at roughly one full
    suite run in three. It presents as a paste that wrote nothing - the value is
    simply absent - which reads as a broken setter in whatever was last changed,
    and cost three baseline runs to prove was not a regression in #115.

    These test the mechanism, not any particular entity's position. An earlier
    draft put a chest under the toast column and asserted the overlap directly,
    which is a worse test than it sounds: the overlap depends on the viewport, on
    the zoom (96px per tile as measured, not 32), on how the view centres, and on
    how many toasts happen to be stacked - the third one is the tall one. Pinning
    all of that would fail for reasons that have nothing to do with the bug.

    So the point under test is the toast's own centre, read at runtime. What the
    nine wired specs then prove is the outcome; what these prove is that a toast
    can and does take a pointer event, and stops once suppressed.

    Both halves matter. `elementFromPoint` says where the browser would route a
    click, and the click-to-dismiss assertion says what actually happened to one -
    a toast that received a click removes itself (`toasts.ts` races a click
    listener against the timeout), so a toast still standing afterwards did not
    get it.
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

/** What the browser says is on top at a point - the toast, or the canvas. */
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

test('a toast takes a click that was meant for the canvas', async ({ page }) => {
    /*
        The control, deliberately WITHOUT `suppressOverlays`: it asserts the problem
        is real. Without this, the test below would pass just as happily if toasts
        had stopped being raised, or stopped covering anything, and the suppression
        it checks would be guarding nothing.
    */
    await load(page)
    const at = await settledTopToast(page)

    expect(await elementAt(page, at)).toContain('toasts-toast')

    /*
        And it is not merely on top - it consumes the click. A toast that
        receives one dismisses itself, so **that** toast going away is proof the
        click was delivered there.

        Keyed to its id rather than to the number of toasts on screen. Counting
        made this control able to pass without the click doing anything: three
        toasts are raised and the `success` one expires on its own five seconds
        in, so "the count went down" was satisfied by a timer. The one measured
        here is the welcome toast, which lives thirty seconds, so it cannot
        disappear inside this window for any reason but the click.
    */
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => stillThere(page, at.id), { timeout: 5000 }).toBe(false)
})

test('with toasts suppressed the same click reaches the canvas instead', async ({ page }) => {
    await suppressOverlays(page)
    await load(page)
    const at = await settledTopToast(page)

    // Still drawn - the suppression takes the pointer away, not the notification.
    expect(await stillThere(page, at.id), 'the toast should still be rendered').toBe(true)
    expect(await elementAt(page, at)).toContain('CANVAS')

    /*
        And the click goes past it. That toast surviving is the observable half:
        under the control above the very same click dismissed it.

        Keyed to the id, and this is the half that was **intermittently failing**
        - roughly one full suite run in six. It used to compare the total number
        of toasts before and after, over a window it described as "shorter than
        the five-second auto-dismiss". Two things wrong with that. The window is
        not anchored at the load: everything the settle poll spends comes out of
        the same budget, and under a long suite run it can spend seconds. And the
        count includes toasts this test never touches - the `success` one expires
        five seconds in and takes the count down with it, which fails the
        assertion for a reason that has nothing to do with the click. Measured on
        the timeline: three toasts up at +1.3s, down to two at +6.0s, untouched.

        Asking about the one toast that was clicked removes both problems - it
        lives thirty seconds, and no other toast's timer can speak for it.
    */
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(1500)
    expect(await stillThere(page, at.id), 'the toast received a click it should not have').toBe(
        true
    )
})
