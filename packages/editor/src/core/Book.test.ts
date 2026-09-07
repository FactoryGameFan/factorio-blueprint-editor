import { describe, expect, it } from 'vite-plus/test'
import { Book } from './Book'
import { IBlueprint, IBlueprintBook, IBlueprintBookEntry } from '../types'

/*
    What `active_index` resolves to, and that resolving it never throws.

    `getFlattenedActiveIndex` used to index `bps[active_index]` with no bounds
    guard, on the assumption that `active_index` is a position in the
    `blueprints` array. It is a slot in the book's inventory grid, and a user
    who leaves gaps in that grid exports a dense array with sparse `index`
    values - so `bps[active_index]` was undefined and destructuring it threw.
    `new Book` sits on `bpString.decode`'s only path with no `try` between them,
    so that cost the whole blueprint rather than the page hint.

    These are unit tests rather than Playwright specs on purpose. Everything
    here is arithmetic over the decoded JSON: no Factorio data, no renderer and
    no browser is involved in choosing which blueprint a book opens on.
    `tests/book-serialize.spec.ts` covers the same conversion from the other
    end, through the editor.

    The book shapes are the measured ones. See the citation block in Book.ts for
    where each comes from and what it settles.
*/

/** How Factorio packs a version into the `version` field. */
const version = (main: number, major: number, minor: number, dev = 0): number =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16 + dev

const V_1_1 = version(1, 1, 69, 2)
const V_2_0 = version(2, 0, 55)

/*
    A blueprint with no entities, identifiable by its label. Entity-less because
    these tests never load Factorio data: `Blueprint`'s constructor only reaches
    FD for entities and tiles, so a labelled empty one is safe in a node
    environment while a populated one is not.
*/
const blueprint = (label: string): IBlueprint =>
    ({ item: 'blueprint', version: V_2_0, label }) as unknown as IBlueprint

const book = (
    active_index: number,
    blueprints: IBlueprintBookEntry[] | undefined,
    version = V_2_0
): IBlueprintBook => ({ item: 'blueprint-book', version, active_index, blueprints })

/** The label of the blueprint the book opens on. */
const openedLabel = (data: IBlueprintBook): string | undefined =>
    new Book(data).selectBlueprint().name

describe('Book active_index resolution', () => {
    /*
        The reproducing blueprint: the `Capsules` book, item 7 of the upstream
        #277 capture, declared at 1.1.69.2. Two blueprints in slots 0 and 1 and
        an upgrade planner in slot 5, with `active_index: 5` - so the array has
        three elements and `bps[5]` is undefined.
    */
    const capsules = (): IBlueprintBook =>
        book(
            5,
            [
                { index: 0, blueprint: blueprint('distractor') },
                { index: 1, blueprint: blueprint('destroyer') },
                { index: 5, upgrade_planner: { item: 'upgrade-planner' } },
            ],
            V_1_1
        )

    it('does not throw on a sparse book whose active slot is past the array end', () => {
        expect(() => new Book(capsules())).not.toThrow()
    })

    it('reads active_index as a slot, so slot 5 finds the upgrade planner', () => {
        // A planner has no flattened index, so the book falls back to its first
        // blueprint. The page hint is lost; the two blueprints are not.
        expect(new Book(capsules()).activeIndex).toBe(0)
        expect(openedLabel(capsules())).toBe('distractor')
    })

    it('keeps both blueprints of the sparse book reachable', () => {
        const bk = new Book(capsules())
        expect(bk.lastBookIndex).toBe(1)
        expect(bk.selectBlueprint(1).name).toBe('destroyer')
    })

    /*
        `test-blueprints/EARN/power-blocks-v22-0-8.rev-1.txt`: slots
        [0, 1, 6, 7, 8, 9, 10, 12, 13] with `active_index: 5`, a slot inside the
        2-5 gap that holds nothing. Factorio accepts and re-exports that, and
        fixes it up on use with `setActiveIndexToFirstValid`, so the first
        blueprint is the right answer.

        This is the case that says the lookup is by slot rather than by array
        position: position 5 is the entry at slot 9, four pages from where the
        book should open.
    */
    it('falls back to the first blueprint when the active slot holds nothing', () => {
        const entries = [0, 1, 6, 7, 8, 9, 10, 12, 13].map(index => ({
            index,
            blueprint: blueprint(`slot-${index}`),
        }))
        expect(new Book(book(5, entries)).activeIndex).toBe(0)
        expect(openedLabel(book(5, entries))).toBe('slot-0')
    })

    /*
        A nested book in `test-blueprints/EARN/earn-v22-0-12.rev-2.txt`: six
        entries in slots 0-5 and `active_index: 8`. Same fallback, reached the
        other way - past every entry rather than into a gap.
    */
    it('falls back to the first blueprint when active_index is past every slot', () => {
        const entries = [0, 1, 2, 3, 4, 5].map(index => ({
            index,
            blueprint: blueprint(`slot-${index}`),
        }))
        expect(new Book(book(8, entries)).activeIndex).toBe(0)
        expect(openedLabel(book(8, entries))).toBe('slot-0')
    })

    it('survives an active_index that is not a number at all', () => {
        // The schema requires active_index, but a blueprint that fails
        // validation is loaded anyway, so the field can arrive as anything.
        const entries = [{ index: 0, blueprint: blueprint('only') }]
        const missing = { item: 'blueprint-book', version: V_2_0, blueprints: entries }
        expect(new Book(missing as unknown as IBlueprintBook).activeIndex).toBe(0)
    })

    it('survives an empty book', () => {
        expect(new Book(book(0, [])).activeIndex).toBe(0)
        expect(new Book(book(0, undefined)).activeIndex).toBe(0)
        expect(new Book(book(3, [])).activeIndex).toBe(0)
    })
})

