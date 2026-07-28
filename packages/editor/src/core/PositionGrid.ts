import util from '../common/util'
import { IPoint } from '../types'
import FD, { getEntitySize } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import { IEntityConnectionPoint } from './WireConnections'

/** Anchor is in the middle */
interface IArea {
    x: number
    y: number
    w: number
    h: number
}

interface INeighbourData extends IPoint {
    relDir: number
    /** undefined when the neighbouring cell is empty */
    entity: Entity | undefined
}

/** Moves X and Y to top left corner from middle (anchor 0.5 0.5 => 0 0) */
const processArea = (area: IArea): IArea => ({
    ...area,
    x: Math.round(area.x - area.w / 2),
    y: Math.round(area.y - area.h / 2),
})

/*
    The rail rules below are permissive by policy and measured where they are
    not - see the note on isAreaAvailable. Both helpers read from
    tools/oracle/fixtures/rail-placement.json, which swept can_place_entity over
    position x direction around every orientation of every rail type against
    Factorio 2.1.12.

    Both answer true for a name they do not recognise. That is deliberate twice
    over: an unmeasured rail should keep the permissive behaviour rather than
    inherit a restriction from a measurement that never covered it, and Space
    Age has form for adding members to an existing entity type, so a switch that
    defaults to "forbid" would start silently refusing new prototypes.
*/

/**
 * Whether a rail already in the area can hold a signal on its own tiles.
 *
 * Measured over every orientation: straight-rail (4), half-diagonal-rail (4)
 * and legacy-curved-rail (8) have **no** legal signal position that overlaps
 * their tiles - all 16, 16 and 20 legal spots sit outside - so a signal the
 * editor's grid sees on top of one is a placement the game refuses outright.
 * curved-rail-a has one per orientation and curved-rail-b two or three, and
 * nothing on an integer tile grid can say which, so those stay permissive.
 *
 * The split does not follow the straight/curved grouping the rest of this
 * function uses. legacy-straight-rail has one on each of its four **diagonal**
 * orientations and none on its cardinals, and legacy-curved-rail has none at
 * all - the opposite of its 2.0 namesakes.
 */
const canHoldASignalOnItsTiles = (rail: Entity): boolean => {
    if (rail.name === 'legacy-straight-rail') return rail.direction % 4 !== 0
    return !(
        rail.name === 'straight-rail' ||
        rail.name === 'half-diagonal-rail' ||
        rail.name === 'legacy-curved-rail'
    )
}

/**
 * Whether a rail and a gate may share tiles, asked of either one.
 *
 * Measured: a 2.0 straight-rail takes a gate only on its **cardinal**
 * orientations - at directions 2 and 6 the game accepts a gate at none of the
 * 2704 swept placements, where at 0 and 4 it accepts 128. The same holds for a
 * rail laid over an existing gate, where only rail directions normalising to 0
 * and 4 are accepted. legacy-straight-rail carries no such restriction and
 * takes gates at all six of its orientations.
 *
 * half-diagonal-rail takes a gate at none of its four orientations, which is
 * why the gate rules say nothing about it - see isAreaAvailable.
 *
 * With this in place, the gate rules agree with the game **exactly** on every
 * direction the editor can produce - checked against the fixture for all ten
 * straight and half-diagonal orientations, with `getPossibleRotations` giving a
 * gate [0, 4, 8, 12] and every rail [0, 2, 4, 6, 8, 10, 12, 14]. The only
 * remaining disagreement on a reachable direction is the gate-on-a-curved-rail
 * refusal, which is #133.
 *
 * They disagree on *un*reachable ones, and it is worth knowing why rather than
 * discovering it later: the caller compares `direction % 8`, where a gate has
 * only four orientations and the game normalises to the quadrant first. So at a
 * gate direction of 1, 2 or 3 the two answers part company in both directions.
 * Nothing produces those - the editor rotates a gate through quadrants and
 * Factorio never writes anything else - so this is a latent property of the
 * modulus rather than a live gap, and is not worth a fix on its own.
 */
const railTakesGates = (name: string, direction: number): boolean =>
    name === 'straight-rail' ? direction % 4 === 0 : true

export class PositionGrid {
    private bp: Blueprint
    private grid: Map<string, number | number[]> = new Map()

    public constructor(bp: Blueprint) {
        this.bp = bp
    }

