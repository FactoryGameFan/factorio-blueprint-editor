import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    GHSA-2662-38w8-mv2c. A pre-2.0 blueprint gives each entity's modules as an
    `items` object of name -> count. The migration in Blueprint.ts turns that
    into the 2.0 `in_inventory` shape by looping `count` times and adding one
    position per pass. `count` was attacker-controlled and unbounded: the schema
    types it as an integer with no maximum and a schema failure is only a
    warning, so a `?source=` link could set it to a billion and drive the loop
    at load time with no interaction. Measured, ~100,000,000 crashed the tab's
    renderer and lower counts froze it for seconds.

    The fix caps the total placed at the entity's module-slot count, keeping the
    first ones in order and dropping the rest - which is exactly what the game
    does on import (measured on Factorio 2.0.77 via tools/oracle: importing a 1.1
    assembling-machine-2 with 3, 5 or 100 speed-module-3 always keeps 2, its slot
    count). assembling-machine-2 has 2 module slots.

    The corpus cannot cover this - every committed blueprint is 2.0.32+ and
    already in the `in_inventory` shape - so the string is synthetic.
*/

const PRE_2_0 = version(1, 1, 0)
const SLOTS = 2 // assembling-machine-2

/** A pre-2.0 assembler holding `count` speed-module-3 in the old items object. */
const withModuleCount = (count: number): string =>
    encode({
        item: 'blueprint',
        version: PRE_2_0,
        icons: [{ index: 1, signal: { type: 'item', name: 'assembling-machine-2' } }],
        entities: [
            {
                entity_number: 1,
                name: 'assembling-machine-2',
                position: { x: 0.5, y: 0.5 },
                items: { 'speed-module-3': count },
            },
        ],
    })

test('a pre-2.0 module count at the slot count loads and places them all (control)', async ({
    page,
}) => {
    await waitForEditor(page)
    await loadBlueprint(page, withModuleCount(SLOTS))
    const modules = await page.evaluate(() => window.__fbe_test.entityModules(1))
    expect(modules.filter(Boolean)).toEqual(['speed-module-3', 'speed-module-3'])
})

test('a billion-module pre-2.0 count loads without hanging and places no more than the slots', async ({
    page,
}) => {
    await waitForEditor(page)
    // Before the fix this drove a billion-iteration loop at load: the tab either
    // froze past the test timeout or the migration threw mid-allocation and the
    // page recovered to an empty blueprint with no entity 1 - both fail here.
    await loadBlueprint(page, withModuleCount(1_000_000_000))
    const modules = await page.evaluate(() => window.__fbe_test.entityModules(1))
    expect(modules.filter(Boolean).length).toBe(SLOTS)
    expect(modules.filter(Boolean)).toEqual(['speed-module-3', 'speed-module-3'])
})
