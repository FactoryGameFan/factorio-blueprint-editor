import { IBlueprint, IBlueprintBook, IBlueprintBookEntry, IIcon } from '../types'
import { Blueprint, getFactorioVersion } from './Blueprint'

class Book {
    private _active: Blueprint
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

function getFlattenedActiveIndex(bps: IBlueprintBookEntry[] = [], active_index: number): number {
    {
        const { upgrade_planner, deconstruction_planner, blueprint_book } = bps[active_index]

        if (
            upgrade_planner ||
            deconstruction_planner ||
            (blueprint_book && countNestedBlueprints(blueprint_book.blueprints) === 0)
        ) {
            return 0
        }
    }

    let res = active_index

    for (let i = 0; i < active_index; i++) {
        const { upgrade_planner, deconstruction_planner, blueprint_book } = bps[i]

        if (blueprint_book) {
            res += countNestedBlueprints(blueprint_book.blueprints) - 1
        } else if (upgrade_planner || deconstruction_planner) {
            res -= 1
        }
    }

    const { blueprint_book } = bps[active_index]

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
            const res = saveBlueprint(blueprint_book.blueprints, i, bp)
            if (res.saved) {
                blueprint_book.active_index = res.index
                return { saved: true, index: j }
            }
            i = res.remaining
        }
    }
    return { saved: false, remaining: i }
}

export { Book }