    /**
     * Resolves an entity number held in the grid.
     *
     * The grid is an index into `bp.entities`, not an independent store: numbers
     * only enter it through setTileData and leave through removeTileData, both of
     * which Blueprint drives from the single onCreateOrRemoveEntity hook. So a
     * number sitting in a cell always has a live entity behind it, and a miss means
     * the two have drifted apart rather than that the caller asked for something
     * reasonable.
     */
    private entityAt(entityNumber: number): Entity {
        const entity = this.bp.entities.get(entityNumber)
        if (entity === undefined) {
            throw new Error(
                `Position grid references entity ${entityNumber}, which is not in the blueprint`
            )
        }
        return entity
    }

    /**
     * Visits the occupied cells of an area, stopping early if fn returns true.
     *
     * Empty cells are skipped, which is what lets every caller here treat a cell as
     * present. The one caller that needs to see the gaps uses eachCellIncludingEmpty.
     */
    private tileDataAction(
        area: IArea,
        // oxlint-disable-next-line @typescript-eslint/no-invalid-void-type -- callback returns true to stop iteration, or nothing to continue
        fn: (key: string, cell: number | number[]) => boolean | void
    ): void {
        const A = processArea(area)

        let stop = false
        for (let x = A.x, maxX = A.x + A.w; x < maxX; x++) {
            for (let y = A.y, maxY = A.y + A.h; y < maxY; y++) {
                const key = `${x},${y}`
                const cell = this.grid.get(key)
                if (cell) {
                    stop = !!fn(key, cell)
                }
                if (stop) {
                    break
                }
            }
            if (stop) {
                break
            }
        }
    }

    /** Visits every cell of an area, handing over undefined for the empty ones */
    private eachCellIncludingEmpty(
        area: IArea,
        fn: (key: string, cell: number | number[] | undefined) => void
    ): void {
        const A = processArea(area)

        for (let x = A.x, maxX = A.x + A.w; x < maxX; x++) {
            for (let y = A.y, maxY = A.y + A.h; y < maxY; y++) {
                const key = `${x},${y}`
                fn(key, this.grid.get(key))
            }
        }
    }

    /** Returns the topmost entity covering the position, or undefined if it is empty */
    public getEntityAtPosition(position: IPoint): Entity | undefined {
        const cell = this.grid.get(`${Math.floor(position.x)},${Math.floor(position.y)}`)
        if (cell) {
            if (typeof cell === 'number') {
                return this.entityAt(cell)
            } else {
                return this.entityAt(cell[cell.length - 1])
            }
        }
        return undefined
    }

    public getConnectionPointAtPosition(
        position: IPoint,
        color: string
    ): IEntityConnectionPoint | undefined {
        const entity = this.getEntityAtPosition(position)
        if (entity === undefined) return undefined
        const rel_position = util.sumprod(position, -1, entity.position)
        for (let side = 1; side <= 10; side++) {
            const bbox = entity.getWireConnectionBoundingBox(color, side)
            if (bbox === undefined) break // no more sides expected for that color
            const rel_bbox = bbox.map(b => util.sumprod(rel_position, -1, b))
            if (Object.values(rel_bbox[0]).some(v => v < 0)) continue
            if (Object.values(rel_bbox[1]).some(v => v > 0)) continue
            return {
                entityNumber: entity.entityNumber,
                entitySide: side,
            }
        }
        return undefined
    }

    public setTileData(entity: Entity, position: IPoint = entity.position): void {
        // if (entity.entityData.flags.includes('placeable-off-grid')) {
        //     return
        // }

        this.eachCellIncludingEmpty(
            {
                x: position.x,
                y: position.y,
                w: entity.size.x,
                h: entity.size.y,
            },
            (key, cell) => {
                if (cell) {
                    const entityNumbers = [
                        entity.entityNumber,
                        ...(typeof cell === 'number' ? [cell] : cell),
                    ]
                        // Sort entities by their size
                        .sort((a, b) => {
                            const sA = this.entityAt(a).size
                            const sB = this.entityAt(b).size
                            return sB.x * sB.y - sA.x * sA.y
                        })

                    this.grid.set(key, entityNumbers)
                } else {
                    this.grid.set(key, entity.entityNumber)
                }
            }
        )
    }

