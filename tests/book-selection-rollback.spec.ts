import { test, expect } from '@playwright/test'
import { decodeBlueprintString, encodeBlueprintBook, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Switching to a book page that cannot be opened must leave the book on the
    page that is on screen.

    A page can fail in two places. Its own data can make the Blueprint
    constructor throw - a wire whose two ends are different colours - and a page
    that builds can still fail to draw, like the copper wire in
    load-rollback.spec.ts. Each left the book wrong in its own way, and each is a
    test below. What is checked is the book Ctrl+C exports: it must be exactly
    what it was before the switch, and the page on screen must still be the one
    that takes edits.
*/

const VERSION = packVersion(2, 0, 55)

const chest = (entity_number: number, x: number) => ({
    entity_number,
    name: 'wooden-chest',
    position: { x, y: 0.5 },
})

const BOOK = {
    item: 'blueprint-book',
    version: VERSION,
    active_index: 0,
    label: 'book',
    blueprints: [
        {
            index: 0,
            blueprint: {
                item: 'blueprint',
                version: VERSION,
                label: 'on screen',
                entities: [chest(1, 0.5), chest(2, 8.5)],
            },
        },
        {
            /*
                Builds, then throws in initBP: connector 5 is copper and a
                wooden chest has no copper connection point, so getWireSprite
                finds none.

                This used to be a wire to an entity 2 that did not exist. #457
                drops a dangling endpoint on decode, so that page now draws and
                cannot fail here - the same move load-rollback.spec.ts made, and
                for the same reason. Both endpoints exist here, so the drop
                leaves this wire alone. Issue #488 tracks the hazard.
            */
            index: 1,
            blueprint: {
                item: 'blueprint',
                version: VERSION,
                label: 'cannot draw',
                entities: [chest(1, 0.5), chest(2, 8.5)],
                wires: [[1, 5, 2, 5]],
            },
        },
        {
            // Throws in the constructor: connector 1 is red, connector 2 green.
            index: 2,
            blueprint: {
                item: 'blueprint',
                version: VERSION,
                label: 'cannot build',
                entities: [chest(1, 0.5), chest(2, 8.5)],
                wires: [[1, 1, 2, 2]],
            },
        },
        {
            index: 3,
            blueprint: {
                item: 'blueprint',
                version: VERSION,
                label: 'fine',
                entities: [chest(1, 0.5)],
            },
        },
    ],
}

async function loadBook(page: import('@playwright/test').Page): Promise<void> {
    await waitForEditor(page)
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, encodeBlueprintBook(BOOK))
}

async function exported(page: import('@playwright/test').Page) {
    return decodeBlueprintString(await page.evaluate(() => window.__fbe_test.encodeLoaded()))
        .blueprint_book
}

async function selectFails(page: import('@playwright/test').Page, index: number) {
    return page.evaluate(async i => {
        try {
            await window.__fbe_test.selectBookIndex(i)
            return 'selected'
        } catch (e) {
            return e instanceof Error ? e.message : String(e)
        }
    }, index)
}

for (const { index, thrown } of [
    { index: 1, thrown: 'Could not find the wire connection point!' },
    { index: 2, thrown: 'Wire color mismatch!' },
]) {
    const label = BOOK.blueprints[index].blueprint.label

    test(`a page that fails ("${label}") leaves the book on the page on screen`, async ({
        page,
    }) => {
        const errors: string[] = []
        page.on('pageerror', e => errors.push(String(e)))
        await loadBook(page)
        const before = await exported(page)
        // The export carries the failing page's wire to begin with.
        expect(before.blueprints[index].blueprint.wires).toEqual(
            BOOK.blueprints[index].blueprint.wires
        )

        // The error first, so a switch that silently succeeded cannot pass.
        expect(await selectFails(page, index)).toContain(thrown)

        expect(await exported(page)).toEqual(before)

        // Edits still land on the page on screen, and reach the export.
        await page.evaluate(() => window.__fbe_test.createEntity('wooden-chest', 0.5, 6.5))
        const edited = await exported(page)
        expect(edited.active_index).toBe(0)
        expect(edited.blueprints[0].blueprint.entities).toHaveLength(3)
        expect(edited.blueprints[index]).toEqual(before.blueprints[index])

        // And the book still switches: the edit is kept when the page is left.
        expect(await selectFails(page, 3)).toBe('selected')
        const moved = await exported(page)
        expect(moved.active_index).toBe(3)
        expect(moved.blueprints[0].blueprint.entities).toHaveLength(3)

        expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    })
}
