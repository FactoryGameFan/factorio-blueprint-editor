import { IBlueprint, IBlueprintBook, IBlueprintBookEntry, IIcon } from '../types'
import { Blueprint, getFactorioVersion } from './Blueprint'

class Book {
    /*
        The blueprint currently open, absent until selectBlueprint has opened one.
        A freshly constructed Book has none, which is why saveActiveBlueprint
        below is written as `if (this._active)` and answers 0 without it - the
        guard predates the type saying so.
    */
    private _active: Blueprint | undefined
    private _activeIndex: number
    private readonly blueprints: IBlueprintBookEntry[]

    private readonly label?: string
    private readonly description?: string
    private readonly icons?: IIcon[]

    public constructor(data: IBlueprintBook) {
        if (data) {
            this._activeIndex = getFlattenedActiveIndex(data.blueprints, data.active_index)
            this.blueprints = data.blueprints || []
            this.label = data.label
            this.description = data.description
            this.icons = data.icons
        } else {
            this._activeIndex = 0
            this.blueprints = []
        }
    }

    public get activeIndex(): number {
        return this._activeIndex
    }

    public get lastBookIndex(): number {
        return countNestedBlueprints(this.blueprints) - 1
    }

    private saveActiveBlueprint(): number {
        if (this._active) {
            const res = saveBlueprint(this.blueprints, this._activeIndex, this._active.serialize())
            // Not finding a slot used to answer undefined, which serialize() then
            // wrote into `active_index` - a required number - and JSON.stringify
            // dropped, producing a book with no active_index at all. 0 is what
            // the no-active-blueprint branch below already answers.
            return res.saved ? res.index : 0
        }
        return 0
    }

    public selectBlueprint(index?: number): Blueprint {
        this.saveActiveBlueprint()

        if (index !== undefined) {
            this._activeIndex = index < 0 || index > this.lastBookIndex ? 0 : index
        }

        const blueprint = getBlueprintAtFlattenedActiveIndex(this.blueprints, this._activeIndex)
        const bp = new Blueprint(blueprint)
        this._active = bp
        return bp
    }

    public serialize(): IBlueprintBook {
        const activeIndex = this.saveActiveBlueprint()

        return {
            blueprints: this.blueprints.map((v, index) => ({ ...v, index })),
            item: 'blueprint-book',
            active_index: activeIndex,
            version: getFactorioVersion(),
            label: this.label,
            description: this.description,
            icons: this.icons,
        }
    }
}

function countNestedBlueprints(bps: IBlueprintBookEntry[] = [], includePlanners = false): number {
    return bps.reduce((count, { blueprint, blueprint_book }) => {
        if (blueprint_book) {
            return count + countNestedBlueprints(blueprint_book.blueprints, includePlanners)
        } else if (blueprint || includePlanners) {
            return count + 1
        } else {
            return count
        }
    }, 0)
}

/**
 * Which entry of `bps` a book's `active_index` names, or undefined when it
 * names none.
 *
 * `active_index` is an **inventory slot**, in the same numbering as the `index`
 * each entry carries - not a position in the `blueprints` array. A user who
 * leaves gaps in the book's grid exports a dense array with sparse `index`
 * values, and then the two are different numbers. See the citation block above
 * `getFlattenedActiveIndex`.
 *
 * Answering undefined is the ordinary case for an active slot that holds
 * nothing, which the game accepts and writes out (again, see below). It is not
 * defensive: two books in `test-blueprints/EARN/` have one.
 */
function resolveActiveEntry(bps: IBlueprintBookEntry[], active_index: number): number | undefined {
    // `active_index` is typed as a number and is required by the schema, but a
    // blueprint that fails validation is still loaded (see bpString.decode), so
    // it can arrive as anything at runtime. A strict comparison covers that: no
    // entry's `index` matches a value that is not a number.
    const bySlot = bps.findIndex(entry => entry.index === active_index)
    return bySlot === -1 ? undefined : bySlot
}

