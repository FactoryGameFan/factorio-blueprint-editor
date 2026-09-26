import { test, expect } from '@playwright/test'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    The one-time "give us a star" prompt (#427), and where it is allowed to sit.

    It started life as a toast, with its link and Dismiss button opted back
    into `pointer-events: auto`. That put two live click targets into the
    toast column that #228 had made click-through - the column sits on top of
    the ShortcutBar, and for the prompt's thirty seconds five of the nine slots
    lost part of their face to it. Measured at 1280x720 with the toast settled:
    Redo 1008 of its 1296 points, green-wire 224, Undo and Export image 108
    each, Export 24. Issue #430.

    So the prompt lives in the left-hand chrome now, under the GitHub tab,
    where nothing of the editor's own UI is drawn. The last test of the first
    group walks every slot face and is the regression guard: it fails on the
    toast version.

    The second group is issue #444: the one-time flag used to be written when
    the 60s timer fired, whether or not anyone could see the tab, so a user
    away from the tab across the 60s-90s window was never asked. Headless
    Chromium always reports a visible tab, so those tests replace
    `document.visibilityState` with a getter the test controls and check the
    instrument before every claim.
*/

type Page = import('@playwright/test').Page

const SLOT_NAMES = [
    'ALT',
    'copper-wire',
    'Import',
    'red-wire',
    'Export',
    'green-wire',
    'Undo',
    'Redo',
    'Export image',
]

/**
 * Per ShortcutBar slot, how many points of its 36x36 face `elementFromPoint`
 * answers with something other than the canvas. The grid is ShortcutBar's own:
 * cells at a 38px pitch from a 12px inset, two rows filled column-major.
 */
async function blockedSlotPoints(page: Page): Promise<Record<string, number>> {
    return page.evaluate(names => {
        const b = window.__fbe_test.shortcutBarBounds()
        const out: Record<string, number> = {}
        names.forEach((name, i) => {
            const x0 = b.x + 12 + Math.floor(i / 2) * 38
            const y0 = b.y + 12 + (i % 2) * 38
            let blocked = 0
            for (let dx = 0; dx < 36; dx++) {
                for (let dy = 0; dy < 36; dy++) {
                    const el = document.elementFromPoint(x0 + dx, y0 + dy)
                    if (!el || el.tagName !== 'CANVAS') blocked++
                }
            }
            out[name] = blocked
        })
        return out
    }, SLOT_NAMES)
}

const NONE_BLOCKED = Object.fromEntries(SLOT_NAMES.map(name => [name, 0]))

/** Tag and class of whatever is on top at a point. */
const elementAt = (page: Page, at: { x: number; y: number }): Promise<string> =>
    page.evaluate(
        ([x, y]: [number, number]) => {
            const el = document.elementFromPoint(x, y)
            return el ? `${el.tagName}.${el.className}` : 'null'
        },
        [at.x, at.y] as [number, number]
    )

const centre = async (page: Page, selector: string): Promise<{ x: number; y: number }> => {
    const box = await page.locator(selector).boundingBox({ timeout: 10_000 })
    if (!box) throw new Error(`${selector} has no box`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Puts `document.visibilityState` and `document.hidden` under the test's
 * control, starting in `initial`. Headless Chromium reports `visible` for
 * every page, and nothing in Playwright's API can hide a tab, so this is the
 * only way to reach the hidden path. It is an init script so the getters are
 * in place before the app's own module runs. Both accessors live on
 * `Document.prototype` in Chromium, so that is where they are replaced.
 */
async function fakeVisibility(page: Page, initial: 'visible' | 'hidden'): Promise<void> {
    await page.addInitScript(state => {
        ;(window as any).__fbeVisibility = state
        const read = (): string => (window as any).__fbeVisibility
        Object.defineProperty(Document.prototype, 'visibilityState', {
            configurable: true,
            get: () => read(),
        })
        Object.defineProperty(Document.prototype, 'hidden', {
            configurable: true,
            get: () => read() === 'hidden',
        })
    }, initial)
}

/**
 * Flips the faked state and fires `visibilitychange` the way the browser
 * does: on `document`, bubbling, so the app's `window` listeners hear it
 * too. Returns what the page then reads back, so a test can assert the
 * instrument moved before it trusts anything downstream.
 */
async function setVisibility(
    page: Page,
    state: 'visible' | 'hidden'
): Promise<{ visibilityState: string; hidden: boolean }> {
    return page.evaluate(s => {
        ;(window as any).__fbeVisibility = s
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        return { visibilityState: document.visibilityState, hidden: document.hidden }
    }, state)
}

const readVisibility = (page: Page): Promise<{ visibilityState: string; hidden: boolean }> =>
    page.evaluate(() => ({ visibilityState: document.visibilityState, hidden: document.hidden }))

const starPromptFlag = (page: Page): Promise<string | null> =>
    page.evaluate(() => localStorage.getItem('starPromptShown'))

test.describe('in a visible tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 })
        await page.clock.install()
        await waitForEditor(page)
    })

    test('star prompt appears after 60 seconds, links to the repo, and is shown only once', async ({
        page,
    }) => {
        const link = page.getByRole('link', { name: 'Give us a star on GitHub' })
        await expect(link).toHaveCount(0)
        await page.clock.fastForward(59000)
        await expect(link).toHaveCount(0)
        await page.clock.fastForward(1000)
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute(
            'href',
            'https://github.com/FactoryGameFan/factorio-blueprint-editor'
        )
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
        await expect(page.getByRole('status')).toHaveText("Enjoying the editor? We're open source!")

        /*
        A real hit test on both targets, not `focus()` plus Enter: that runs
        no hit test at all, so it passed while the Dismiss button was
        unreachable under something else.
    */
        expect(await elementAt(page, await centre(page, '#star-prompt a'))).toContain('A.')
        const dismiss = page.getByRole('button', { name: 'Dismiss star prompt' })
        const at = await centre(page, '#star-prompt button')
        expect(await elementAt(page, at)).toContain('BUTTON.')
        await page.mouse.click(at.x, at.y)
        await expect(link).toHaveCount(0)

        await waitForEditor(page)
        await page.clock.fastForward(60000)
        await expect(link).toHaveCount(0)
        await expect(dismiss).toHaveCount(0)
    })

    test('star prompt expires after 30 seconds without interaction', async ({ page }) => {
        await page.clock.fastForward(60000)
        const link = page.getByRole('link', { name: 'Give us a star on GitHub' })
        await expect(link).toBeVisible()
        /*
        29s and then 1s more, so this can tell the prompt's own 30s from a
        toast's 5s default - with a single 30s jump, deleting the timeout
        from the source kept the test green.
    */
        await page.clock.fastForward(29000)
        await expect(link).toBeVisible()
        await page.clock.fastForward(1000)
        await expect(link).toHaveCount(0)
    })

    test('star prompt leaves every ShortcutBar slot reachable (#430)', async ({ page }) => {
        /*
        Deliberately without `suppressOverlays`: this is what a user gets.

        The welcome toast is let expire and leave the DOM first, so that the
        control measures an empty column and the prompt then arrives into one,
        which is the order a user gets: welcome at 1s, gone at 31s, prompt at
        60s. That order is load-bearing on the toast version. The column is
        bottom-anchored, so a toast still below the prompt holds it up off the
        panel, and a walk taken then reads 0 and passes for the wrong reason -
        measured, this test went green against the toast version that way.

        Two jumps, 1s and then 30s, for the same reason: `fastForward` fires
        each due timer once at the end of the jump, so a single jump to 31s
        *creates* the welcome toast at 31s (its 1s timer fires late) and it
        then lives to 61s. Measured, a wait for the column to empty after that
        jump was only satisfied once the star toast itself had come and gone.
        `runFor` would keep the order too, but it fires every animation frame
        on the way and the editor renders each one - measured, 56s of real
        time for 31s of fake.

        The wait between the two jumps lets the welcome toast's slide-in
        finish before it is expired. It used to be load-bearing (issue #443):
        toasts.ts recorded a toast's height on the slide-in's `animationend`,
        so a toast expired mid slide-in recorded 0px, never transitioned and
        was never removed - measured with the two jumps 1ms apart, one run in
        two left a 0px toast in the column for good. Since #443 the height is
        read at dismissal and that same timing was removed 6 of 6. The wait
        stays so this test measures a settled column rather than the toast
        fix; `tests/toast-lifecycle.spec.ts` owns that. `getAnimations()` is
        empty once the slide-in has completed.

        And the prompt is given real time to settle in case it animates: the
        toast version slid in from off-screen right, and a measurement taken
        mid-slide measures the animation.
    */
        await page.clock.fastForward(1000)
        const welcome = page.locator('.toasts-toast')
        await expect(welcome).toHaveCount(1)
        await expect.poll(() => welcome.evaluate(t => t.getAnimations().length)).toBe(0)
        await page.clock.fastForward(30000)
        await expect(welcome).toHaveCount(0)
        expect(await blockedSlotPoints(page)).toEqual(NONE_BLOCKED)

        await page.clock.fastForward(29000)
        const link = page.getByRole('link', { name: 'Give us a star on GitHub' })
        await expect(link).toBeVisible()
        let previous = ''
        await expect
            .poll(
                async () => {
                    const now = JSON.stringify(await link.boundingBox())
                    const settled = now === previous
                    previous = now
                    return settled
                },
                { intervals: [200], timeout: 10_000 }
            )
            .toBe(true)

        expect(await blockedSlotPoints(page)).toEqual(NONE_BLOCKED)
    })
})

