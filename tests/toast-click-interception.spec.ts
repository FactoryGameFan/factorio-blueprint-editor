import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Toasts swallowing clicks meant for the canvas - issue #119.

    `.toasts-container` is `position: fixed; bottom: 0; right: 0; width: 320px;
    z-index: 20`, so a toast sits on top of the editor, and loading a blueprint
    raises one that lives five seconds. A click in that column goes to the toast
    `div`, pixi never sees a `pointerdown`, and the action behind it never runs.
    Measured, the lost click's target was `DIV#toast-3.toasts-toast` rather than
    `CANVAS#editor`.

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
 * The centre of the topmost toast, once it has stopped moving.
 *
 * The wait is not optional. A toast animates in - the same toast was measured at
 * x=1280, then 960, then 986 on the way - and that animation is the coin flip the
 * whole issue turned on. A test that read its box mid-slide would be measuring
 * the flake rather than the fix.
 */
async function settledToastCentre(page: Page): Promise<{ x: number; y: number }> {
    const toast = page.locator('.toasts-toast').first()
    await toast.waitFor({ state: 'attached', timeout: 15_000 })

    let previous = ''
    await expect
        .poll(
            async () => {
                const now = JSON.stringify(await toast.boundingBox())
                const settled = now !== 'null' && now === previous
                previous = now
                return settled
            },
            { timeout: 15_000, intervals: [150] }
        )
        .toBe(true)

    const box = await toast.boundingBox()
    if (!box) throw new Error('the toast vanished between settling and measuring')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
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

const toastCount = (page: Page): Promise<number> => page.locator('.toasts-toast').count()

test('a toast takes a click that was meant for the canvas', async ({ page }) => {
    /*
        The control, deliberately WITHOUT `suppressOverlays`: it asserts the problem
        is real. Without this, the test below would pass just as happily if toasts
        had stopped being raised, or stopped covering anything, and the suppression
        it checks would be guarding nothing.
    */
    await load(page)
    const at = await settledToastCentre(page)

    expect(await elementAt(page, at)).toContain('toasts-toast')

    // And it is not merely on top - it consumes the click. A toast that receives
    // one dismisses itself, so the count dropping is proof it was delivered there.
    const before = await toastCount(page)
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => toastCount(page), { timeout: 5000 }).toBeLessThan(before)
})

test('with toasts suppressed the same click reaches the canvas instead', async ({ page }) => {
    await suppressOverlays(page)
    await load(page)
    const at = await settledToastCentre(page)

    // Still drawn - the suppression takes the pointer away, not the notification.
    expect(await toastCount(page), 'the toast should still be rendered').toBeGreaterThan(0)
    expect(await elementAt(page, at)).toContain('CANVAS')

    /*
        And the click goes past it. The toast surviving is the observable half:
        under the control above the very same click dismissed one.

        Checked over a window shorter than the five-second auto-dismiss, so a
        toast that goes away here went away because it was clicked.
    */
    const before = await toastCount(page)
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(1500)
    expect(await toastCount(page), 'the toast received a click it should not have').toBe(before)
})
