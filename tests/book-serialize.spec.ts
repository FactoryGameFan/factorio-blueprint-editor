import { test, expect } from '@playwright/test'
import { encodeBlueprintBook, decodeBlueprintString, packVersion } from './helpers/encode-blueprint'
import { waitForEditor } from './helpers/fbe-test-api'

/*
    Book's index arithmetic, which four specs walk through and none of them
    assert on.

    A book addresses its blueprints by a *flattened* index - nested books
    contribute their contents to the count rather than themselves - while the
    `active_index` it serializes is a *top-level* entry index, with each nested
    book carrying its own. Book.ts converts between the two in three places, and
    only one of them is observable through the editor: `selectBlueprint` hands
    back a Blueprint, so entity-accessors, sprite-data, round-trip and
    entity-container-mappings would all notice it resolving to the wrong one.

    Nothing notices the other two. `saveBlueprint`'s answer becomes the
    `active_index` on the serialized book and on every nested book it passed
    through, and that value is written by `Book.serialize()` - a method the
    round-trip spec never calls, because it serializes the selected Blueprint and
    not the book around it. So both could be wrong, or absent, with the whole
    suite green: nothing about which entities come back depends on active_index.

    The corpus cannot stand in for this either. Its books are real exports whose
    nesting this spec did not choose, so there is no index it can name and say
    which blueprint should answer to it.
*/

const VERSION = packVersion(2, 0, 55)

/** A one-entity blueprint, identifiable by its label. */
const blueprint = (label: string): Record<string, unknown> => ({
    item: 'blueprint',
    version: VERSION,
    label,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

/*
    Flattened index -> label:

      entry 0  blueprint A            0
      entry 1  book                     entry 0  blueprint B    1
                                        entry 1  blueprint C    2
      entry 2  blueprint D            3

    Four blueprints across three top-level entries is the smallest shape where a
    flattened index differs from the top-level one in both directions, so an
    off-by-one in either conversion lands on the wrong blueprint.
*/
const BOOK = {
    item: 'blueprint-book',
    version: VERSION,
    active_index: 0,
    label: 'outer',
    blueprints: [
        { index: 0, blueprint: blueprint('A') },
        {
            index: 1,
            blueprint_book: {
                item: 'blueprint-book',
                version: VERSION,
                active_index: 0,
                label: 'inner',
                blueprints: [
                    { index: 0, blueprint: blueprint('B') },
                    { index: 1, blueprint: blueprint('C') },
                ],
            },
        },
        { index: 2, blueprint: blueprint('D') },
    ],
}

async function loadBook(page: import('@playwright/test').Page): Promise<void> {
    await waitForEditor(page)
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, encodeBlueprintBook(BOOK))
}

test('a flattened index reaches the blueprint at that position', async ({ page }) => {
    await loadBook(page)

    const labels = await page.evaluate(async () => {
        const t = window.__fbe_test
        const book = await t.getBlueprintOrBookFromSource(await t.encodeLoaded())
        const out: (string | undefined)[] = []
        for (let i = 0; i <= 3; i++) {
            out.push((book.selectBlueprint(i) as { name?: string }).name)
        }
        return out
    })

    expect(labels).toEqual(['A', 'B', 'C', 'D'])
})

test('the book reports its last flattened index, counting nested entries', async ({ page }) => {
    await loadBook(page)

    // Three top-level entries, four blueprints - the nested book contributes its
    // contents rather than itself.
    const last = await page.evaluate(async () => {
        const t = window.__fbe_test
        const book = await t.getBlueprintOrBookFromSource(await t.encodeLoaded())
        return book.lastBookIndex
    })

    expect(last).toBe(3)
})

test('serializing writes active_index at every level it passed through', async ({ page }) => {
    await loadBook(page)

    /*
        Flattened 2 is blueprint C, the second entry of the nested book. The
        serialized outer book should point at entry 1 - the nested book, not the
        flattened position - and the nested book at its own entry 1.
    */
    const encoded = await page.evaluate(async () => {
        const t = window.__fbe_test
        await t.selectBookIndex(2)
        return t.encodeLoaded()
    })

    const book = decodeBlueprintString(encoded).blueprint_book

    expect(book.active_index).toBe(1)
    expect(book.blueprints[1].blueprint_book.active_index).toBe(1)
})

test('selecting a top-level entry after a nested one points back at it', async ({ page }) => {
    await loadBook(page)

    // D is flattened 3 but top-level entry 2. Going through the nested book
    // first means the walk has to unwind its offset again.
    const encoded = await page.evaluate(async () => {
        const t = window.__fbe_test
        await t.selectBookIndex(2)
        await t.selectBookIndex(3)
        return t.encodeLoaded()
    })

    const book = decodeBlueprintString(encoded).blueprint_book

    expect(book.active_index).toBe(2)
})

test('every blueprint survives a select and serialize round trip', async ({ page }) => {
    await loadBook(page)

    /*
        Saving the active blueprint writes it back into its entry, so a walk of
        the whole book rewrites all four. A save that landed on the wrong slot
        would duplicate one label and lose another.
    */
    const encoded = await page.evaluate(async () => {
        const t = window.__fbe_test
        for (let i = 0; i <= 3; i++) await t.selectBookIndex(i)
        return t.encodeLoaded()
    })

    const book = decodeBlueprintString(encoded).blueprint_book
    const labels = [
        book.blueprints[0].blueprint.label,
        book.blueprints[1].blueprint_book.blueprints[0].blueprint.label,
        book.blueprints[1].blueprint_book.blueprints[1].blueprint.label,
        book.blueprints[2].blueprint.label,
    ]

    expect(labels).toEqual(['A', 'B', 'C', 'D'])
})
