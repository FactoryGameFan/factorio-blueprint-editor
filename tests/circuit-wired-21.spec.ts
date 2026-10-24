import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Factorio 2.1 gave seven entity types a circuit connector they did not have
    in 2.0: boilers (and heat exchangers, which share the type), heat pipes,
    labs, land mines, pipes, infinity pipes and pipes-to-ground (#601). Before
    the editor read them, a wire to any of these fell to getCircuitConnector's
    default arm and was dropped on load, with a "Skipped" warning.

    tests/wire-switch-completeness.test.ts asks the switch about every
    prototype. This asks the editor about a blueprint as a 2.1 export writes
    one: every wire reaches the screen and the export, and nothing is skipped.
    The pipes are a run of three, so the wired ones sit at two different
    neighbour combinations (pipeConnectionIndex 10 and 8).
*/

const VERSION = packVersion(2, 1, 23)

const ENTITIES = [
    { entity_number: 1, name: 'substation', position: { x: 1, y: 1 } },
    { entity_number: 2, name: 'lab', position: { x: 5.5, y: 1.5 } },
    { entity_number: 3, name: 'land-mine', position: { x: 1.5, y: 4.5 } },
    { entity_number: 4, name: 'boiler', position: { x: 5.5, y: 5 } },
    { entity_number: 5, name: 'pipe-to-ground', position: { x: 1.5, y: 7.5 } },
    { entity_number: 6, name: 'pipe', position: { x: 2.5, y: 9.5 } },
    { entity_number: 7, name: 'pipe', position: { x: 3.5, y: 9.5 } },
    { entity_number: 8, name: 'pipe', position: { x: 4.5, y: 9.5 } },
    { entity_number: 9, name: 'heat-pipe', position: { x: 6.5, y: 8.5 } },
]

/** A red wire from the substation to each 2.1 circuit entity but the first and last pipe. */
const WIRES = [2, 3, 4, 5, 7, 8, 9].map(n => [1, 1, n, 1])

test('wires to the entities 2.1 gave circuit connectors are kept', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await waitForEditor(page)

    const source = encodeBlueprint({
        item: 'blueprint',
        version: VERSION,
        entities: ENTITIES,
        wires: WIRES,
    })
    const result = await page.evaluate(async src => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        return {
            containers: t.entityContainerCount(),
            wires: t.wireCount(),
            encoded: await t.encodeLoaded(),
        }
    }, source)

    expect(result.containers).toBe(ENTITIES.length)
    expect(result.wires).toBe(WIRES.length)
    const exported = decodeBlueprintString(result.encoded).blueprint
    expect(exported.wires).toHaveLength(WIRES.length)
    await expect(page.locator('.toasts-text', { hasText: 'Skipped' })).toHaveCount(0)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