    public removeTileData(entity: Entity, position: IPoint = entity.position): void {
        this.tileDataAction(
            {
                x: position.x,
                y: position.y,
                w: entity.size.x,
                h: entity.size.y,
            },
            (key, cell) => {
                if (typeof cell === 'number') {
                    if (cell === entity.entityNumber) {
                        this.grid.delete(key)
                    }
                } else {
                    const res = cell.findIndex(v => v === entity.entityNumber)
                    if (res !== -1) {
                        if (cell.length === 1) {
                            this.grid.delete(key)
                        } else if (cell.length === 2) {
                            // the pair collapses to whichever of the two is not `res`
                            this.grid.set(key, cell[res === 0 ? 1 : 0])
                        } else {
                            this.grid.set(
                                key,
                                cell.filter((_, k) => k !== res)
                            )
                        }
                    }
                }
            }
        )
    }

    public canMoveTo(entity: Entity, newPosition: IPoint): boolean {
        this.removeTileData(entity)
        const spaceAvalible = this.isAreaAvailable(entity.name, newPosition, entity.direction)
        this.setTileData(entity)
        return spaceAvalible
    }

    /**
     * Whether an entity may be placed here - true means placeable.
     *
     * **The rail rules are permissive on purpose, and the exceptions are
     * measured** (issue #95). This grid keys integer tiles and Factorio does
     * not: a curved-rail-a is a 2x6 rectangle here holding a curve, a
     * half-diagonal-rail a 2x2 square against a collision box spanning roughly
     * 1.5x4.5, and the four elevated-* rail types are not classified at all -
     * they fall to `otherEntities` and read as ordinary obstructions. Modelling
     * the real rules means per-rail collision shapes rather than rectangles,
     * which is its own piece of work - issue #133.
     *
     * So the policy is: accept more than the game does rather than model
     * geometry this structure cannot hold, **except** where a permissive answer
     * writes a blueprint the game will not build back. Those cases are refused,
     * and each one is measured against the real binary in
     * tools/oracle/fixtures/rail-placement.json rather than reasoned about,
     * because reasoning got the grouping wrong twice - legacy-straight-rail
     * behaves like a curved rail here and legacy-curved-rail like a straight
     * one.
     *
     * Known refusals the game would allow, left alone as annoyances rather than
     * corruptions and tracked in #133: a half-diagonal or curved rail laid over
     * a gate, and a gate on a curved rail.
     */
    public isAreaAvailable(name: string, pos: IPoint, direction = 0): boolean {
        const size = getEntitySize(FD.entities[name], direction)

        const straightRails: Entity[] = []
        const halfDiagonalRails: Entity[] = []
        let gate: Entity | undefined
        let curvedRail: Entity | undefined
        let signal: Entity | undefined
        let otherEntities = false

        const area = {
            x: pos.x,
            y: pos.y,
            w: size.x,
            h: size.y,
        }

        if (this.isAreaEmpty(area)) return true

        /*
            half-diagonal-rail is classified but the gate rules below say nothing
            about it, and that is now the measured answer rather than an
            omission: the game accepts a gate on a half-diagonal rail's tiles at
            none of its four orientations, 0 of 2704 swept placements each. The
            rules were written for the pre-2.0 straight/curved pair and happen to
            be right here by saying nothing.

            The reverse is not right, and is left alone on purpose: the game does
            accept a half-diagonal rail laid over a gate, and so do curved rails
            and legacy-curved-rail, all of which this function refuses. Those are
            refusals rather than corruptions, and fixing them needs the rail
            geometry this grid cannot hold - see the note on the function.
        */
        for (const entity of this.getEntitiesInArea(area)) {
            switch (entity.type) {
                case 'gate':
                    gate = entity
                    break
                case 'legacy-curved-rail':
                case 'curved-rail-a':
                case 'curved-rail-b':
                    curvedRail = entity
                    break
                case 'legacy-straight-rail':
                case 'straight-rail':
                    if (!straightRails.includes(entity)) {
                        straightRails.push(entity)
                    }
                    break
                case 'half-diagonal-rail':
                    if (!halfDiagonalRails.includes(entity)) {
                        halfDiagonalRails.push(entity)
                    }
                    break
                case 'rail-signal':
                case 'rail-chain-signal':
                    signal = entity
                    break
                default:
                    otherEntities = true
            }
        }

        const sameDirStrRails = straightRails.some(rail => rail.direction % 8 === direction % 8)
        const sameDirHalfDiagRails = halfDiagonalRails.some(
            rail => rail.direction % 8 === direction % 8
        )

        const aRailCanHoldASignal =
            (curvedRail !== undefined && canHoldASignalOnItsTiles(curvedRail)) ||
            straightRails.some(canHoldASignalOnItsTiles) ||
            halfDiagonalRails.some(canHoldASignalOnItsTiles)

        const isGate = name === 'gate'
        const isSignal = name === 'rail-signal' || name === 'rail-chain-signal'
        const isStraightRail = name === 'legacy-straight-rail' || name === 'straight-rail'
        const isHalfDiagonalRail = name === 'half-diagonal-rail'
        const isCurvedRail =
            name === 'legacy-curved-rail' || name === 'curved-rail-a' || name === 'curved-rail-b'

        if (
            isGate &&
            straightRails.length === 1 &&
            railTakesGates(straightRails[0].name, straightRails[0].direction) &&
            straightRails[0].direction % 8 !== direction % 8 &&
            !gate
        )
            return true

        if (
            isStraightRail &&
            gate &&
            railTakesGates(name, direction) &&
            gate.direction % 8 !== direction % 8 &&
            straightRails.length === 0 &&
            !otherEntities
        )
            return true

        if (isStraightRail && straightRails.length > 0 && !sameDirStrRails && !gate) return true

        if (isHalfDiagonalRail && halfDiagonalRails.length > 0 && !sameDirHalfDiagRails) return true

        if (isCurvedRail && straightRails.length > 0 && !gate) return true

        if (isHalfDiagonalRail && straightRails.length > 0 && !gate) return true

        if (isCurvedRail && halfDiagonalRails.length > 0) return true

        if (isStraightRail && halfDiagonalRails.length > 0) return true

        if (isStraightRail && curvedRail) return true

        if (isHalfDiagonalRail && curvedRail) return true

        if (isCurvedRail && curvedRail && curvedRail.direction !== direction) return true

        /*
            A signal only gets this far when its tile overlaps something, since
            the isAreaEmpty check above already passed everything else. So this
            decides exactly one question: may a signal sit on a rail's own tiles.
            Measured per prototype rather than assumed - see
            canHoldASignalOnItsTiles.

            Answering false where the game does is what stops the editor writing
            a blueprint it cannot build. Measured end to end: a signal moved onto
            a straight-rail imports at code 0 and survives get_blueprint_entities,
            so nothing rejects the string - but with the rail on the ground the
            game accepts the signal at that position in none of its 16
            directions, where the unmutated control accepts it. The entity is
            lost at build time, silently, which is the one failure mode a
            permissive editor cannot argue its way out of.
        */
        if (isSignal) return aRailCanHoldASignal

        /*
            The converse stays permissive, deliberately. A signal beside a rail
            blocks 88 of the 768 neighbouring rail placements the game otherwise
            accepts, and an integer tile grid cannot tell which 88 - the signal
            occupies one tile and the answer depends on where along the rail it
            sits. Refusing all 768 to catch 88 would cost far more than it saves,
            so the editor accepts more than the game does here and says so.
        */
        if ((isStraightRail || isHalfDiagonalRail || isCurvedRail) && signal) return true

        return false
    }

