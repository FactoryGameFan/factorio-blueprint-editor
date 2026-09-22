import { test, expect } from '@playwright/test'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    A toast leaves the DOM on every dismissal path - issue #443.

    toasts.ts removes a toast on `transitionend` of the collapse that
    `.toasts-toast-fadeOut` starts. A transition needs a computed style to
    start from. When a toast is dismissed before the browser has computed its
    style even once, the first style it ever gets already carries the fade-out
    class, so nothing changes, no transition runs, and `transitionend` never
    fires. The old code then recorded `0px` from the fade-out's own
    `animationend` and the toast sat in the column at zero height for good.

    Measured on the old code, three runs each. Dismissed in the task that
    created it: stuck 3 of 3, and the event log holds no
    `animationstart(toastsFadeIn)` at all - the slide-in never began. The
    issue's own reproduction, two `fastForward` jumps back to back, is the same
    case with a frame race in front of it: stuck 2 of 3, and the run that
    survived had rendered a frame between the jumps.

    The first test here is the deterministic form of that race. A
    MutationObserver callback is a microtask, so a `click()` from it lands
    before the browser can render anything. `HTMLElement.click()` reaches an
    ordinary toast's click listener even though the toast is
    `pointer-events: none`, because that rule only affects hit testing.

    The other two tests pin the paths that already worked, so the fix cannot
    trade one for another. Under `page.clock` only JS timers are faked; CSS
    animations and transitions run on real time, which is what lets the
    slide-in be caught mid-way and let finish.

    Timers are jumped in order, 1s then 30s, never as one 31s jump: a single
    jump fires the welcome toast's creation timer late, at the end of the jump,
    so the toast is born at 31s and lives to 61s. And never `runFor`, which
    fires every animation frame on the way and has the editor render each one
    - measured, 56s of real time for 31s of fake.
*/

type Page = import('@playwright/test').Page

const welcome = (page: Page) => page.locator('.toasts-toast')

/** The names of the CSS animations and transitions running on the top toast. */
const running = (page: Page): Promise<string[]> =>
    welcome(page)
        .first()
        .evaluate(t =>
            t
                .getAnimations()
                .map(a =>
                    'animationName' in a
                        ? (a as CSSAnimation).animationName
                        : (a as CSSTransition).transitionProperty
                )
        )

/**
 * Every animation and transition that has started on any toast since the
 * page loaded, by name, in order, plus `cancel:` and `end:` entries for the
 * animations. Recorded from the events on the column, so a claim about what
 * carried a toast out can be checked after the toast is gone. Sampling
 * `getAnimations()` after the fact instead has a window the size of the 0.2s
 * transition, which a slow shard can miss. The log only grows, so a poll on
 * it is monotone: an entry seen late is still seen.
 */
const started = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as any).__toastEventsStarted as string[])

/**
 * Freezes the next slide-in at its first frame, from inside the page in
 * the `animationstart` handler, so a dismissal after it is guaranteed to
 * land mid slide-in however slow the machine. Waiting from the test side for
 * the 300ms animation to be running is a race the test can lose.
 */
const holdNextSlideIn = (page: Page): Promise<void> =>
    page.evaluate(() => {
        ;(window as any).__toastHoldSlideIn = true
    })

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.clock.install()
    await waitForEditor(page)
    await page.evaluate(() => {
        const container = document.querySelector('.toasts-container')
        if (!container) throw new Error('no toasts container')
        const log: string[] = []
        ;(window as any).__toastEventsStarted = log
        container.addEventListener(
            'animationstart',
            e => {
                const name = (e as AnimationEvent).animationName
                log.push(name)
                if (name === 'toastsFadeIn' && (window as any).__toastHoldSlideIn) {
                    ;(window as any).__toastHoldSlideIn = false
                    for (const a of (e.target as Element).getAnimations()) {
                        if ((a as CSSAnimation).animationName === name) a.pause()
                    }
                }
            },
            true
        )
        container.addEventListener(
            'animationcancel',
            e => log.push(`cancel:${(e as AnimationEvent).animationName}`),
            true
        )
        container.addEventListener(
            'animationend',
            e => log.push(`end:${(e as AnimationEvent).animationName}`),
            true
        )
        container.addEventListener(
            'transitionrun',
            e => log.push((e as TransitionEvent).propertyName),
            true
        )
    })
})

test('a toast dismissed in the task that created it still leaves the DOM', async ({ page }) => {
    await page.evaluate(() => {
        const container = document.querySelector('.toasts-container')
        if (!container) throw new Error('no toasts container')
        new MutationObserver(records => {
            for (const r of records) for (const n of r.addedNodes) (n as HTMLElement).click()
        }).observe(container, { childList: true })
    })
    await page.clock.fastForward(1000)

    // The click was delivered: the toast is on its way out, not merely present.
    await expect(welcome(page)).toHaveClass(/toasts-toast-fadeOut/)
    /*
        5s is ten times the 0.5s the collapse takes, and short enough that a
        regression fails here rather than at the 60s default. The old code
        never removes it: the toast stays with `style.maxHeight` at 0px.
    */
    await expect(welcome(page), 'the toast was never removed').toHaveCount(0, { timeout: 5000 })
    /*
        And it was the max-height collapse that carried it out, which is what
        toasts.ts's second offsetHeight read is for. Without that read the
        recorded height is never committed, max-height goes `none` to 0 with
        no transition, and only the padding and border transitions remain.
    */
    expect(await started(page)).toContain('max-height')
})

test('a toast dismissed while sliding in still leaves the DOM', async ({ page }) => {
    await holdNextSlideIn(page)
    await page.clock.fastForward(1000)
    // The slide-in has started and is now held at its first frame.
    await expect.poll(() => started(page)).toContain('toastsFadeIn')
    await page.clock.fastForward(30000)

    await expect(welcome(page)).toHaveClass(/toasts-toast-fadeOut/)
    await expect(welcome(page), 'the toast was never removed').toHaveCount(0, { timeout: 5000 })
    /*
        The dismissal really did land mid slide-in: the fade-out class
        replaced the animation, so the held slide-in was cancelled and never
        ended. Without the hold, a fast machine can pass this by luck and a
        slow one dismisses a settled toast and tests nothing new.
    */
    const log = await started(page)
    expect(log).toContain('cancel:toastsFadeIn')
    expect(log).not.toContain('end:toastsFadeIn')
})

test('a toast that expires after settling collapses through its transition', async ({ page }) => {
    await page.clock.fastForward(1000)
    await expect.poll(() => running(page)).toEqual([])
    await expect(welcome(page)).toHaveCSS(
        'transition-property',
        'max-height, margin, border, padding'
    )
    const height = await welcome(page).evaluate(t => (t as HTMLElement).offsetHeight)
    expect(height).toBeGreaterThan(0)

    await page.clock.fastForward(30000)
    await expect(welcome(page)).toHaveClass(/toasts-toast-fadeOut/)
    await expect(welcome(page), 'the toast was never removed').toHaveCount(0, { timeout: 5000 })
    /*
        The fade-out is still a fade-out: the slide-out animation and the
        max-height collapse both ran, so the toasts below it slide up rather
        than jump. Removing the toast on the fade-out's `animationend` instead
        would have passed the two tests above and lost this.
    */
    const log = await started(page)
    expect(log).toEqual(expect.arrayContaining(['toastsFadeOut', 'max-height']))
    // The control for the test above: a settled toast's slide-in ended and was not cut short.
    expect(log).toContain('end:toastsFadeIn')
    expect(log).not.toContain('cancel:toastsFadeIn')
})
