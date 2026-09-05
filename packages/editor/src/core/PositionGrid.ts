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

/** One member of a group move: where it is going and which way it will face there. */
export interface GroupRelocation {
    entity: Entity
    position: IPoint
    direction: number
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
 * their tiles - all 16, 16 and 32 legal spots sit outside - so a signal the
 * editor's grid sees on top of one is a placement the game refuses outright.
 *
 * That legacy-curved-rail count was **20** when this rule was written, and the
 * difference is a measurement artefact rather than a change: rail-placement.json
 * swept a +/-3 tile window and that rail's legal spots reach 3.5, so it lost
 * between one and two of the four at every orientation. Re-measured at +/-7 in
 * tools/oracle/fixtures/rail-signal-spots.json, which also re-checks this
 * function against the complete table - it agrees on all 38 orientations,
 * because the spots the narrow window missed sit outside the rail's rectangle
 * too. The conclusion was right; the number it was drawn from was not.
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

/**
 * The four rail types that live on Factorio's elevated_rail collision layer.
 *
 * Keyed by entity **type**, which is what the classification below reads. The
 * `dummy-elevated-*` prototypes share these types and are ignored here for the
 * same reason nothing else looks at them - they cannot appear in a blueprint.
 */
const ELEVATED_RAIL_TYPES = new Set([
    'elevated-straight-rail',
    'elevated-half-diagonal-rail',
    'elevated-curved-rail-a',
    'elevated-curved-rail-b',
])

/**
 * Everything else that carries the elevated_rail layer, and so is the entire
 * set of things an elevated rail collides with (issue #133, item 4).
 *
 * Measured rather than reasoned about, because the Lua scatters this across a
 * `building_tall` helper, one per-type table entry and three individual
 * prototypes - see tools/oracle/fixtures/elevated-rail-collision.json, which
 * took it from the whole prototype table of the running binary instead. The
 * fixture's behaviour section then confirms the masks translate into placement:
 * a chest, a belt, a ground rail and a rail support are all placeable **under**
 * a standing elevated rail, and a rail ramp and a roboport are not, each
 * against an empty-ground control that came back true.
 *
 * Keyed by **name**, not by type. Only some members of a type carry the layer -
 * `oil-refinery` does and no other assembling machine does, `big-electric-pole`
 * does and no other electric pole does - so a type key would refuse far more
 * than the game.
 *
 * Two consequences of that keying, both deliberate. A name absent here is taken
 * not to collide, so a future prototype defaults to the permissive answer this
 * file's policy asks for rather than inheriting a restriction from a
 * measurement that never covered it. And `rail-support` is absent on purpose:
 * it holds an elevated rail up and therefore has to overlap one, which is a
 * control the probe asserts rather than an omission.
 *
 * `cargo-bay` is the one entry that is **not** in the 2.1.12 capture. It was
 * `building_tall()` at the 2.0.73 tag, which this editor targets, and is plain
 * `building()` at 2.1.12 - so it collides on the targeted version and not on
 * the measured one. Listed, because the cost of the two mistakes is not
 * symmetric: refusing a cargo bay under an elevated rail is an annoyance on
 * 2.1, where accepting one loses the entity at build time on 2.0.
 */
const COLLIDES_WITH_ELEVATED_RAILS = new Set([
    'agricultural-tower',
    'big-electric-pole',
    'cargo-bay',
    'cargo-landing-pad',
    'cargo-pod-container',
    'fulgoran-ruin-attractor',
    'lightning-collector',
    'lightning-rod',
    'oil-refinery',
    'rail-ramp',
    'roboport',
    'rocket-silo',
    'space-platform-hub',
])

/**
 * The orientation the game folds a rail's direction down to.
 *
 * Not uniform across the family, which is why the old blanket `% 8` could not
 * simply be dropped and could not be kept either. Measured over all sixteen
 * directions of all ten rail prototypes, in
 * tools/oracle/fixtures/rail-on-rail.json: straight-rail and half-diagonal-rail
 * fold to four orientations, the three curved types keep all eight, and
 * legacy-straight-rail keeps **six** - it folds 8 to 0 and 12 to 4 while
 * leaving 10 and 14 distinct from 2 and 6. The four elevated types fold exactly
 * as their ground namesakes do.
 *
 * Only the even directions are handled, which are the only ones reachable -
 * `getPossibleRotations` gives every rail [0,2,4,6,8,10,12,14] and the game
 * stores nothing else. The game also folds odd directions onto their even
 * neighbours and this does not; nothing produces one.
 */
const normaliseRailDirection = (name: string, direction: number): number => {
    switch (name) {
        case 'straight-rail':
        case 'elevated-straight-rail':
        case 'half-diagonal-rail':
        case 'elevated-half-diagonal-rail':
            return direction % 8
        case 'legacy-straight-rail':
            return direction % 4 === 0 ? direction % 8 : direction
        default:
            return direction
    }
}

const STRAIGHT_RAIL_NAMES = new Set([
    'straight-rail',
    'elevated-straight-rail',
    'legacy-straight-rail',
])

/**
 * Whether a rail already here occupies the cells a new one wants, which is the
 * only thing that should stop one rail being laid across another.
 *
 * The nine rail-versus-rail arms below used to answer this by family and
 * direction - same family, `direction % 8` equal - and never looked at the
 * prototype. Measured against the game over 1444 ordered pairs of
 * (type, orientation), that refused 84 placements it accepts, all of them at
 * directions the editor can produce, and it refused nothing it should have
 * allowed the other way: **not one** pair where the old arms said yes and the
 * game accepts no overlapping placement at all. So this is a fix in the
 * permissive direction only.
 *
 * The prototype name is not the discriminator on its own, which is the part
 * worth knowing before simplifying this. Two *cardinal* 2x2 rails fill their
 * shared tiles completely whichever prototypes they are, so a
 * legacy-straight-rail at direction 0 may not go on a straight-rail at
 * direction 0 - the game accepts nowhere. The same pair at a *diagonal*
 * orientation leaves the 2x2 mostly empty and the game accepts four overlapping
 * placements. A first draft keyed on the name alone and produced exactly those
 * four corruption-class rows, caught by re-running the measurement rather than
 * by a test.
 *
 * What stays refused and should not: an identical curved rail at an identical
 * direction, 24 rows of it, because a curved rail's rectangle holds a curve and
 * nothing on this grid can say which cells the curve uses. That is issue #133
 * item 1 and needs occupancy shapes, not another comparison here.
 */
const railOccupiesTheSameCells = (rail: Entity, name: string, direction: number): boolean => {
    const nd = normaliseRailDirection(name, direction)
    if (normaliseRailDirection(rail.name, rail.direction) !== nd) return false
    if (rail.name === name) return true
    return STRAIGHT_RAIL_NAMES.has(rail.name) && STRAIGHT_RAIL_NAMES.has(name) && nd % 4 === 0
}

/**
 * Whether two entities are on layers that can collide at all.
 *
 * False for exactly one pair: an elevated rail against something on the ground
 * that does not carry the elevated_rail layer. Everything else answers true, so
 * this widens what the grid accepts and never narrows it - the measured rules
 * below see the same entities they always did.
 */
const canCollide = (
    a: { name: string; type: string },
    b: { name: string; type: string }
): boolean => {
    const aIsElevated = ELEVATED_RAIL_TYPES.has(a.type)
    const bIsElevated = ELEVATED_RAIL_TYPES.has(b.type)
    if (aIsElevated === bIsElevated) return true
    const ground = aIsElevated ? b : a
    return COLLIDES_WITH_ELEVATED_RAILS.has(ground.name)
}

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
     * Whether every entity in the group may move by `delta` at once. See
     * `canGroupRelocate`, which this is the translation-only form of.
     */
    public canGroupMoveTo(entities: readonly Entity[], delta: IPoint): boolean {
        return this.canGroupRelocate(
            entities.map(entity => ({
                entity,
                position: { x: entity.position.x + delta.x, y: entity.position.y + delta.y },
                direction: entity.direction,
            }))
        )
    }

