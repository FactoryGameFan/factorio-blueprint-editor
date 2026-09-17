import { test, expect } from '@playwright/test'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    The one-time "give us a star" prompt (#427), and where it is allowed to sit.

    It started life as a toast, with its link and Dismiss button opted back
    into `pointer-events: auto`. That put two live click targets into the
    toast column that #228 had made click-through - the column sits on top of
    the ToolsPanel, and for the prompt's thirty seconds five of the nine slots
    lost part of their face to it. Measured at 1280x720 with the toast settled:
    Redo 1008 of its 1296 points, green-wire 224, Undo and Export image 108
    each, Export 24. Issue #430.

    So the prompt lives in the left-hand chrome now, under the GitHub tab,
    where nothing of the editor's own UI is drawn. The last test here walks
    every slot face and is the regression guard: it fails on the toast version.
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
 * Per ToolsPanel slot, how many points of its 36x36 face `elementFromPoint`
 * answers with something other than the canvas. The grid is ToolsPanel's own:
 * cells at a 38px pitch from a 12px inset, two rows filled column-major.
 */
async function blockedSlotPoints(page: Page): Promise<Record<string, number>> {
    return page.evaluate(names => {
        const b = window.__fbe_test.toolsPanelBounds()
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

test('star prompt leaves every ToolsPanel slot reachable (#430)', async ({ page }) => {
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

        The wait between the two jumps is for the welcome toast's slide-in to
        finish, and it is not optional. toasts.ts records a toast's height on
        `animationend` and collapses it through a transition on the way out;
        expire it while it is still sliding in and the fade-out replaces that
        animation, the recorded height is 0, no transition ever ends, and the
        toast is never removed. Measured with the two jumps 1ms apart: one run
        in two left the column holding a 0px toast for good, and the wait for
        an empty column then timed out. `getAnimations()` is empty once the
        slide-in has completed.

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
