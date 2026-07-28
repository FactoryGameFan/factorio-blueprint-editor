import { test, expect } from '@playwright/test'
import { suppressOverlays } from './helpers/overlays'

/*
    The settings pane swallowing clicks meant for the canvas - issue #130, and
    the same bug as #119 in the opposite corner.

    `packages/website/src/settingsPane.ts` builds a dat.gui panel and appends it
    to `document.body`; `packages/website/src/index.css` pins it with
    `.dg.main { position: fixed; bottom: 0; left: 0; z-index: 5 }`. It is open by
    default - `closed` reads `localStorage['dat.gui.closed']`, which a fresh
    profile does not have - so it sits on top of the editor from the first frame.

    Measured at the 1280x720 the config runs: the pane is 320x236 at (0, 484),
    the canvas is the full 1280x720, and `document.elementFromPoint` at the
    pane's centre answers `DIV.c` rather than `CANVAS#editor`. That is a dead
    rectangle over about 8% of the canvas.

    #119 fixed the toast half of this and its helper suppressed
    `.toasts-container` alone, so this half stayed live and kept
    `paste-cross-type-settings.spec.ts` intermittent - it failed twice during the
    #77 batches, both times a hover timeout, and its source entity is the
    left-hand one of the pair.

    Structured like `toast-click-interception.spec.ts`, for the same reason: the
    point under test is the pane's own box, read at runtime, rather than any
    entity's position. What the wired specs prove is the outcome; what these
    prove is that the pane can and does take a pointer event, and stops once
    suppressed.

    Both halves matter here too. `elementFromPoint` says where the browser would
    route a click; the COPY-mode assertion says what actually happened to one.
    Ctrl and a left press enter COPY against the empty blueprint the editor opens
    with, which needs nothing under the cursor - so if the mode changes, pixi got
    the press, and if it does not, something else did.
*/

type Page = import('@playwright/test').Page

const modeOf = (page: Page): Promise<string> => page.evaluate(() => window.__fbe_test.editorMode())

async function open(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.locator('.dg.main').waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * A point inside the pane that is over the canvas and safe to press.
 *
 * "Safe" is not fussiness. The pane holds a `<select>` for Grid Pattern, and
 * pressing a native dropdown open blocks the session - every later command in
 * the run would hang rather than fail. So this walks candidate points and takes
 * the first whose element is not a form control, rather than assuming the centre
 * is inert. It throws if every candidate is one, because a spec that silently
 * fell back to a point outside the pane would pass while testing nothing.
 */
async function panePressPoint(page: Page): Promise<{ x: number; y: number; el: string }> {
    const found = await page.evaluate(() => {
        const pane = document.querySelector('.dg.main')
        if (!pane) return null
        const r = pane.getBoundingClientRect()

        const describe = (el: Element | null): string =>
            el ? `${el.tagName}${el.id ? `#${el.id}` : ''}.${el.className}` : 'null'
        const interactive = (el: Element | null): boolean =>
            el !== null && ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(el.tagName)

        // Left edge inward: dat.gui puts its labels there, and its inputs to the
        // right. Several heights, so one crowded row does not defeat this.
        for (const fy of [0.5, 0.35, 0.65, 0.8, 0.2]) {
            for (const fx of [0.08, 0.16, 0.3]) {
                const x = r.x + r.width * fx
                const y = r.y + r.height * fy
                const el = document.elementFromPoint(x, y)
                if (el === null || interactive(el)) continue
                if (!pane.contains(el)) continue
                return { x, y, el: describe(el) }
            }
        }
        return null
    })

    if (!found) throw new Error('found no inert point inside the settings pane to press')
    return found
}

/** What the browser says is on top at a point - the pane, or the canvas. */
const elementAt = (page: Page, at: { x: number; y: number }): Promise<string> =>
    page.evaluate(
        ([x, y]: [number, number]) => {
            const el = document.elementFromPoint(x, y)
            return el ? `${el.tagName}${el.id ? `#${el.id}` : ''}.${el.className}` : 'null'
        },
        [at.x, at.y] as [number, number]
    )

/*
    The control. It deliberately does NOT suppress, because a spec that only
    checked the suppressed case would pass just as happily if the pane had never
    covered anything - which is the mistake #119's own control exists to prevent.
    Mutation check: make `.dg.main` non-interactive in the app's own CSS and this
    test fails, which is what says it is doing work.
*/
test('the settings pane takes a press that was meant for the canvas', async ({ page }) => {
    await open(page)

    const at = await panePressPoint(page)
    expect(at.el).not.toContain('CANVAS')
    expect(await elementAt(page, at)).toBe(at.el)

    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    await page.mouse.down()

    // The press landed on the pane, so the editor never saw it and never entered
    // COPY. This is the lost click, and it is silent - nothing errors.
    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.up()
    await page.keyboard.up('Control')
})

test('with the pane suppressed the same press reaches the canvas instead', async ({ page }) => {
    await suppressOverlays(page)
    await open(page)

    const pane = await page.locator('.dg.main').boundingBox()
    if (!pane) throw new Error('the settings pane has no bounding box')
    const at = { x: pane.x + pane.width * 0.08, y: pane.y + pane.height * 0.5 }

    // Still drawn - the suppression only stops it taking pointer events, so a
    // trace or screenshot still shows what the editor was displaying.
    await expect(page.locator('.dg.main')).toBeVisible()
    expect(await elementAt(page, at)).toContain('CANVAS')

    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    await page.mouse.down()

    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.up()
    await page.keyboard.up('Control')
})
