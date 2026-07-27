import { test, expect } from '@playwright/test'
import { encodeBlueprint, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Gates standing on a straight rail, which `draw_straight_rail` draws an extra
    rail-base sprite for - one per distinct gate offset, deduped.

    The corpus reaches this branch 24 times and every one of them produces a
    single offset, so the dedupe and the sort that feeds it have never actually
    run on more than one element. Measured: reversing that sort left every
    fixture in sprite-data.spec.ts green, because a one-element array sorts to
    itself whatever the comparator. This spec is the case that is not a
    singleton.

    Asserting on the layer count rather than a digest, because the count is what
    carries the meaning here: one extra layer per distinct gate offset on top of
    the five a bare rail draws.
*/

const VERSION = packVersion(2, 0, 55)

/** A straight rail at (1,1) with gates standing on it. */
const railWithGates = (gates: { x: number; y: number }[]): Record<string, unknown> => ({
    item: 'blueprint',
    version: VERSION,
    entities: [
        { entity_number: 1, name: 'straight-rail', position: { x: 1, y: 1 }, direction: 0 },
        ...gates.map((position, i) => ({
            entity_number: i + 2,
            name: 'gate',
            position,
            direction: 4,
        })),
    ],
})

async function railLayerCount(
    page: import('@playwright/test').Page,
    gates: { x: number; y: number }[]
): Promise<number> {
    const tally = await page.evaluate(
        async (src: string) => {
            const t = window.__fbe_test
            return t.spriteDataTally(await t.getBlueprintOrBookFromSource(src))
        },
        encodeBlueprint(railWithGates(gates))
    )

    const entries = tally['straight-rail']
    expect(entries, 'the rail should have generated sprite data').toHaveLength(1)
    // Digest is "<layer count>:<hash>".
    return Number(entries[0].split(':')[0])
}

test('a bare straight rail draws its five picture layers', async ({ page }) => {
    await waitForEditor(page)
    expect(await railLayerCount(page, [])).toBe(5)
})

test('a gate on the rail adds one rail-base layer', async ({ page }) => {
    await waitForEditor(page)
    expect(await railLayerCount(page, [{ x: 0.5, y: 0.5 }])).toBe(6)
})

test('three gates at two distinct offsets add two, not three', async ({ page }) => {
    await waitForEditor(page)

    /*
        Two of these share a rotated y offset, so the dedupe collapses them. This
        is the only place that dedupe is exercised at all - and the only place
        the sort feeding it sees more than one element.
    */
    const count = await railLayerCount(page, [
        { x: 0.5, y: 0.5 },
        { x: 1.5, y: 1.5 },
        { x: 0.5, y: 1.5 },
    ])

    expect(count).toBe(7)
})