    /**
     * Whether every entity in the group may take its target at once.
     *
     * `canMoveTo` above answers for one entity by lifting only that entity out
     * of the grid before asking - so asked once per member of a group that is
     * moving together, it reports a member as blocked by a neighbour that is
     * itself about to move out of the way, and refuses a group whose members
     * trade places even though the group as a whole fits. Every member is
     * lifted out first here, then every target is checked against what
     * remains, and then every member is put back where it was.
     *
     * The put-back is in a `finally`: `isAreaAvailable` reads prototype data
     * that a stale name could make throw, and a throw between the lifts and the
     * restores would leave the grid missing entries for entities the blueprint
     * still holds - the drift `entityAt` exists to catch, caused by the check
     * that was meant to prevent a bad write.
     *
     * A check only. Nothing is written; the caller commits through
     * `Entity.relocate`, which is what lets it skip the per-member check the
     * `position` setter would otherwise repeat one member at a time.
     */
    public canGroupRelocate(targets: readonly GroupRelocation[]): boolean {
        for (const { entity } of targets) {
            this.removeTileData(entity)
        }
        try {
            return targets.every(({ entity, position, direction }) =>
                this.isAreaAvailable(entity.name, position, direction)
            )
        } finally {
            for (const { entity } of targets) {
                this.setTileData(entity)
            }
        }
    }