test.describe('in a hidden tab (#444)', () => {
    const link = (page: Page) => page.getByRole('link', { name: 'Give us a star on GitHub' })

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 })
        await page.clock.install()
        await fakeVisibility(page, 'hidden')
        await waitForEditor(page)
        // The instrument first: a shim that silently failed to take would
        // leave every test below passing against a visible tab.
        expect(await readVisibility(page)).toEqual({ visibilityState: 'hidden', hidden: true })
    })

    test('neither the prompt nor its flag appears while the tab stays hidden', async ({ page }) => {
        expect(await starPromptFlag(page)).toBeNull()
        await page.clock.fastForward(60000)
        /*
            A plain count, not `toHaveCount(0)`: that retries, and the
            installed clock also runs in real time, so against the old code
            the prompt expired on its own after 30 real seconds and the
            retrying form then passed. Measured: 30.8s, then green.
        */
        expect(await link(page).count()).toBe(0)
        expect(await starPromptFlag(page)).toBeNull()
        /*
            Past the 90s mark, where the old code had already shown and
            expired the prompt and left the flag behind - the issue's own
            reproduction. Still nothing, and the flag is still unwritten.
        */
        await page.clock.fastForward(30000)
        expect(await link(page).count()).toBe(0)
        expect(await starPromptFlag(page)).toBeNull()
    })

    test('the prompt and its flag wait for the tab to become visible, and the 30s starts then', async ({
        page,
    }) => {
        await page.clock.fastForward(60000)
        await page.clock.fastForward(45000)
        expect(await link(page).count()).toBe(0)
        expect(await starPromptFlag(page)).toBeNull()

        /*
            A `visibilitychange` that leaves the tab hidden is not a reason to
            show anything. A one-shot listener that did not re-check the state
            would spend itself here and never show the prompt at all.
        */
        expect(await setVisibility(page, 'hidden')).toEqual({
            visibilityState: 'hidden',
            hidden: true,
        })
        expect(await link(page).count()).toBe(0)
        expect(await starPromptFlag(page)).toBeNull()

        expect(await setVisibility(page, 'visible')).toEqual({
            visibilityState: 'visible',
            hidden: false,
        })
        await expect(link(page)).toBeVisible()
        expect(await starPromptFlag(page)).toBe('true')

        /*
            Two jumps, as in the visible group, so the expiry is measured to
            be the prompt's own 30s and not a toast's 5s. Counted from the
            60s mark it would have been gone 45s ago; counted from when it
            appeared it is still here. 25s then 5s rather than 29s then 1s:
            an installed clock keeps ticking in real time too (measured,
            1508ms of fake time over a 1.5s real wait), so a 1s margin is
            about one slow assertion away from the timer firing early.
        */
        await page.clock.fastForward(25000)
        await expect(link(page)).toBeVisible()
        await page.clock.fastForward(5000)
        expect(await link(page).count()).toBe(0)
        expect(await starPromptFlag(page)).toBe('true')
    })

    test('a prompt already on screen keeps its 30s when the tab goes hidden and does not come back', async ({
        page,
    }) => {
        expect(await setVisibility(page, 'visible')).toEqual({
            visibilityState: 'visible',
            hidden: false,
        })
        await page.clock.fastForward(60000)
        await expect(link(page)).toBeVisible()
        expect(await starPromptFlag(page)).toBe('true')

        /*
            The prompt was put on screen in a visible tab, so it has been seen
            and the flag is rightly spent. Hiding the tab now neither pauses
            the 30s nor arms a second showing: back at 80s there is still one
            prompt, and at 90s it is gone for good.
        */
        await page.clock.fastForward(10000)
        expect(await setVisibility(page, 'hidden')).toEqual({
            visibilityState: 'hidden',
            hidden: true,
        })
        await page.clock.fastForward(10000)
        expect(await setVisibility(page, 'visible')).toEqual({
            visibilityState: 'visible',
            hidden: false,
        })
        await expect(link(page)).toHaveCount(1)
        await page.clock.fastForward(10000)
        expect(await link(page).count()).toBe(0)
        await page.clock.fastForward(60000)
        expect(await link(page).count()).toBe(0)
    })
})
