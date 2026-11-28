import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    decodeBlueprintString,
    packVersion as version,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { recordToasts, toastsSoFar } from './helpers/toast-log'

/*
    G opens the blueprint in the oil field planner (FactorioTools) instead of
    running FBE's own generator, which was removed (GHSA-9w8p-4q25-qv54). The
    planner is never really reached: the route below answers for it, so the
    spec needs no network and checks only what FBE hands over.
*/

const PLANNER = 'https://oilfieldplanner.factorygamefan.com/oil-field'

const blueprintOf = (entities: { name: string; x: number; y: number }[]): string =>
    encode({
        item: 'blueprint',
        version: version(2, 0, 77),
        icons: [{ index: 1, signal: { type: 'item', name: 'pumpjack' } }],
        entities: entities.map((e, i) => ({
            entity_number: i + 1,
            name: e.name,
            position: { x: e.x, y: e.y },
        })),
    })

test.beforeEach(async ({ context }) => {
    await context.route(`${PLANNER}**`, route =>
        route.fulfill({ contentType: 'text/html', body: '<title>planner stand-in</title>' })
    )
})

test('G opens the planner with the blueprint in #source= and no opener', async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(
        page,
        blueprintOf([
            { name: 'pumpjack', x: 1.5, y: 1.5 },
            { name: 'pumpjack', x: 10.5, y: 1.5 },
        ])
    )

    const popupPromise = page.waitForEvent('popup')
    await page.keyboard.press('KeyG')
    const popup = await popupPromise
    await popup.waitForURL(`${PLANNER}#source=*`)

    // In the fragment, so the planner's server never sees it.
    const url = new URL(popup.url())
    expect(url.search).toBe('')
    const source = new URLSearchParams(url.hash.slice(1)).get('source')
    expect(source).not.toBeNull()
    const sent: { name: string; position: { x: number; y: number } }[] = decodeBlueprintString(
        source as string
    ).blueprint.entities
    // Loading re-centres the blueprint, so compare the gap, not the positions.
    expect(sent.map(e => e.name)).toEqual(['pumpjack', 'pumpjack'])
    expect({
        dx: sent[1].position.x - sent[0].position.x,
        dy: sent[1].position.y - sent[0].position.y,
    }).toEqual({ dx: 9, dy: 0 })
    // the planner page gets no handle on the editor's tab
    expect(await popup.evaluate(() => window.opener)).toBeNull()
})

test('G with no pumpjacks warns and opens nothing', async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(page, blueprintOf([{ name: 'wooden-chest', x: 0.5, y: 0.5 }]))
    await recordToasts(page)

    let popups = 0
    page.on('popup', () => popups++)
    await page.keyboard.press('KeyG')

    await expect
        .poll(() => toastsSoFar(page))
        .toEqual(['toasts-warning | Place pumpjacks first: G opens them in the oil field planner.'])
    expect(popups).toBe(0)
})
