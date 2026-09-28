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
            /*
                An `[entity=]` tag is looked up in the entities alone, and the
                exported data carries no `character` entity (nor anything else
                by that name), so there is no icon to draw.
            */
            station: '[entity=character] Station',
        },
        {
            entity_number: 4,
            name: 'train-stop',
            position: { x: 31, y: 1 },
            direction: 0,
            station: '[entity=straight-rail] [recipe=pentapod-egg]',
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

/*
    Each tag type resolves in its own collection (`iconTagSource`), and these two
    tags are the names that tell a scoped lookup from a name-only one.
    `straight-rail` is an entity and no item, so a lookup that went to the items
    finds nothing and prints the tag raw. `pentapod-egg` is both a recipe and an
    item, with different icons - the recipe's is `pentapod-egg-3.png` - so a
    lookup that tried the items first still draws an icon, just the wrong one,
    and only the file it was drawn from shows it.
*/
test('an icon tag draws the icon of the prototype its type names', async ({ page }) => {
    const errors = await load(page)

    expect(await runs(page, 4)).toEqual(['icon:straight-rail', ' ', 'icon:pentapod-egg'])
    expect(await page.evaluate(() => window.__fbe_test.stationNameIconFiles(4))).toEqual([
        '__base__/graphics/icons/rail.png',
        '__space-age__/graphics/icons/pentapod-egg-3.png',
    ])
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

    /*
        The station box is the first TextInput element - the one with an inline
        style, which the settings pane's inputs lack - and it starts empty.

        TextInput appends it `display: none`, and only pixi's first render after
        the dialog opens shows it; focus() on a hidden element is a silent no-op,
        and the keys typed next would go to the canvas as keybinds. So wait for
        it to be shown rather than for a number of frames, the same race
        text-input.spec.ts's nextFrame waits out.
    */
    await page.waitForFunction(() => {
        const el = ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[]).find(
            i => i.style.cssText !== ''
        )
        return el !== undefined && el.style.display !== 'none'
    })
    await page.evaluate(() => {
        const el = ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[]).find(
            i => i.style.cssText !== ''
        )
        if (!el) throw new Error('no TextInput element on the page')
        el.focus()
        if (document.activeElement !== el) {
            throw new Error(
                `focusing the station box left ${document.activeElement?.tagName} focused ` +
                    `(display: ${el.style.display})`
            )
        }
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
