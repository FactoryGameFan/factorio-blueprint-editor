import { test, expect } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    EntityContainer.mappings is a static Map<entityNumber, EntityContainer>.
    Entries are written in the constructor and, before issue #42, removed in
    exactly one place: the entity's own `destroy` handler. Loading a different
    blueprint never destroys the previous blueprint's entities - Editor.loadBlueprint
    builds the new BlueprintContainer and calls initBP() before destroying the old
    one - so every container above the new blueprint's highest entity number stayed
    in the map, holding its Entity, its EntitySprites, its VisualizationArea and its
    info overlay for the life of the tab.

    Measured rather than asserted loosely, because the retention is bounded by the
    largest blueprint seen rather than unbounded, so a "does it grow" test would
    pass while leaking. Big-then-small is the shape that shows it: after loading
    the small one the map should hold the small one's containers and nothing else.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

/*
    A large and a small blueprint. Both files are books, and loadBp renders only
    a book's first blueprint, so these are the counts of entry 0 - which is why
    the big one is 243 rather than the 1636 issue #42 quotes for the whole book.
*/
const BIG = 'EARN/quick-start-v22-0-11'
const SMALL = 'AVADII/Alpha Cygni Blueprints 1.3'

interface Loaded {
    entities: number
    mappings: number
}

test('the container index holds only the loaded blueprint after a swap', async ({ page }) => {
    const files = discoverBlueprintFiles()
    const find = (name: string): string => {
        const file = files.find(f => f.name === name)
        if (!file) throw new Error(`test blueprint ${name} not found in wormeyman-tests/`)
        return readBlueprintString(file.filePath)
    }

    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const [big, small]: Loaded[] = await page.evaluate(
        async (sources: string[]) => {
            const api = (window as any).__fbe_test
            const out = []
            for (const src of sources) {
                let bp = await api.getBlueprintOrBookFromSource(src)
                // loadBp renders only a book's first blueprint, so select it here and
                // hand over the blueprint itself - the counts have to agree on which.
                if (bp.selectBlueprint) bp = bp.selectBlueprint(0)
                await api.loadBp(bp)
                out.push({ entities: bp.entities.size, mappings: api.entityContainerCount() })
            }
            return out
        },
        [find(BIG), find(SMALL)]
    )

    // The corpus fixed points these rest on: if either blueprint changed size the
    // test could pass while measuring nothing.
    expect(big.entities).toBe(243)
    expect(small.entities).toBe(2)

    // Loading the first blueprint into an empty editor was never in question.
    expect(big.mappings).toBe(big.entities)

    // The leak: this was 243 - every container of the big blueprint retained,
    // 241 of them belonging to a blueprint no longer on screen.
    expect(small.mappings).toBe(small.entities)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
