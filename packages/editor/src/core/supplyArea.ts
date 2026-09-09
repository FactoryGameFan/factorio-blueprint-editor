/*
    Where an electric pole's or a beacon's supply area actually falls (#263).

    Two callers need this and both had their own copy of it, both wrong for the
    beacon in different ways: `UnderlayContainer` drew an 8x8 square where the
    game shows 9x9, and `EntityInfoPanel` built a 9x9 rectangle but hung it off
    the beacon's centre as though that were its top-left tile corner, so the
    module effects it reported were shifted half a tile south and east.

    The trap under both is that `supply_area_distance` does NOT mean the same
    thing on the two prototypes that carry it, and nothing in the field name
    says so:

      - ElectricPolePrototype.supply_area_distance is the radius, half the
        supply area's side. typed-factorio quotes the docs directly: "Corresponds
        to *half* of the 'supply area' in the item tooltip. If this is 3.5, the
        pole will have a 7x7 supply area." The entity's own size does not enter
        into it.

      - BeaconPrototype.supply_area_distance is measured outward from the
        beacon's footprint, so the entity's size does enter into it. The beacon
        is 3 tiles across with a distance of 3 and covers 9x9, which is
        3 + 3 + 3.

    So one formula cannot serve both, and the reason poles look right today is
    not that they are small - it is that the pole branch never applied the
    beacon's formula in the first place. Applying it would break them: a small
    pole would read 2.5 + 0.5 = 3, a 6x6 area where the game gives 5x5, and a
    big pole 2 + 1 = 3, a 6x6 where the game gives 4x4.

    A cheap check that both readings are right: a supply area always lines up
    with the tile grid, so a correct half-extent added to an entity's centre must
    land on a whole number. A 1x1 pole sits at a tile centre (x.5) and its
    distances are the half-integers 2.5 and 3.5; a 2x2 pole sits on a tile corner
    and its distances are the integers 2 and 9; a 3x3 beacon sits at x.5 and gets
    3 + 1.5 = 4.5. All three land on the grid, and swapping the two formulas
    breaks every one of them. `supplyArea.test.ts` asserts exactly that.

    Pure - no pixi, no FD lookups, no globals - so it is unit tested rather than
    left to the browser suite, following throughput.ts and zoomLevels.ts.
*/

import {
    BeaconPrototype,
    ElectricPolePrototype,
    EntityWithOwnerPrototype,
} from 'factorio:prototype'
import { IPoint } from '../types'
import { getEntitySize, isBeacon, isElectricPole } from './factorioData'

/** The two prototypes that carry `supply_area_distance`, each meaning its own thing by it. */
type SupplyingPrototype = ElectricPolePrototype | BeaconPrototype

/** A tile-grid rectangle. `right` and `bottom` are exclusive, as tile edges are. */
export interface IArea {
    left: number
    top: number
    right: number
    bottom: number
}

/**
 * Tiles from an entity's centre to the edge of the area it supplies, or
 * `undefined` for an entity that supplies nothing.
 *
 * This is the one number both callers were getting wrong. Multiply it by two
 * for the area's side in tiles.
 */
export function supplyAreaHalfExtent(e: SupplyingPrototype): number
export function supplyAreaHalfExtent(e: EntityWithOwnerPrototype): number | undefined
export function supplyAreaHalfExtent(e: EntityWithOwnerPrototype): number | undefined {
    // The pole's distance already IS the half-extent - see the note above.
    if (isElectricPole(e)) return e.supply_area_distance

    if (isBeacon(e)) {
        const size = getEntitySize(e)
        /*
            Measured out from the footprint, so half of it joins the distance.
            Every supplying entity in data.json is square; `max` only decides
            what a modded oblong beacon would get, and the larger side is the
            side whose reach the drawn square has to cover.
        */
        return e.supply_area_distance + Math.max(size.x, size.y) / 2
    }

    return undefined
}

/**
 * The tiles an entity supplies, given where it stands, or `undefined` for an
 * entity that supplies nothing.
 */
export function supplyAreaBounds(e: SupplyingPrototype, position: IPoint): IArea
export function supplyAreaBounds(e: EntityWithOwnerPrototype, position: IPoint): IArea | undefined
export function supplyAreaBounds(e: EntityWithOwnerPrototype, position: IPoint): IArea | undefined {
    const halfExtent = supplyAreaHalfExtent(e)
    if (halfExtent === undefined) return undefined

    return {
        left: position.x - halfExtent,
        top: position.y - halfExtent,
        right: position.x + halfExtent,
        bottom: position.y + halfExtent,
    }
}

/**
 * Whether a supplier standing at `position` reaches an entity of `size` centred
 * on `targetPosition`.
 *
 * Overlap of the two footprints, not "is a corner of the target inside the
 * area". Moving the aura onto the beacon's centre is not on its own enough,
 * because the corner test would then count a neighbour whose own east or south
 * edge merely touches the aura - `Rectangle.contains` reads its left and top
 * edges as inclusive. It also misses an entity long enough to cross the aura
 * with all four of its own corners outside it.
 */
export function suppliesEntity(
    e: EntityWithOwnerPrototype,
    position: IPoint,
    targetPosition: IPoint,
    targetSize: IPoint
): boolean {
    const area = supplyAreaBounds(e, position)
    if (area === undefined) return false

    const left = targetPosition.x - targetSize.x / 2
    const right = targetPosition.x + targetSize.x / 2
    const top = targetPosition.y - targetSize.y / 2
    const bottom = targetPosition.y + targetSize.y / 2

    // Strict, so footprints that only share an edge do not count as overlapping.
    return left < area.right && right > area.left && top < area.bottom && bottom > area.top
}
