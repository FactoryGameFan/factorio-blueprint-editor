import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    What the info panel says about an inserter (issue #96).

    The maths itself is unit tested in
    `packages/editor/src/core/throughput.test.ts` - pure numbers, no FD, no
    browser. What that cannot cover is the part this fixes: the panel used to
    look only at what the inserter drops *into*, so one picking items off a belt
    was reported at the container-to-container rate. The source-side lookup was
    written out in the file and commented out.

    So this asserts the panel's own line for three arrangements that produce
    three different numbers, which is the only way to see that both ends are
    being read and that they are not the wrong way round.

    Which end is which comes from the prototypes: every inserter declares
    `pickup_position` at a negative offset and `insert_position` at a positive
    one ({0, -1} and {0, 1.2}; long-handed is {0, -2} and {0, 2.2}). The
    blueprints below are built to match, and a swapped mapping fails the two
    belt cases against each other rather than passing both.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/*
    A bulk inserter: rotation_speed 0.04, so 2.4 swings/s, and inserterStackSize
    12. That is 28.8 items/s unobstructed, well above a yellow belt's 15 - which
    is what makes the belt cases distinguishable from the container one at all.
    A plain inserter would be swing-limited everywhere and every case would agree.
*/
const INSERTER = 'bulk-inserter'

/*
    Every inserter below is left unrotated - direction 0, which is what omitting
    the field means - so its `pickup_position` and `insert_position` apply as
    written: pickup at -y, the tile *above* it on screen, and drop at +y, the
    tile below.

    Worth stating because the first draft of this spec assumed the opposite and
    got the two belt cases back swapped. That was the spec being wrong, not the
    panel: direction 8 is a 180 degree rotation, which puts the drop side above
    and the pickup below, and the numbers said so immediately. Each group is
    spaced well apart so no group's belt is read by another's inserter.
*/

const BLUEPRINT = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: INSERTER } }],
    entities: [
        // 1: chest -> chest. No belt at either end.
        { entity_number: 1, name: 'steel-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: INSERTER, position: { x: 0.5, y: 1.5 } },
        { entity_number: 3, name: 'steel-chest', position: { x: 0.5, y: 2.5 } },

        // 4: belt -> chest, the case that was reported at the container rate.
        // The belt is above, which is the pickup side.
        { entity_number: 4, name: 'transport-belt', position: { x: 6.5, y: 0.5 } },
        { entity_number: 5, name: INSERTER, position: { x: 6.5, y: 1.5 } },
        { entity_number: 6, name: 'steel-chest', position: { x: 6.5, y: 2.5 } },

        // 7: chest -> belt, the case the panel always handled. The belt is
        // below, which is the drop side.
        { entity_number: 7, name: 'steel-chest', position: { x: 12.5, y: 0.5 } },
        { entity_number: 8, name: INSERTER, position: { x: 12.5, y: 1.5 } },
        { entity_number: 9, name: 'transport-belt', position: { x: 12.5, y: 2.5 } },
    ],
})

async function loadInserters(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, BLUEPRINT)
}

/** The items/s the panel reports for an entity, parsed out of its speed line. */
async function reportedSpeed(page: Page, entityNumber: number): Promise<number> {
    const text = await page.evaluate(
        (n: number) => window.__fbe_test.entityInfoText(n),
        entityNumber
    )
    const match = /Speed: ([\d.]+) items\/s/.exec(text)
    if (!match) throw new Error(`no speed line for entity ${entityNumber}, panel said: ${text}`)
    return Number(match[1])
}

test('an inserter between two containers reports its plain swing rate', async ({ page }) => {
    await loadInserters(page)

    // 0.04 * 60 * 12. The control: neither end is a belt, so nothing caps it.
    expect(await reportedSpeed(page, 2)).toBeCloseTo(28.8, 2)
})

test('an inserter picking off a belt is capped by the belt (issue #96)', async ({ page }) => {
    /*
        The bug. A yellow belt carries 15 items/s and cannot be emptied faster
        than it fills, so a bulk inserter that would otherwise move 28.8 is held
        to 15. Before the fix the panel read only the destination - a chest -
        and reported 28.8, nearly twice the achievable rate.
    */
    await loadInserters(page)

    expect(await reportedSpeed(page, 5)).toBeCloseTo(15, 2)
})

test('an inserter unloading onto a belt still reports the placing rate', async ({ page }) => {
    /*
        The branch that already worked, kept honest: it must not have been
        broken by teaching the panel about the other end, and it must stay
        distinct from both cases above. containerToBelt charges belt-arrival
        time per item past the first 1.75, which lands well below either.
    */
    await loadInserters(page)

    const speed = await reportedSpeed(page, 8)
    expect(speed).toBeGreaterThan(6)
    expect(speed).toBeLessThan(7)
})

test('the three arrangements do not report the same number', async ({ page }) => {
    /*
        The backstop. Each test above pins one value, but a mapping that read the
        same end twice could still satisfy two of them by coincidence; three
        distinct answers cannot come from reading one end.
    */
    await loadInserters(page)

    const [containers, offBelt, ontoBelt] = [
        await reportedSpeed(page, 2),
        await reportedSpeed(page, 5),
        await reportedSpeed(page, 8),
    ]

    expect(new Set([containers, offBelt, ontoBelt]).size).toBe(3)
})
