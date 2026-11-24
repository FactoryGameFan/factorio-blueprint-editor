import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Blueprints older than 1.1.11 did not store the copper wires between power
    poles, so `Blueprint.ts` generates them on load: when `data.version <
    getFactorioVersion(1, 1, 11)` it calls `generatePowerPoleWires()` (issue #646).

    Under the old packing in factorioVersion.ts, that cutoff really sat at
    1.1.9.65535, so a blueprint stamped 1.1.10.x was treated as 1.1.11 or newer
    and got no wires. #642 fixed the packing and moved the boundary. No committed
    blueprint declares a 1.1.10 version, so nothing noticed either move.

    The cases sit right on the edge: 1.1.10.65535 is the highest version below
    the cutoff and 1.1.11.0 is the cutoff itself. The two 1.1.10 cases are the
    ones the old packing broke; both got no wires there. 1.1.9.0 and the 1.1.11
    and later cases are controls that passed on the old packing too. They guard
    the other direction: well below the cutoff still generates, and at or above
    it still does not.

    The assertion is `wireCount`, the length of the `wires` array the loaded
    blueprint would serialize. It does not depend on rendering.
*/

/** Three small poles in a row, 3 tiles apart, with no `wires` stored. */
const poleRow = (declared: number): string =>
    encode({
        item: 'blueprint',
        version: declared,
        icons: [{ index: 1, signal: { type: 'item', name: 'small-electric-pole' } }],
        entities: [
            { entity_number: 1, name: 'small-electric-pole', position: { x: 0.5, y: 0.5 } },
            { entity_number: 2, name: 'small-electric-pole', position: { x: 3.5, y: 0.5 } },
            { entity_number: 3, name: 'small-electric-pole', position: { x: 6.5, y: 0.5 } },
        ],
    })

test.beforeEach(async ({ page }) => {
    await waitForEditor(page)
})

async function wiresAfterLoading(page: import('@playwright/test').Page, source: string) {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    const result = await page.evaluate(async src => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
        return { wireCount: t.wireCount(), containers: t.entityContainerCount() }
    }, source)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(result.containers).toBe(3)
    return result.wireCount
}

const generated: [string, number][] = [
    ['1.1.10.65535, the highest version below the cutoff', version(1, 1, 10, 65535)],
    ['1.1.10.0', version(1, 1, 10)],
    ['1.1.9.0', version(1, 1, 9)],
]

const notGenerated: [string, number][] = [
    ['1.1.11.0, the cutoff itself', version(1, 1, 11)],
    ['1.1.11.1', version(1, 1, 11, 1)],
    ['1.1.110.0', version(1, 1, 110)],
]

for (const [label, declared] of generated) {
    test(`power pole wires are generated for ${label}`, async ({ page }) => {
        /*
            All three poles are in reach of each other, the outer pair at 6
            tiles too. It is 2, not 3, because the poles are collinear, and
            `pointsToTriangles` in generators/util.ts joins collinear points
            only to their neighbours. If wire generation changes and this
            number moves, that rule is the place to look, not the version.
        */
        expect(await wiresAfterLoading(page, poleRow(declared))).toBe(2)
    })
}

for (const [label, declared] of notGenerated) {
    test(`no power pole wires are generated for ${label}`, async ({ page }) => {
        expect(await wiresAfterLoading(page, poleRow(declared))).toBe(0)
    })
}