/*
    A book addresses its blueprints by a flattened index - planners are skipped
    and a nested book contributes its contents rather than itself - while
    `active_index` names one top-level entry. This converts the second into the
    first.

    It used to read `bps[active_index]` twice with no bounds guard, which cost
    the whole blueprint rather than the page hint:

        TypeError: Cannot destructure property 'upgrade_planner' of
        'bps[active_index]' as it is undefined.

    The blueprint that found it is the `Capsules` book, item 7 of the upstream
    #277 capture: three entries in slots 0, 1 and 5, an `active_index` of 5, and
    so `bps[5]` undefined on a three-element array. Any book with empty slots
    ahead of the active one can reach it, because the gaps push the active slot
    number past the length of the array that holds it - and it takes the entire
    load down: `new Book` is on `bpString.decode`'s only path, no `try` between
    them.
    Adding that capture to the corpus (draft PR #332) failed six Playwright
    tests across three shards, all on this one root cause.

    ---- What active_index indexes, and how that was settled ----

    Two readings were possible - the entry's slot in the book's inventory grid,
    or its position in the `blueprints` array - and they are the same number for
    every book without gaps, which is almost every book. Twenty of the 37 books
    reachable from `test-blueprints/` and that capture are sparse, and three of
    those have a non-zero `active_index` that separates the readings. The corpus
    alone could not close it: the slot reading fits all three, but only by
    reading two of them as an active slot that holds nothing, and nothing in a
    blueprint string distinguishes an emptied slot from a stale number.

    Factorio's shipped documentation does not close it either. Both installs'
    `doc-html/runtime-api.json` describe `LuaItemCommon::active_index` only as
    "The active blueprint index for this blueprint book", and neither install
    documents the blueprint-string format at all - no page under
    `doc-html/auxiliary/`, nothing in `prototype-api.json`, no schema, and not
    one blueprint book among the 89 blueprint strings in the shipped data. The
    changelog is suggestive rather than decisive: 2.1's entry "Changed
    LuaItemStack::active_index to return nil if the blueprint book inventory has
    zero slots" ties the field to the inventory, and an older one, "Fixed that
    LuaItemStack::active_index was using 0-based indexing", says the Lua
    attribute is 1-based over a 0-based stored value.

    So this went to step 3 of `tools/oracle/README.md`'s order of attack - the
    binary - which that README still records as having been needed by nothing.
    Both installs ship a full PDB, so `BlueprintImportExportEngine` is named,
    and the import and export paths answer it outright. Read with `objdump -d
    -M intel`, verified identically in `/mnt/v/factorio-2.0.77` and
    `/mnt/v/factorio-2.1.14`.

    `loadBlueprintBookFromPropertyTree` (2.1.14 at 0x14108d380, 2.0.77 at
    0x140f5d870) reads the JSON `active_index`, compares it against the book
    *inventory's slot count* rather than the length of anything, and stores it
    with no remapping:

        cmp    dx,WORD PTR [r14+0x98]   ; vs the book inventory's slot count
        jae    <skip>                   ; out of range -> ignored, stays 0
        mov    WORD PTR [r14+0x118],dx  ; otherwise stored verbatim

    `saveBlueprintBookToPropertyTree` (2.1.14 at 0x1410897d0) walks inventory
    slots, skips the empty ones - which is where the gaps in `index` come from -
    writes each entry's `index` as that slot counter, and then writes
    `active_index` out of the same +0x118 field with no transformation.
    `LuaItemCommon::luaReadActiveIndex` reads that same field and adds one,
    which is the 1-based Lua view the changelog mentions.

    Two consequences the editor has to respect, both from that import path:

      - An `active_index` naming an *empty* slot is legal and round-trips, since
        the check is against capacity rather than occupancy. So the first
        blueprint is the answer here, not a guess at an array position - which
        an earlier draft of this fix made, and which would open
        `test-blueprints/EARN/power-blocks-v22-0-8.rev-1.txt` (slots
        [0, 1, 6, 7, 8, 9, 10, 12, 13], active 5) on the entry at slot 9. The
        PDB carries `BlueprintBook::setActiveIndexToFirstValid` and
        `BlueprintBookRecord::getIndexUpdatedToFirstValidValueIfPossible`, which
        says the game corrects such a value rather than trusting it - that much
        is a symbol name rather than disassembled behaviour, so read it as
        agreeing with the fallback rather than as the source of it.
      - An `active_index` past the inventory's capacity is dropped and the book
        falls back to 0, which is also what happens here.

    Nothing below may throw whatever the number is.
*/
function getFlattenedActiveIndex(bps: IBlueprintBookEntry[] = [], active_index: number): number {
    const pos = resolveActiveEntry(bps, active_index)

    // No resolvable entry: fall back to the first blueprint in the book. The
    // page the user had open is lost; the book is not.
    if (pos === undefined) return 0

    const { upgrade_planner, deconstruction_planner, blueprint_book } = bps[pos]

    // A planner and an empty nested book are not blueprints, so no flattened
    // index names them.
    if (
        upgrade_planner ||
        deconstruction_planner ||
        (blueprint_book && countNestedBlueprints(blueprint_book.blueprints) === 0)
    ) {
        return 0
    }

    /*
        The blueprints the earlier entries contribute, which is what the
        flattened index counts. This was a loop that started at `active_index`
        and corrected it per entry - `+= count - 1` for a book, `-= 1` for a
        planner - which is the same sum written as a series of adjustments to a
        wrong starting point, and only equal to it while the top-level index and
        the array position are the same number. It also had no arm for an entry
        that is neither a blueprint, a book nor a planner: the schema requires
        only `index`, so a bare `{ index: 3 }` is legal, and each one shifted the
        answer by one.
    */
    let res = countNestedBlueprints(bps.slice(0, pos))

    if (blueprint_book) {
        res += getFlattenedActiveIndex(blueprint_book.blueprints, blueprint_book.active_index)
    }

    return res
}

