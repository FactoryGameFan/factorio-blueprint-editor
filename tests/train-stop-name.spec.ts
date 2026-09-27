import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { loadBlueprint, waitForEditor } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    A train stop draws its station name in its info overlay (issue #340).

    Read from the overlay EntityContainer is showing, through `stationNameRuns`,
    rather than from a freshly built one the way `overlayInfoTally` works - a
    rename has to reach the live overlay, which takes both the `'station'`
    listener and `train-stop` in `redrawEntityInfo`'s type gate. The unnamed
    stop below is the case the gate decides: it starts with no overlay at all,
    and without `train-stop` in the gate a name given later is never drawn.

    Icon tags are drawn as icons, one run each, so a run reading
    `icon:signal-fuel` is the icon and not the tag's text.
*/

type Page = import('@playwright/test').Page

const TRAIN_STOPS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'train-stop',
            position: { x: 1, y: 1 },
            direction: 0,
            station: '[S] [virtual-signal=signal-fuel] Service',
        },
        { entity_number: 2, name: 'train-stop', position: { x: 11, y: 1 }, direction: 0 },
        {
            entity_number: 3,
            name: 'train-stop',
            position: { x: 21, y: 1 },
            direction: 0,
            // No item or signal named `character`, so no icon to draw.
            station: '[entity=character] Station',
        },
    ],
})

const runs = (page: Page, entityNumber: number): Promise<string[] | undefined> =>
    page.evaluate((n: number) => window.__fbe_test.stationNameRuns(n), entityNumber)

const setStation = (page: Page, entityNumber: number, station: string | undefined) =>
    page.evaluate(([n, s]) => window.__fbe_test.setStation(n, s), [entityNumber, station] as const)

async function load(page: Page): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await waitForEditor(page)
    await loadBlueprint(page, TRAIN_STOPS)
    return errors
}

test('a named train stop draws its name, with icon tags as icons', async ({ page }) => {
    const errors = await load(page)

    expect(await runs(page, 1)).toEqual(['[S] ', 'icon:signal-fuel', ' Service'])
    expect(await runs(page, 2)).toBeUndefined()
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a tag with no icon to draw is printed as typed', async ({ page }) => {
    const errors = await load(page)

    expect(await runs(page, 3)).toEqual(['[entity=character]', ' Station'])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('renaming a train stop redraws its name', async ({ page }) => {
    const errors = await load(page)

    await setStation(page, 1, 'Iron [item=iron-plate] Pickup')
    expect(await runs(page, 1)).toEqual(['Iron ', 'icon:iron-plate', ' Pickup'])

    await setStation(page, 1, undefined)
    expect(await runs(page, 1)).toBeUndefined()
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('naming an unnamed train stop draws the name', async ({ page }) => {
    const errors = await load(page)

    await setStation(page, 2, 'Depot')
    expect(await runs(page, 2)).toEqual(['Depot'])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The train stop editor's preview draws its overlay with the same
    createEntityInfo, so it shows the name too - and has to rebuild when the
    name box renames the stop, or it keeps the old name until reopened. Typed
    into the real field and committed with Tab, the way a user renames it.
*/
test('the train stop editor preview follows a rename typed into it', async ({ page }) => {
    await suppressOverlays(page)
    const errors = await load(page)

    const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(2))
    if (!at) throw new Error('the unnamed train stop is not in the loaded blueprint')
    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')
    await page.mouse.down()
    await page.mouse.up()
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    expect(await page.evaluate(() => window.__fbe_test.previewStationNameRuns())).toBeUndefined()

    // The station box is the first TextInput element, and it starts empty.
    await page.evaluate(() => {
        const el = ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[]).find(
            i => i.style.cssText !== ''
        )
        if (!el) throw new Error('no TextInput element on the page')
        el.focus()
    })
    await page.keyboard.type('Depot [item=iron-plate]')
    await page.keyboard.press('Tab')

    expect(await runs(page, 2)).toEqual(['Depot ', 'icon:iron-plate'])
    expect(await page.evaluate(() => window.__fbe_test.previewStationNameRuns())).toEqual([
        'Depot ',
        'icon:iron-plate',
    ])
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
