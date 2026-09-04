import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import { discoverBlueprintFiles } from './helpers/blueprint-files'
import { decodeBlueprintString } from './helpers/encode-blueprint'
import { Book } from '../packages/editor/src/core/Book'
import { IBlueprintBook } from '../packages/editor/src/types'

/*
    Every book in the committed corpus, constructed.

    `Book`'s constructor is the one part of the load path that reads a book's
    own metadata rather than its entities, so it needs no Factorio data, no
    renderer and no browser - which is why this is a vitest test next to the
    corpus guard rather than a fourteenth Playwright spec. The synthetic shapes
    live in `packages/editor/src/core/Book.test.ts`; this is the same question
    asked of files a user actually exported.

    The last two tests are controls. A corpus that happens to hold no book with
    a gap ahead of its active entry would pass the first test whether `Book`
    were fixed or not, and one with no active-but-empty slot could not tell a
    slot lookup from an array lookup - so both shapes are asserted to be present
    rather than assumed.

    This is deliberately stricter than the load path, and the difference is
    worth stating so nobody reads a green run here as "the corpus is safe".
    `getFlattenedActiveIndex` descends only into the *active* nested book, so a
    bad `active_index` on a book nobody selects is never read in production.
    The one such book in the corpus is exactly that case: it sits at slot 4 of a
    book whose own `active_index` is 0, so today it crashes this file and not
    the editor. Constructing every book directly is what makes it a regression
    guard rather than a record of which entry happened to be selected.
*/

interface CorpusBook {
    file: string
    /** Where in the nesting, e.g. "root/9/4". */
    path: string
    book: IBlueprintBook
}

/** Every book in the corpus, nested ones included. */
function corpusBooks(): CorpusBook[] {
    const found: CorpusBook[] = []

    const walk = (book: IBlueprintBook, file: string, path: string): void => {
        found.push({ file, path, book })
        ;(book.blueprints ?? []).forEach((entry, i) => {
            if (entry.blueprint_book) walk(entry.blueprint_book, file, `${path}/${i}`)
        })
    }

    for (const { name, filePath } of discoverBlueprintFiles()) {
        const data = decodeBlueprintString(fs.readFileSync(filePath, 'utf8').trim())
        if (data.blueprint_book) walk(data.blueprint_book as IBlueprintBook, name, 'root')
    }

    return found
}

describe('every book in test-blueprints/', () => {
    const books = corpusBooks()

    it('finds books to check', () => {
        // If the corpus ever stops holding books, the tests below pass by
        // checking nothing at all.
        expect(books.length).toBeGreaterThan(0)
    })

    it('constructs without throwing, and opens on a real blueprint', () => {
        const failures: string[] = []

        for (const { file, path, book } of books) {
            try {
                const bk = new Book(book)
                // A book with no blueprints at all answers -1 here, which is
                // legal - the corpus has none, and `lastBookIndex` is what
                // `selectBlueprint` bounds-checks against.
                expect(bk.activeIndex).toBeGreaterThanOrEqual(0)
                expect(bk.activeIndex).toBeLessThanOrEqual(Math.max(bk.lastBookIndex, 0))
            } catch (e) {
                failures.push(`${file} ${path}: ${(e as Error).message}`)
            }
        }

        expect(failures).toEqual([])
    })

    /*
        The control. `getFlattenedActiveIndex` used to index the entry array
        with `active_index` directly, so the shape that broke it is an
        `active_index` at or past the array length - which happens because the
        number is an inventory slot and a book with empty slots has more slots
        than entries.

        One book in the corpus has it: a book nested in
        `EARN/earn-v22-0-12.rev-2.txt` with six entries and an `active_index` of
        8. Asserting the count rather than "at least one" means a corpus change
        that removes it has to be noticed rather than silently emptying this
        file of its point.
    */
    it('still holds a book whose active_index is past its entry array', () => {
        const past = books.filter(({ book }) => book.active_index >= (book.blueprints ?? []).length)

        expect(past.map(({ file, path }) => `${file} ${path}`)).toEqual([
            'EARN/earn-v22-0-12.rev-2 root/9/4',
        ])
    })

    /*
        The other control, for the reading rather than the crash. These are the
        books whose `active_index` names an inventory slot that holds nothing -
        which Factorio permits, since its import bounds-checks the number
        against the book's slot capacity rather than against what is in it.

        They are what says the lookup is by slot: for both of these the array
        position is a perfectly good index into `blueprints` and answers a
        different entry, so a corpus with neither could not tell the two
        readings apart at all.
    */
    it('still holds books whose active_index names an empty slot', () => {
        const empty = books.filter(
            ({ book }) => !(book.blueprints ?? []).some(e => e.index === book.active_index)
        )

        expect(empty.map(({ file, path }) => `${file} ${path}`)).toEqual([
            'EARN/earn-v22-0-12.rev-2 root/9/4',
            'EARN/power-blocks-v22-0-8.rev-1 root',
        ])
    })
})