/**
 * The blueprint at flattened index `index`, or undefined where the index does
 * not land on one - `selectBlueprint` feeds the answer straight to the
 * `Blueprint` constructor, whose parameter is optional, so undefined degrades
 * to an empty blueprint rather than throwing.
 */
function getBlueprintAtFlattenedActiveIndex(
    bps: IBlueprintBookEntry[],
    index: number
): IBlueprint | undefined {
    const search = (bps: IBlueprintBookEntry[] = [], index: number): number | IBlueprint => {
        let i = index
        for (const { blueprint, blueprint_book } of bps) {
            if (blueprint) {
                if (i === 0) return blueprint
                i -= 1
            } else if (blueprint_book) {
                const ret = search(blueprint_book.blueprints, i)
                if (typeof ret === 'number') {
                    i = ret
                } else {
                    return ret
                }
            }
        }
        return i
    }

    const ret = search(bps, index)
    return typeof ret === 'number' ? undefined : ret
}

/**
 * The outcome of searching a book's entries for a flattened index. Exactly one
 * of the two cases holds, which the `[number, number]` tuple this replaces could
 * not say: it carried the answer in whichever slot was not undefined, and the
 * recursive call read `newI === undefined` to mean "saved" - a meaning nothing
 * in the type mentioned.
 */
type SaveResult =
    /** Written into the entry at top-level index `index`. */
    | { saved: true; index: number }
    /** Not in these entries; `remaining` blueprints of the search index are left to skip. */
    | { saved: false; remaining: number }

function saveBlueprint(bps: IBlueprintBookEntry[] = [], index: number, bp: IBlueprint): SaveResult {
    let i = index
    for (let j = 0; j < bps.length; j++) {
        const { blueprint, blueprint_book } = bps[j]
        if (blueprint) {
            if (i === 0) {
                bps[j].blueprint = bp
                return { saved: true, index: j }
            }
            i -= 1
        } else if (blueprint_book) {
            const nested = blueprint_book.blueprints ?? []
            const res = saveBlueprint(nested, i, bp)
            if (res.saved) {
                /*
                    The slot of the entry that was written, not its position in
                    the array. `active_index` is read back as a slot (see
                    `resolveActiveEntry`), and `Book.serialize` renumbers only
                    the *top-level* entries to their array positions - a nested
                    book keeps whatever sparse `index` values it was imported
                    with.

                    So a position written here names a different entry on the
                    next load whenever some earlier entry's slot happens to
                    equal it. Slots [0, 2, 3] and a save into the last entry is
                    the smallest case: position 2 is the entry at slot 3, and
                    the entry at slot 2 is the one before it.

                    The top-level answer stays a position on purpose, because
                    the renumbering makes the two the same number there. Both
                    branches therefore mean the same thing - the slot the entry
                    has in the book that is about to be written.
                */
                blueprint_book.active_index = nested[res.index].index
                return { saved: true, index: j }
            }
            i = res.remaining
        }
    }
    return { saved: false, remaining: i }
}

export { Book }
