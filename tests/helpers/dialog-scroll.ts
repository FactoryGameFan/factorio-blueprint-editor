import { expect, type Page } from '@playwright/test'
import type { ScrollBox, ScrollState } from './fbe-test-api'

/*
    Shared by the specs for the dialogs that scroll (issue #643): the book, the
    inventory and the bill of materials. They are drawn with pixi, so the only
    way to read how far one has scrolled, and where its thumb and track are,
    is the `topDialogScroll` hook. Everything else here is real pointer input.
*/

export interface Point {
    x: number
    y: number
}

/** The topmost dialog's scroll area. Throws when it has none. */
export async function scrollOf(page: Page): Promise<ScrollState> {
    const state = await page.evaluate(() => window.__fbe_test.topDialogScroll())
    if (state === undefined) throw new Error('the open dialog has no scroll area')
    return state
}

/** The thumb, which must be showing. */
export async function thumbOf(page: Page): Promise<ScrollBox> {
    const { thumb } = await scrollOf(page)
    if (thumb === undefined) throw new Error('the scroll area has no thumb: nothing scrolls')
    return thumb
}

export const centre = (box: ScrollBox): Point => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
})

/**
 * Two animation frames, so pixi has drawn what changed. A dialog added, or a
 * thumb moved, since the last frame is hit-tested where it used to be
 * (CLAUDE.md, "Pixi hit test needs a frame").
 */
export async function settle(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            })
    )
}

/** A real wheel notch of `deltaY` pixels with the pointer at `at`. */
export async function wheelAt(page: Page, at: Point, deltaY: number): Promise<void> {
    await page.mouse.move(at.x, at.y)
    await page.mouse.wheel(0, deltaY)
    await settle(page)
}

/**
 * A wheel event in lines or pages. Playwright's wheel is pixels only, and a
 * browser that reports lines is Firefox's default, so this goes to the canvas
 * as the event it would have sent.
 */
export async function wheelAtMode(
    page: Page,
    at: Point,
    deltaY: number,
    deltaMode: 1 | 2
): Promise<void> {
    await page.mouse.move(at.x, at.y)
    await page.evaluate(
        ({ x, y, deltaY, deltaMode }) => {
            const canvas = document.querySelector('#editor')
            if (!canvas) throw new Error('no canvas')
            canvas.dispatchEvent(
                new WheelEvent('wheel', {
                    clientX: x,
                    clientY: y,
                    deltaY,
                    deltaMode,
                    bubbles: true,
                    cancelable: true,
                })
            )
        },
        { x: at.x, y: at.y, deltaY, deltaMode }
    )
    await settle(page)
}

/** Press on the middle of the thumb, move the pointer `dy` down, and let go where it ends. */
export async function dragThumb(page: Page, dy: number, endX?: number): Promise<void> {
    const grab = centre(await thumbOf(page))
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    // Moves in steps, as a hand does: the thumb follows each one.
    await page.mouse.move(endX ?? grab.x, grab.y + dy, { steps: 8 })
    await settle(page)
    await page.mouse.up()
    await settle(page)
}

/**
 * Press on the middle of the thumb and then send pointer moves that say no
 * button is held - what the page sees when the release happened somewhere it
 * never heard about. Returns the scroll after them. The drag should have
 * ended; a thumb still following the pointer is the bug. The button is let go
 * at the end so the next step starts clean.
 */
export async function scrollAfterMovesWithNoButton(page: Page, dy: number): Promise<number> {
    const grab = centre(await thumbOf(page))
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.evaluate(
        ({ x, y, dy }) => {
            const canvas = document.querySelector('#editor')
            if (!canvas) throw new Error('no canvas')
            for (let i = 1; i <= 4; i++) {
                canvas.dispatchEvent(
                    new PointerEvent('pointermove', {
                        clientX: x,
                        clientY: y + (dy / 4) * i,
                        buttons: 0,
                        pointerId: 1,
                        pointerType: 'mouse',
                        isPrimary: true,
                        bubbles: true,
                        cancelable: true,
                    })
                )
            }
        },
        { x: grab.x, y: grab.y, dy }
    )
    await settle(page)
    const { scroll } = await scrollOf(page)
    await page.mouse.up()
    await settle(page)
    return scroll
}

/** Where on the track a click lands: a point `dy` below the middle of the thumb. */
export async function trackPointBelowThumb(page: Page): Promise<Point> {
    const { track, thumb } = await scrollOf(page)
    if (!thumb) throw new Error('no thumb')
    return {
        x: track.x + track.width / 2,
        y: (thumb.y + thumb.height + track.y + track.height) / 2,
    }
}

export async function trackPointAboveThumb(page: Page): Promise<Point> {
    const { track, thumb } = await scrollOf(page)
    if (!thumb) throw new Error('no thumb')
    return { x: track.x + track.width / 2, y: (track.y + thumb.y) / 2 }
}

/**
 * The scroll the thumb's position stands for: its offset down the track
 * against the room it has to travel, scaled to `maxScroll`.
 */
export function scrollFromThumb(state: ScrollState): number {
    const { thumb, track, maxScroll } = state
    if (!thumb) return 0
    const travel = track.height - thumb.height
    return ((thumb.y - track.y) / travel) * maxScroll
}

/** The checks every dialog's scrollbar has to pass; `scroll` is where it should be. */
export function expectThumbAgrees(state: ScrollState, scroll: number): void {
    expect(state.scroll).toBeCloseTo(scroll, 0)
    expect(scrollFromThumb(state)).toBeCloseTo(scroll, 0)
}
