import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    Alt mode marks every underground belt and pipe to ground that has no
    partner (#344). The game draws nothing for one, so the look - the
    `not_allowed` cursor box - is ours; what this pins is which undergrounds
    get it and that it follows alt mode and edits.

    The marker count cannot come from a sprite tally, because the marker is not
    part of any entity's sprites or info overlay, so the spec reads it through
    `markedUnpairedUndergrounds`, the entity numbers of the markers on screen.

    Deleting half of a pair is the case that needs the neighbour refresh: the
    edit is to entity 2, and the marker that has to appear is entity 3's. Undo
    re-creates entity 2 and has to take it away again.
*/

const EAST = 4
const WEST = 12

const UNDERGROUNDS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        // on its own
        {
            entity_number: 1,
            name: 'underground-belt',
            position: { x: 0.5, y: 0.5 },
            direction: EAST,
            type: 'input',
        },
        // a pair, three tiles apart
        {
            entity_number: 2,
            name: 'underground-belt',
            position: { x: 0.5, y: 3.5 },
            direction: EAST,
            type: 'input',
        },
        {
            entity_number: 3,
            name: 'underground-belt',
            position: { x: 4.5, y: 3.5 },
            direction: EAST,
            type: 'output',
        },
        // a pair of pipes to ground, whose undergrounds run towards each other
        { entity_number: 4, name: 'pipe-to-ground', position: { x: 4.5, y: 6.5 }, direction: EAST },
        { entity_number: 5, name: 'pipe-to-ground', position: { x: 0.5, y: 6.5 }, direction: WEST },
    ],
})

type Page = import('@playwright/test').Page

const marked = (page: Page): Promise<number[]> =>
    page.evaluate(() => window.__fbe_test.markedUnpairedUndergrounds())

test('alt mode marks the undergrounds with no partner, and follows edits', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, UNDERGROUNDS)

    // alt mode starts on
    expect(await page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(true)
    expect(await marked(page)).toEqual([1])

    // the toggle applies on Alt's key-up, hence the polls
    await page.keyboard.press('AltLeft')
    await expect.poll(() => page.evaluate(() => window.__fbe_test.infoOverlayVisible())).toBe(false)
    expect(await marked(page)).toEqual([])
    await page.keyboard.press('AltLeft')
    await expect.poll(() => marked(page)).toEqual([1])

    // Delete the input of the pair by hovering it and right-clicking, which
    // leaves the output on its own.
    const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(2))
    if (!at) throw new Error('entity 2 is not on screen')
    await page.mouse.move(at.x, at.y)
    await expect.poll(() => page.evaluate(() => window.__fbe_test.hoveredEntityNumber())).toBe(2)
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await expect
        .poll(() => page.evaluate(() => window.__fbe_test.entityPosition(2)))
        .toBeUndefined()
    expect(await marked(page)).toEqual([1, 3])

    // and undo pairs it again
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(() => page.evaluate(() => window.__fbe_test.entityPosition(2))).toBeDefined()
    expect(await marked(page)).toEqual([1])

    expect(pageErrors).toEqual([])
})
