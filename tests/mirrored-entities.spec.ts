import { test, expect, Page } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    A blueprint entity carrying `mirror: true` (#612). Nothing read it, so all
    1,363 mirrored entities in the committed corpus drew as if unmirrored.

    Two things change for a mirrored entity, and this pins both.

    The first is which sheets it draws. In 2.1.23 the recycler, burner mining
    drill and pumpjack carry a `graphics_set_flipped`, and a mirrored one draws
    from it - every sheet in it has "flipped" in its name. A prototype with none
    draws its plain graphics either way, so a mirrored chemical plant or electric
    mining drill draws exactly the sheets an unmirrored one does.

    The second is where its fluid connections are. `tools/oracle/probe-mirroring.mjs`
    measured that a mirrored connection is the plain one reflected across the
    axis the entity faces. A pumpjack facing north has its output at (1, -1),
    reaching the tile at (1, -2); mirrored, it is at (-1, -1), reaching (-1, -2).
    A pipe on the reached tile is drawn joined to the pumpjack, and one beside
    it is not, so the pipe's sheets show which side the editor put it on.
*/

const FACINGS = [0, 4, 8, 12] as const

type Placed = { name: string; x: number; y: number; direction?: number; mirror?: boolean }

function blueprint(entities: Placed[]): string {
    return encode({
        item: 'blueprint',
        version: version(2, 1, 23),
        entities: entities.map(({ x, y, ...e }, i) => ({
            entity_number: i + 1,
            position: { x, y },
            ...e,
        })),
    })
}

async function layerFiles(page: Page, entityNumber: number): Promise<string[]> {
    const files = await page.evaluate(
        n => window.__fbe_test.spriteLayerFiles(n, { withGrid: true }),
        entityNumber
    )
    expect(files, `entity ${entityNumber} failed to generate`).not.toBe('FAILED')
    return files as string[]
}

const base = (file: string) => file.split('/').pop() ?? file

test('a mirrored entity draws its flipped graphics where it has them', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    for (const name of ['recycler', 'burner-mining-drill', 'pumpjack']) {
        await loadBlueprint(
            page,
            blueprint(
                FACINGS.flatMap((direction, i) => [
                    { name, x: i * 10 + 0.5, y: 0.5, direction },
                    { name, x: i * 10 + 0.5, y: 10.5, direction, mirror: true },
                ])
            )
        )
        for (const [i, direction] of FACINGS.entries()) {
            const plain = (await layerFiles(page, 2 * i + 1)).map(base)
            const mirrored = (await layerFiles(page, 2 * i + 2)).map(base)
            expect(
                plain.filter(f => f.includes('flipped')),
                `${name} facing ${direction}, unmirrored`
            ).toEqual([])
            expect(
                mirrored.filter(f => f.includes('flipped')).length,
                `${name} facing ${direction}, mirrored: ${mirrored.join(' ')}`
            ).toBeGreaterThan(0)
            expect(mirrored.length, `${name} facing ${direction}: same layer count`).toBe(
                plain.length
            )
        }
    }

    // The control: no graphics_set_flipped, so mirroring leaves the sheets alone.
    for (const name of ['electric-mining-drill', 'chemical-plant']) {
        await loadBlueprint(
            page,
            blueprint([
                { name, x: 0.5, y: 0.5 },
                { name, x: 10.5, y: 0.5, mirror: true },
            ])
        )
        expect(await layerFiles(page, 2), name).toEqual(await layerFiles(page, 1))
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

test("a mirrored pumpjack's output joins the pipe on the other side", async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await waitForEditor(page)

    /** The pipe's sheets with the pumpjack's output reaching `pipeX`, or not. */
    async function pipeFiles(mirror: boolean, pipeX: number): Promise<string[]> {
        await loadBlueprint(
            page,
            blueprint([
                { name: 'pumpjack', x: 0.5, y: 0.5, mirror },
                { name: 'pipe', x: pipeX + 0.5, y: -1.5 },
            ])
        )
        return (await layerFiles(page, 2)).map(base)
    }

    const right = { plain: await pipeFiles(false, 1), mirrored: await pipeFiles(true, 1) }
    const left = { plain: await pipeFiles(false, -1), mirrored: await pipeFiles(true, -1) }

    // Joined on the right unmirrored and on the left mirrored, and the joined
    // pipe draws differently from the lone one.
    expect(left.mirrored).toEqual(right.plain)
    expect(right.mirrored).toEqual(left.plain)
    expect(right.plain).not.toEqual(left.plain)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