    public checkFastReplaceableGroup(
        name: string,
        direction: number,
        pos: IPoint
    ): Entity | undefined {
        const fd = FD.entities[name]
        const size = getEntitySize(fd, direction)
        const area = {
            x: pos.x,
            y: pos.y,
            w: size.x,
            h: size.y,
        }

        if (this.sharesCell(area)) return undefined
        const entity = this.findInArea(area, entity => {
            const group = entity.entityData.fast_replaceable_group
            // both being absent must not read as a match, hence the truthiness check
            return entity.name !== name && !!group && group === fd.fast_replaceable_group
        })
        if (!entity || pos.x !== entity.position.x || pos.y !== entity.position.y) return undefined
        return entity
    }

    public checkSameEntityAndDifferentDirection(
        name: string,
        direction: number,
        pos: IPoint
    ): Entity | undefined {
        if (
            name === 'legacy-straight-rail' ||
            name === 'straight-rail' ||
            name === 'half-diagonal-rail'
        )
            return undefined

        const size = getEntitySize(FD.entities[name], direction)
        const area = {
            x: pos.x,
            y: pos.y,
            w: size.x,
            h: size.y,
        }

        if (this.sharesCell(area)) return undefined
        const entity = this.findInArea(area, entity => entity.name === name)

        if (
            !entity ||
            pos.x !== entity.position.x ||
            pos.y !== entity.position.y ||
            entity.direction === direction
        ) {
            return undefined
        }
        return entity
    }

