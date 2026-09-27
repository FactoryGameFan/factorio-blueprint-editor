import FD from './factorioData'
import { Entity } from './Entity'
import { Tile } from './Tile'

/** One line of a bill of materials: an item, or an entity or tile no item places. */
export interface MaterialCount {
    name: string
    count: number
}

export interface BillOfMaterials {
    /** What the entities cost, most first. */
    entities: MaterialCount[]
    /** What the tiles cost, most first - kept apart from the entities (issue #342). */
    tiles: MaterialCount[]
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

function tally(counts: Map<string, number>): MaterialCount[] {
    return [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * What it takes to build a blueprint: its entities counted per item that
 * places them, its tiles counted the same way in a list of their own.
 *
 * Per item rather than per prototype, so the 10 rail shapes all land on `rail`,
 * and the left and right hazard concrete tiles on `hazard-concrete`. An entity no item
 * places - `Entity.getItemName` answers undefined for 18, the dummy rails and
 * `red-chest` among them - is listed under its own name rather than dropped,
 * so the total still accounts for everything in the blueprint.
 *
 * Only the entities and tiles themselves. Modules, fuel and other item
 * requests inside an entity are not counted.
 */
export function billOfMaterials(
    entityNames: Iterable<string>,
    tileNames: Iterable<string>
): BillOfMaterials {
    const entities = new Map<string, number>()
    for (const name of entityNames) {
        const item = Entity.getItemName(name)
        const key = item ?? name
        const count = item === undefined ? 1 : placementCount(name, item)
        entities.set(key, (entities.get(key) ?? 0) + count)
    }

    const tiles = new Map<string, number>()
    for (const name of tileNames) {
        const key = Tile.getItemName(name) ?? name
        tiles.set(key, (tiles.get(key) ?? 0) + 1)
    }

    return { entities: tally(entities), tiles: tally(tiles) }
}
