import { test, expect } from '@playwright/test'

/*
    The first spec that dispatches real pointer and keyboard input (issue #44).
    Every other spec drives the model layer through window.__fbe_test hooks, which
    was a deliberate trade - injecting blueprints directly is fast and avoids URL
    length limits - but it means nothing covers the point where a user touches
    anything, and 29 of the strictNullChecks errors left in #22 live in exactly
    that code.

    This covers the three mode transitions that need no entity under the cursor:

        NONE -> PAN     left drag on empty space
        NONE -> COPY    ctrl + left drag
        NONE -> DELETE  ctrl + right drag

    The bindings are in Editor.ts's ActionRegistry. EDIT and PAINT are not here:
    EDIT needs the pointer over a specific entity, which needs a world -> screen
    mapping the editor does not currently expose (`toWorld` goes the other way),
    and PAINT needs the inventory. Both want a follow-up rather than a fragile
    aim-at-the-middle-and-hope.

    Deliberately runs against the empty blueprint the editor opens with, so every
    point on the canvas is empty space and a press cannot be caught by an entity
    under the cursor.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

const modeOf = (page: Page): Promise<string> =>
    page.evaluate(() => (window as any).__fbe_test.editorMode())

async function openEditor(page: Page): Promise<{ x: number; y: number }> {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const box = await page.locator(CANVAS).boundingBox()
    if (!box) throw new Error('the editor canvas has no bounding box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('a left drag on empty space enters and leaves PAN', async ({ page }) => {
    const centre = await openEditor(page)

    await page.mouse.move(centre.x, centre.y)
    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.down()
    expect(await modeOf(page)).toBe('PAN')

    // The drag itself, so panEnd is reached from a moved viewport rather than a
    // press and release in place.
    await page.mouse.move(centre.x + 64, centre.y + 32)
    expect(await modeOf(page)).toBe('PAN')

    await page.mouse.up()
    expect(await modeOf(page)).toBe('NONE')
})

test('ctrl and a left drag enter and leave COPY', async ({ page }) => {
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)

    await page.keyboard.down('Control')
    await page.mouse.down()
    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.move(centre.x + 96, centre.y + 96)
    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await modeOf(page)).toBe('NONE')
})

test('ctrl and a right drag enter and leave DELETE', async ({ page }) => {
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)

    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    expect(await modeOf(page)).toBe('DELETE')

    await page.mouse.move(centre.x + 96, centre.y + 96)
    expect(await modeOf(page)).toBe('DELETE')

    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')
    expect(await modeOf(page)).toBe('NONE')
})

test('the modes do not leak into one another', async ({ page }) => {
    /*
        Each entry/exit pair is registered independently, so the thing worth
        checking is that running them back to back leaves no mode set - an
        exit that failed to fire would show up here rather than in the tests
        above, each of which starts from a fresh page.
    */
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Control')
        await page.mouse.down()
        await page.mouse.move(centre.x + 32, centre.y + 32)
        await page.mouse.up()
        await page.keyboard.up('Control')
        expect(await modeOf(page)).toBe('NONE')

        await page.mouse.down()
        await page.mouse.move(centre.x, centre.y)
        await page.mouse.up()
        expect(await modeOf(page)).toBe('NONE')
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