    /**
     * Whether an entity may be placed here - true means placeable.
     *
     * **The rail rules are permissive on purpose, and the exceptions are
     * measured** (issue #95). This grid keys integer tiles and Factorio does
     * not: a curved-rail-a is a 2x6 rectangle here holding a curve and a
     * half-diagonal-rail a 2x2 square against a collision box spanning roughly
     * 1.5x4.5. Modelling the real rules means per-rail collision shapes rather
     * than rectangles, which is its own piece of work - issue #133.
     *
     * The four elevated-* rail types are on their own collision layer rather
     * than their own geometry, so they are handled here (also #133): everything
     * in the area that cannot collide with what is being placed is filtered out
     * before the rules below run, which is what lets a ground entity sit under
     * an elevated rail and an elevated rail cross over one. See canCollide.
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
     *
     * One acceptance the layer filter cannot judge, and which stays permissive:
     * a rail signal on an elevated rail is the same **prototype** as one on the
     * ground - the game swaps its collision mask at runtime through the
     * `rail-signal/elevated` variant, and only Entity.railLayer knows which a
     * given signal is. This function is handed a name, so every signal is read
     * as a ground one and an elevated rail never blocks it.
     */
    public isAreaAvailable(name: string, pos: IPoint, direction = 0): boolean {
        const placed = { name, type: FD.entities[name].type }
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
        /*
            Anything that cannot collide with what is being placed is dropped
            here rather than being reasoned about below, which is the whole of
            the elevated rail fix: a ground entity under an elevated rail, and
            an elevated rail over a ground entity, both leave nothing behind and
            fall through to the empty-area answer. The filter only ever removes,
            so every rule after it sees what it always saw.

            An elevated rail that does survive - because a rail ramp or one of
            the tall buildings is being placed, or because the placed entity is
            itself an elevated rail - is classified into the same bucket as its
            ground namesake, so the measured rail-versus-rail rules apply within
            the elevated family exactly as they do on the ground. A bucket can
            only ever hold both layers at once when the placed entity carries
            the elevated layer *and* is not a rail, and no rail rule below fires
            for such a name.
        */
        const entitiesInArea = this.getEntitiesInArea(area).filter(entity =>
            canCollide(placed, entity)
        )
        if (entitiesInArea.length === 0) return true

        for (const entity of entitiesInArea) {
            switch (entity.type) {
                case 'gate':
                    gate = entity
                    break
                case 'legacy-curved-rail':
                case 'curved-rail-a':
                case 'curved-rail-b':
                case 'elevated-curved-rail-a':
                case 'elevated-curved-rail-b':
                    curvedRail = entity
                    break
                case 'legacy-straight-rail':
                case 'straight-rail':
                case 'elevated-straight-rail':
                    if (!straightRails.includes(entity)) {
                        straightRails.push(entity)
                    }
                    break
                case 'half-diagonal-rail':
                case 'elevated-half-diagonal-rail':
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

        const aStraightRailIsInTheWay = straightRails.some(rail =>
            railOccupiesTheSameCells(rail, name, direction)
        )
        const aHalfDiagonalRailIsInTheWay = halfDiagonalRails.some(rail =>
            railOccupiesTheSameCells(rail, name, direction)
        )

        const aRailCanHoldASignal =
            (curvedRail !== undefined && canHoldASignalOnItsTiles(curvedRail)) ||
            straightRails.some(canHoldASignalOnItsTiles) ||
            halfDiagonalRails.some(canHoldASignalOnItsTiles)

        /*
            The elevated names join their ground namesakes for the same reason
            the buckets above do. They are only ever weighed against rails of
            their own layer, since the filter has already separated the two.
        */
        const isGate = name === 'gate'
        const isSignal = name === 'rail-signal' || name === 'rail-chain-signal'
        const isStraightRail =
            name === 'legacy-straight-rail' ||
            name === 'straight-rail' ||
            name === 'elevated-straight-rail'
        const isHalfDiagonalRail =
            name === 'half-diagonal-rail' || name === 'elevated-half-diagonal-rail'
        const isCurvedRail =
            name === 'legacy-curved-rail' ||
            name === 'curved-rail-a' ||
            name === 'curved-rail-b' ||
            name === 'elevated-curved-rail-a' ||
            name === 'elevated-curved-rail-b'

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

        if (isStraightRail && straightRails.length > 0 && !aStraightRailIsInTheWay && !gate)
            return true

        if (isHalfDiagonalRail && halfDiagonalRails.length > 0 && !aHalfDiagonalRailIsInTheWay)
            return true

        if (isCurvedRail && straightRails.length > 0 && !gate) return true

        if (isHalfDiagonalRail && straightRails.length > 0 && !gate) return true

        if (isCurvedRail && halfDiagonalRails.length > 0) return true

        if (isStraightRail && halfDiagonalRails.length > 0) return true

        if (isStraightRail && curvedRail) return true

        if (isHalfDiagonalRail && curvedRail) return true

        if (isCurvedRail && curvedRail && !railOccupiesTheSameCells(curvedRail, name, direction))
            return true

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

    /**
     * The entity number of the underground partner of an entity, if it has one.
     *
     * Walks `searchDirection` one tile at a time out to `maxDistance`, and stops
     * at the first entity of the same name it meets: that entity is the partner
     * when it faces `direction`, and blocks the pair when it faces the opposite
     * way, exactly as Factorio's own underground connections do.
     *
     * `searchDirection` is a 16-way direction (north 0, east 4, south 8, west
     * 12), which is what all three callers pass. It used to be read as Factorio
     * 1.1's 8-way scheme - `searchDirection % 4 !== 0` for a horizontal search
     * and a negative step for 0 or 6 - and neither test survives the 16-way
     * values: every cardinal is a multiple of 4, so an east or west underground
     * searched along Y and could never find its partner, and 6 is not a
     * direction at all, so west searched towards +X (issue #329).
     */
    public getOpposingEntity(
        name: string,
        direction: number,
        position: IPoint,
        searchDirection: number,
        maxDistance: number | undefined
    ): number | undefined {
        // no reach to search along; the loop below already expressed this by not running
        if (maxDistance === undefined) return undefined

        const step = util.getDirOffset(searchDirection)
        // a diagonal has no axis to walk, so nothing can be its partner
        if (step === undefined) return undefined

        for (let i = 1; i <= maxDistance; i++) {
            const X = Math.floor(position.x) + step.x * i
            const Y = Math.floor(position.y) + step.y * i
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
