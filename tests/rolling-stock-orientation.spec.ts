import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString,
    encodeBlueprint as encode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'
import { suppressOverlays } from './helpers/overlays'

/*
    A blueprint gives rolling stock an `orientation` (0 north, 0.25 east, 0.5
    south, 0.75 west) and no `direction` (issue #520). The draw read only
    `direction`, so all 217 locomotives and wagons in the committed corpus drew
    facing north, and 186 of them face west.

    The synthetic blueprints in sprite-data.spec.ts cannot show it, because
    they give every entity a `direction` and none an `orientation`. So each
    entity here is placed twice: once the game's way, with an orientation, and
    once the editor's way, with the matching direction. The two have to draw
    the same, and each cardinal has to draw differently from north - except
    where a wagon's back equals its front.
*/

const ROLLING_STOCK = ['locomotive', 'artillery-wagon', 'cargo-wagon', 'fluid-wagon'] as const
const ORIENTATIONS = [0, 0.25, 0.5, 0.75] as const

const byOrientation = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: ROLLING_STOCK.flatMap((name, row) =>
        ORIENTATIONS.map((orientation, col) => ({
            entity_number: row * ORIENTATIONS.length + col + 1,
            name,
            position: { x: col * 8, y: row * 8 },
            orientation,
        }))
    ),
})

const byDirection = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: ROLLING_STOCK.flatMap((name, row) =>
        ORIENTATIONS.map((orientation, col) => ({
            entity_number: row * ORIENTATIONS.length + col + 1,
            name,
            position: { x: col * 8, y: row * 8 },
            ...(orientation === 0 ? {} : { direction: orientation * 16 }),
        }))
    ),
})

type Page = import('@playwright/test').Page

/** Digests per entity, in the order the entities were placed. */
async function digestsOf(page: Page, source: string): Promise<Record<string, string[]>> {
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.spriteDataTally())
}

test('rolling stock draws the way its orientation faces', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    const oriented = await digestsOf(page, byOrientation)
    const directed = await digestsOf(page, byDirection)

    for (const name of ROLLING_STOCK) {
        const [north, east, south, west] = oriented[name]
        expect(oriented[name], name).toHaveLength(4)
        expect(oriented[name], name).not.toContain('FAILED')
        expect(oriented[name], `${name}: orientation and direction agree`).toEqual(directed[name])

        expect(east, `${name} east`).not.toBe(north)
        expect(west, `${name} west`).not.toBe(north)
        if (name === 'cargo-wagon' || name === 'fluid-wagon') {
            // back_equals_front: 128 frames for half a turn.
            expect(south, `${name} south`).toBe(north)
            expect(west, `${name} west`).toBe(east)
        } else {
            expect(south, `${name} south`).not.toBe(north)
            expect(west, `${name} west`).not.toBe(east)
        }
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test('rolling stock keeps its orientation through an export', async ({ page }) => {
    await waitForEditor(page)
    await loadBlueprint(page, byOrientation)

    const exported = decodeBlueprintString(
        await page.evaluate(() => window.__fbe_test.encodeLoaded())
    )
    const entities = exported.blueprint.entities as {
        name: string
        orientation?: number
        direction?: number
    }[]

    expect(entities).toHaveLength(ROLLING_STOCK.length * ORIENTATIONS.length)
    for (const name of ROLLING_STOCK) {
        const own = entities.filter(e => e.name === name)
        expect(own.map(e => e.orientation ?? -1).sort((a, b) => a - b)).toEqual([...ORIENTATIONS])
        /*
            Not undefined: the Blueprint constructor writes `direction: 0` into
            every entity it loads, rolling stock included, and did before #520.
            What matters is that the heading did not move into it.
        */
        expect(own.map(e => e.direction ?? 0)).toEqual([0, 0, 0, 0])
    }
})

/*
    R on rolling stock turns `direction` by half a turn, since the editor lists
    it as a 4-way non-square entity. Once the draw read `orientation`, a train
    from a real blueprint ignored that: R changed nothing on screen, left an
    undo step that did nothing visible, and exported `direction: 8` beside the
    old orientation. So R turns `orientation` by the same amount, in the same
    undo step.

    A locomotive for the drawing, because a cargo wagon's back equals its front
    and draws the same frame at 0.25 and 0.75. The wagon is still here for the
    export.
*/
const WEST_TRAIN = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'locomotive', position: { x: 0, y: 0 }, orientation: 0.75 },
        { entity_number: 2, name: 'cargo-wagon', position: { x: 8, y: 0 }, orientation: 0.75 },
    ],
})

async function exportedOrientations(page: Page): Promise<(number | undefined)[]> {
    const exported = decodeBlueprintString(
        await page.evaluate(() => window.__fbe_test.encodeLoaded())
    )
    return (exported.blueprint.entities as { entity_number: number; orientation?: number }[])
        .sort((a, b) => a.entity_number - b.entity_number)
        .map(e => e.orientation)
}

test('R turns a loaded train and undo turns it back', async ({ page }) => {
    await suppressOverlays(page)
    await waitForEditor(page)
    await loadBlueprint(page, WEST_TRAIN)

    const westDigest = await page.evaluate(() => window.__fbe_test.spriteDataTally().locomotive)

    for (const n of [1, 2]) {
        const at = await page.evaluate(id => window.__fbe_test.entityScreenPosition(id), n)
        if (!at) throw new Error(`no entity ${n}`)
        await page.mouse.move(at.x, at.y)
        expect(await page.evaluate(() => window.__fbe_test.hoveredEntityNumber())).toBe(n)
        await page.keyboard.press('KeyR')
    }

    expect(await exportedOrientations(page)).toEqual([0.25, 0.25])
    const eastDigest = await page.evaluate(() => window.__fbe_test.spriteDataTally().locomotive)
    expect(eastDigest).not.toEqual(westDigest)

    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    expect(await exportedOrientations(page)).toEqual([0.75, 0.75])
    expect(await page.evaluate(() => window.__fbe_test.spriteDataTally().locomotive)).toEqual(
        westDigest
    )
})
