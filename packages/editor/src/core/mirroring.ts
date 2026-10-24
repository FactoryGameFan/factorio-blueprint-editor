import { IPoint } from '../types'

/*
    What a blueprint entity's `mirror: true` does to where things sit (#612).

    The runtime docs say a mirrored entity "is flipped over the axis that is
    pointing in the entity's direction", and `tools/oracle/probe-mirroring.mjs`
    measured it on 2.0.77 and 2.1.23: every fluid connection of a mirrored
    entity is the unmirrored one reflected across the line through the centre
    along its facing. Facing north or south that negates x, facing east or west
    it negates y. That holds for the `positions` list a pumpjack carries per
    direction as well as for a single `position` turned by the direction, and
    the burner mining drill's drop point moves the same way.

    Both functions take the offset and facing already turned into the world,
    so a caller mirrors last, after it has rotated.
*/

/** `p` reflected across the axis an entity facing `entityDir` points along. */
export function mirrorPoint(p: IPoint, entityDir: number): IPoint {
    switch (((entityDir % 16) + 16) % 8) {
        case 0:
            return { x: -p.x, y: p.y }
        case 4:
            return { x: p.x, y: -p.y }
        case 2:
            // north-east / south-west axis
            return { x: -p.y, y: -p.x }
        case 6:
            // south-east / north-west axis
            return { x: p.y, y: p.x }
        default:
            throw new Error(`cannot mirror across 16-way direction ${entityDir}`)
    }
}

/** A 16-way direction reflected across the same axis: `2 * entityDir - dir`. */
export function mirrorDirection(dir: number, entityDir: number): number {
    return (((2 * entityDir - dir) % 16) + 16) % 16
}
