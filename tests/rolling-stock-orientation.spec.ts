import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString,
    encodeBlueprint as encode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

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
