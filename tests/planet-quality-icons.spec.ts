import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'
import { openBlueprintInfo } from './helpers/blueprint-info-dialog'
import { settle } from './helpers/dialog-scroll'
import { recordToasts, toastsSoFar } from './helpers/toast-log'

/*
    Planet, space-location and quality icons (#652).

    `F.CreateIcon` used to throw for all of these, because data.json carried no
    planet or quality prototype, and `F.SafeIcon` turned the throw into a warning
    toast and a blank slot. They now come from `FD.spaceLocations` and
    `FD.qualities`. A drawn icon leaves no trace in the DOM, because it is a
    pixi sprite on a canvas, so what these tests can see is the absence of the
    old symptoms: no warning or error toast, and no page error. That is a
    weaker claim than "the right picture is on screen". The other half is the
    data itself, which the first test reads straight from the dev server so
    that a regenerated data.json that drops the collections fails here and not
    only as a missing warning.

    The toasts are read from a recording started before the dialog opens, never
    from a locator that waits. A warning toast closes itself after about five
    seconds and `toHaveCount(0)` retries for up to sixty, so it would pass
    whether or not the toast ever appeared. The recording is checked after two
    animation frames, which is when a dialog's icons have been built.

    The names are the ones the "Factorio Handbook" book from #651 failed on, plus
    `aquilo` and `normal` for the two ends of each list.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up. The names that must still warn, because
    nothing carries them, live in tests/editor-icon-guards.spec.ts and
    tests/dialog-registry-leak.spec.ts.
*/

const VERSION = version(2, 0, 55)

const PLANETS = ['nauvis', 'vulcanus', 'fulgora', 'gleba', 'aquilo'] as const
const OTHER_LOCATIONS = ['solar-system-edge', 'shattered-planet'] as const
const QUALITIES = ['normal', 'uncommon', 'rare', 'epic', 'legendary'] as const

test.beforeEach(async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
})

test('data.json carries every planet, space location and quality with an icon (#652)', async ({
    page,
}) => {
    // Through Vite's `/data` proxy, which is how the editor itself loads it.
    const data = await page.evaluate(async () => {
        const response = await fetch('/data/data.json')
        return (await response.json()) as Record<
            string,
            Record<string, { type: string; icon?: string; icons?: unknown }>
        >
    })

    for (const name of [...PLANETS, ...OTHER_LOCATIONS]) {
        const proto = data.spaceLocations[name]
        expect(proto, `spaceLocations.${name}`).toBeDefined()
        expect(proto.icon ?? proto.icons, `spaceLocations.${name} has no icon`).toBeTruthy()
    }
    for (const name of PLANETS) expect(data.spaceLocations[name].type).toBe('planet')
    for (const name of OTHER_LOCATIONS) {
        expect(data.spaceLocations[name].type).toBe('space-location')
    }
    for (const name of QUALITIES) {
        const proto = data.qualities[name]
        expect(proto, `qualities.${name}`).toBeDefined()
        expect(proto.icon ?? proto.icons, `qualities.${name} has no icon`).toBeTruthy()
    }

    // The lookup in `CreateIcon` goes by name alone, which is only safe while
    // nothing else is called the same. Every other collection a name could
    // answer from is checked here, so a future item that reuses `rare` or
    // `normal` fails this test rather than silently changing an icon.
    for (const name of [...PLANETS, ...OTHER_LOCATIONS, ...QUALITIES]) {
        for (const collection of ['items', 'fluids', 'recipes', 'signals', 'entities']) {
            expect(
                data[collection][name],
                `${name} is also in ${collection}, so CreateIcon's name-only lookup is ambiguous`
            ).toBeUndefined()
        }
    }
})

test('planet and quality icons in a blueprint draw without a warning (#652)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    // The blueprint's own four icon slots, which `BlueprintInfoEditor` draws
    // through `SafeIcon`, so a failed lookup would raise a toast naming it.
    const icons = [
        { index: 1, signal: { type: 'space-location', name: 'vulcanus' } },
        { index: 2, signal: { type: 'space-location', name: 'nauvis' } },
        { index: 3, signal: { type: 'space-location', name: 'aquilo' } },
        { index: 4, signal: { type: 'quality', name: 'legendary' } },
    ]
    await loadBlueprint(page, encode({ item: 'blueprint', version: VERSION, icons }))

    await recordToasts(page)
    await openBlueprintInfo(page)
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    await settle(page)

    expect(await toastsSoFar(page)).toEqual([])
    expect(errors).toEqual([])
})

test('a display panel with a planet row and a quality condition opens with no warning (#652)', async ({
    page,
}) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    // `connect_to_logistic_network` puts the editor down its read-only
    // conditions branch, where each row draws its own icon and both ends of its
    // condition. Same trick as tests/dialog-registry-leak.spec.ts.
    const source = encode({
        item: 'blueprint',
        version: VERSION,
        icons: [{ index: 1, signal: { type: 'item', name: 'display-panel' } }],
        entities: [
            {
                entity_number: 1,
                name: 'display-panel',
                position: { x: 0.5, y: 0.5 },
                control_behavior: {
                    connect_to_logistic_network: true,
                    parameters: [
                        {
                            icon: { type: 'space-location', name: 'fulgora' },
                            text: 'home',
                            condition: {
                                first_signal: { type: 'space-location', name: 'gleba' },
                                comparator: '=',
                                second_signal: { type: 'quality', name: 'rare' },
                            },
                        },
                    ],
                },
            },
        ],
    })
    await loadBlueprint(page, source)
    await recordToasts(page)

    const at = await page.evaluate(() => window.__fbe_test.entityScreenPosition(1))
    if (!at) throw new Error('no entity 1 in the loaded blueprint')
    // Step away first: hovering only fires when the pointer crosses a tile.
    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.up()

    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
    await settle(page)

    expect(await toastsSoFar(page)).toEqual([])
    expect(errors).toEqual([])
})
