import FD from './factorioData'
import { Entity } from './Entity'
import { Tile } from './Tile'

/** One line of a bill of materials: an item, or an entity or tile no item places. */
export interface MaterialCount {
    name: string
    /** Absent for normal quality, which is what an entity with no quality is. */
    quality?: string
    count: number
}

export interface BillOfMaterials {
    /** What the entities cost, most first. */
    entities: MaterialCount[]
    /** What the tiles cost, most first - kept apart from the entities (issue #342). */
    tiles: MaterialCount[]
}

/** What the tally reads from an entity - `Entity` itself fits. */
export interface MaterialSource {
    name: string
    quality?: string
}

/** The game's own order, for a tie in count between two qualities of one item. */
const QUALITY_ORDER = ['normal', 'uncommon', 'rare', 'epic', 'legendary']

function qualityRank(quality: string | undefined): number {
    const i = QUALITY_ORDER.indexOf(quality ?? 'normal')
    return i === -1 ? QUALITY_ORDER.length : i
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

/**
 * How many of `item` one `entityName` takes to place. 1 unless the entity's
 * `placeable_by` says otherwise, which in data.json is only the rails: a
 * curved rail takes 3 `rail`, a half-diagonal 2 and a legacy curved one 4, and
 * counting each as one would under-read a rail network by more than half.
 */
function placementCount(entityName: string, item: string): number {
    const placeableBy = FD.entities[entityName]?.placeable_by
    if (placeableBy === undefined) return 1
    const options = Array.isArray(placeableBy) ? placeableBy : [placeableBy]
    return options.find(o => o.item === item)?.count ?? 1
}

class Tally {
    private readonly lines = new Map<string, MaterialCount>()

    public add(name: string, quality: string | undefined, count: number): void {
        const q = quality === 'normal' ? undefined : quality
        const key = q === undefined ? name : `${name}\u0000${q}`
        const line = this.lines.get(key)
        if (line) line.count += count
        else this.lines.set(key, q === undefined ? { name, count } : { name, quality: q, count })
    }

    public sorted(): MaterialCount[] {
        return [...this.lines.values()].sort(
            (a, b) =>
                b.count - a.count ||
                compareStrings(a.name, b.name) ||
                qualityRank(a.quality) - qualityRank(b.quality) ||
                compareStrings(a.quality ?? '', b.quality ?? '')
        )
    }
}

/**
 * What it takes to build a blueprint: its entities counted per item that
 * places them and per quality, its tiles counted per item in a list of their
 * own.
 *
 * Per item rather than per prototype, so the 10 rail shapes all land on `rail`,
 * and the left and right hazard concrete tiles on `hazard-concrete`. An entity
 * no item places - `Entity.getItemName` answers undefined for 18, the dummy
 * rails and `red-chest` among them - is listed under its own name rather than
 * dropped, so the total still accounts for everything in the blueprint.
 *
 * Per quality because a legendary assembler is a different item from a normal
 * one: merged, the line would ask for items nobody holds. Tiles carry no
 * quality in a blueprint.
 *
 * Only the entities and tiles themselves. Modules, fuel and other item
 * requests inside an entity are not counted.
 */
export function billOfMaterials(
    entities: Iterable<MaterialSource>,
    tileNames: Iterable<string>
): BillOfMaterials {
    const entityTally = new Tally()
    for (const { name, quality } of entities) {
        const item = Entity.getItemName(name)
        entityTally.add(item ?? name, quality, item === undefined ? 1 : placementCount(name, item))
    }

    const tileTally = new Tally()
    for (const name of tileNames) {
        tileTally.add(Tile.getItemName(name) ?? name, undefined, 1)
    }

    return { entities: entityTally.sorted(), tiles: tileTally.sorted() }
}

/**
 * A count as the bill of materials draws it in a 36 px slot: exact up to 9999,
 * which is four digits and still fits, and past that three significant figures
 * with a unit - "12.3k", "123k", "1.25M" - which is never wider than five
 * characters. Rounded down, never to nearest, so a label cannot claim more
 * than the blueprint holds and 99999 reads "99.9k" rather than rolling over to
 * "100.0k". Past 9999 a slot does not give its exact count; the summary line
 * above the grid gives only the entity and tile totals.
 *
 * Its own formatter rather than `CreateIconWithAmount`'s, which floors to
 * whole thousands - 1535 and 1999 both read "1k" there - and is left alone for
 * the recipe and filter slots that use it.
 */
export function materialAmountLabel(count: number): string {
    if (count < 10_000) return count.toString()
    const [size, unit] = count < 1_000_000 ? [1000, 'k'] : [1_000_000, 'M']
    const whole = Math.floor(count / size)
    const decimals = whole >= 100 ? 0 : whole >= 10 ? 1 : 2
    // Integers throughout: `count / size` then `* 10` can land a hair under a
    // whole tenth and floor one too low.
    const digits = Math.floor((count * 10 ** decimals) / size).toString()
    if (decimals === 0) return `${digits}${unit}`
    return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}${unit}`
}