describe('Book active_index flattening', () => {
    /*
        The behaviour that was already correct, kept here so the rewrite of the
        conversion loop into `countNestedBlueprints(bps.slice(0, pos))` has to
        prove it did not move.

        Flattened index -> label, for BOOK below:

          entry 0  blueprint A                                    0
          entry 1  book        entry 0  blueprint B               1
                               entry 1  blueprint C               2
          entry 2  upgrade planner                                -
          entry 3  blueprint D                                    3
          entry 4  empty book                                     -
          entry 5  blueprint E                                    4
    */
    const BOOK = (active_index: number): IBlueprintBook =>
        book(active_index, [
            { index: 0, blueprint: blueprint('A') },
            {
                index: 1,
                blueprint_book: book(1, [
                    { index: 0, blueprint: blueprint('B') },
                    { index: 1, blueprint: blueprint('C') },
                ]),
            },
            { index: 2, upgrade_planner: { item: 'upgrade-planner' } },
            { index: 3, blueprint: blueprint('D') },
            { index: 4, blueprint_book: book(0, []) },
            { index: 5, blueprint: blueprint('E') },
        ])

    it('counts a nested book by its contents, not as one entry', () => {
        // Entry 3 sits behind a two-blueprint book and a planner: 1 + 2 + 0.
        expect(new Book(BOOK(3)).activeIndex).toBe(3)
        expect(openedLabel(BOOK(3))).toBe('D')
        expect(new Book(BOOK(5)).activeIndex).toBe(5 - 1 - 1 + 2 - 1)
        expect(openedLabel(BOOK(5))).toBe('E')
    })

    it('descends into an active nested book, carrying its own active_index', () => {
        // The inner book's active_index is 1, so C rather than B.
        expect(new Book(BOOK(1)).activeIndex).toBe(2)
        expect(openedLabel(BOOK(1))).toBe('C')
    })

    it('answers 0 for an active planner or an active empty book', () => {
        expect(new Book(BOOK(2)).activeIndex).toBe(0)
        expect(openedLabel(BOOK(2))).toBe('A')
        expect(new Book(BOOK(4)).activeIndex).toBe(0)
        expect(openedLabel(BOOK(4))).toBe('A')
    })

    it('leaves the ordinary first-entry case alone', () => {
        expect(new Book(BOOK(0)).activeIndex).toBe(0)
        expect(openedLabel(BOOK(0))).toBe('A')
    })

    /*
        An entry that is neither a blueprint, a book nor a planner. The schema
        requires only `index`, so this is a legal shape, and the loop this
        replaced counted one blueprint for it - putting every later entry one
        past where it lives.
    */
    /*
        Reading `active_index` as a slot only stays right if the editor writes
        one, and `Book.serialize` renumbers the top-level entries but not a
        nested book's. Slots [0, 2, 3] is the smallest nested shape where the
        two readings name different entries: array position 2 is the entry at
        slot 3, and the entry at slot 2 sits one before it. Writing the position
        there sent the next load to the wrong page.
    */
    it('serializes a nested selection as a slot, so it survives a round trip', () => {
        const nested = (): IBlueprintBook =>
            book(0, [
                { index: 0, blueprint: blueprint('X') },
                { index: 2, blueprint: blueprint('Y') },
                { index: 3, blueprint: blueprint('Z') },
            ])

        const outer = book(0, [
            { index: 0, blueprint: blueprint('A') },
            { index: 1, blueprint_book: nested() },
        ])

        const bk = new Book(outer)
        // Flattened 3 is Z, the last entry of the nested book.
        expect(bk.selectBlueprint(3).name).toBe('Z')

        const written = bk.serialize()
        const innerWritten = written.blueprints?.[1].blueprint_book

        expect(innerWritten?.active_index).toBe(3)
        expect(new Book(written).activeIndex).toBe(3)
        expect(new Book(written).selectBlueprint().name).toBe('Z')
    })

    it('does not count an entry that holds nothing', () => {
        const entries: IBlueprintBookEntry[] = [
            { index: 0, blueprint: blueprint('A') },
            { index: 1 },
            { index: 2, blueprint: blueprint('B') },
        ]
        expect(new Book(book(2, entries)).activeIndex).toBe(1)
        expect(openedLabel(book(2, entries))).toBe('B')
    })
})