    public getOpposingEntity(
        name: string,
        direction: number,
        position: IPoint,
        searchDirection: number,
        maxDistance: number | undefined
    ): number | undefined {
        // no reach to search along; the loop below already expressed this by not running
        if (maxDistance === undefined) return undefined

        const horizontal = searchDirection % 4 !== 0
        const sign = searchDirection === 0 || searchDirection === 6 ? -1 : 1

        for (let i = 1; i <= maxDistance; i++) {
            const X = Math.floor(position.x) + (horizontal ? i * sign : 0)
            const Y = Math.floor(position.y) + (horizontal ? 0 : i * sign)
            const cell = this.grid.get(`${X},${Y}`)

            if (typeof cell === 'number') {
                const entity = this.entityAt(cell)
                if (entity.name === name) {
                    if (entity.direction === direction) return cell
                    if ((entity.direction + 8) % 16 === direction) return undefined
                }
            }
        }

        return undefined
    }

    /** Returns true if any of the cells in the area are an array */
    public sharesCell(area: IArea): boolean {
        let hasArrayCell = false
        this.tileDataAction(area, (_, cell) => {
            if (typeof cell !== 'number') {
                hasArrayCell = true
                return true
            }
        })
        return hasArrayCell
    }

    public isAreaEmpty(area: IArea): boolean {
        let empty = true
        this.tileDataAction(area, () => {
            empty = false
            return true
        })
        return empty
    }

    /** Returns the first entity in the area matching fn, or undefined if none does */
    public findInArea(area: IArea, fn: (entity: Entity) => boolean): Entity | undefined {
        let entity: Entity | undefined
        this.tileDataAction(area, (_, cell) => {
            if (typeof cell === 'number') {
                const ent = this.entityAt(cell)
                if (fn(ent)) {
                    entity = ent
                    return true
                }
            } else {
                for (const v of cell) {
                    const ent = this.entityAt(v)
                    if (fn(ent)) {
                        entity = ent
                        return true
                    }
                }
            }
        })
        return entity
    }

    /** Returns all entities in the area */
    public getEntitiesInArea(area: IArea): Entity[] {
        const entities = new Set<Entity>()
        this.tileDataAction(area, (_, cell) => {
            if (typeof cell === 'number') {
                entities.add(this.entityAt(cell))
            } else {
                for (const v of cell) {
                    entities.add(this.entityAt(v))
                }
            }
        })
        return [...entities]
    }

    public getSurroundingEntities(area: IArea): Entity[] {
        const A = processArea(area)

        const coordinates = []

        for (let i = 0; i < A.w; i++) {
            coordinates.push([A.x + i, A.y - 1])
            coordinates.push([A.x + i, A.y + A.h])
        }
        for (let i = 0; i < A.h; i++) {
            coordinates.push([A.x + A.w, A.y + i])
            coordinates.push([A.x - 1, A.y + i])
        }

        // Corners
        coordinates.push([A.x - 1, A.y - 1])
        coordinates.push([A.x - 1, A.y + A.h])
        coordinates.push([A.x + A.w, A.y - 1])
        coordinates.push([A.x + A.w, A.y + A.h])

        return util
            .uniqueInArray(
                coordinates.reduce<number[]>((acc, coord) => {
                    const cell = this.grid.get(`${coord[0]},${coord[1]}`)
                    if (!cell) return acc
                    if (typeof cell === 'number') {
                        acc.push(cell)
                    } else {
                        acc.push(...cell)
                    }
                    return acc
                }, [])
            )
            .map(entNr => this.entityAt(entNr))
    }

    public getNeighbourData(point: IPoint): INeighbourData[] {
        return [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
        ].map((o, i) => {
            const x = Math.floor(point.x) + o.x
            const y = Math.floor(point.y) + o.y
            const cell = this.grid.get(`${x},${y}`)
            const entity = cell
                ? this.entityAt(typeof cell === 'number' ? cell : cell[cell.length - 1])
                : undefined
            return { x, y, relDir: i * 4, entity }
        })
    }
}
