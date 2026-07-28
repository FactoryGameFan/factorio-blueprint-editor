import { Container } from 'pixi.js'
import { DirectionType, IPoint } from '../types'
import FD, { getEntitySize, getPossibleRotations, isUndergroundBelt } from '../core/factorioData'
import { Entity } from '../core/Entity'
import { isRailSignal, RAIL_SEARCH_WINDOW, snapRailSignal } from '../core/railSignalSnapping'
import { RAIL_SIGNAL_SPOTS } from '../core/railSignalSpots'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { PaintContainer } from './PaintContainer'
import { BlueprintContainer } from './BlueprintContainer'

export class PaintEntityContainer extends PaintContainer {
    private visualizationArea: VisualizationArea
    private directionType: DirectionType
    private direction: number
    /** This is only a reference */
    private undergroundLine: Container | undefined
    /** Which rail a signal is currently snapped to, so R knows when to restart its cycle */
    private snapTarget: string | undefined
    /** How many legal spots R has stepped around the current rail */
    private snapRotation = 0

    public constructor(bpc: BlueprintContainer, name: string, direction: number) {
        super(bpc, name)

        this.direction = direction
        this.directionType = FD.entities[name].type === 'loader' ? 'output' : 'input'

        this.visualizationArea = this.bpc.underlayContainer.create(this.name, this.position)
        this.visualizationArea.highlight()
        this.bpc.underlayContainer.activateRelatedAreas(this.name)

        this.attachUpdateOn16()
        this.moveAtCursor()
        this.redraw()
    }

    private get size(): IPoint {
        return getEntitySize(FD.entities[this.name], this.direction)
    }

    public hide(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.hide()
    }

    public show(): void {
        this.bpc.underlayContainer.activateRelatedAreas(this.name)
        this.updateUndergroundLine()
        super.show()
    }

    public destroy(): void {
        this.visualizationArea.destroy()
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.destroy()
    }

    public override getItemName(): string {
        const itemName = Entity.getItemName(this.name)
        if (itemName === undefined) {
            throw new Error(`${this.name} is being painted but has no item to place it with`)
        }
        return itemName
    }

    private checkBuildable(): void {
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (
            this.bpc.bp.entityPositionGrid.checkFastReplaceableGroup(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)
        ) {
            this.blocked = false
        } else {
            this.blocked = true
        }
    }

    private updateUndergroundBeltRotation(): void {
        const fd = FD.entities[this.name]
        if (isUndergroundBelt(fd)) {
            /*
                getOpposingEntity answers an entity *number*, and the variable
                holding it was named as though it were the entity - which is how
                the resolve below ended up inside the branch, dereferencing a
                Map.get result that nothing had checked.

                Resolved before the branch instead, which is what both other
                callers of getOpposingEntity already do (Entity.rotate and
                OverlayContainer). Degrading rather than throwing matches them
                too: an unresolvable number lands in the same arm as no opposing
                entity at all, which is the arm that just leaves the direction
                type alone.
            */
            const opposingEntityNumber = this.bpc.bp.entityPositionGrid.getOpposingEntity(
                this.name,
                (this.direction + 8) % 16,
                {
                    x: this.x / 32,
                    y: this.y / 32,
                },
                this.direction,
                fd.max_distance
            )
            const otherEntity =
                opposingEntityNumber === undefined
                    ? undefined
                    : this.bpc.bp.entities.get(opposingEntityNumber)

            if (otherEntity) {
                this.directionType = otherEntity.directionType === 'input' ? 'output' : 'input'
            } else if (this.directionType === 'output') {
                this.directionType = 'input'
            }
            this.redraw()
        }
    }

    private updateUndergroundLine(): void {
        this.destroyUndergroundLine()
        this.undergroundLine = this.bpc.overlayContainer.createUndergroundLine(
            this.name,
            this.getGridPosition(),
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
            this.name === 'pipe-to-ground' ? (this.direction + 8) % 16 : this.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
        }
    }

    public override rotate(ccw = false): void {
        if (!this.visible) return

        /*
            A snapped signal rotates by stepping to the rail's next legal
            placement rather than by turning on the spot. Each spot is legal at
            exactly one direction, so cycling the 16 directions here would only
            ever produce facings the game refuses - and moveAtCursor would
            overwrite the new direction on the very next mouse move anyway.
        */
        if (isRailSignal(this.name) && this.snapTarget !== undefined) {
            this.snapRotation += ccw ? -1 : 1
            this.moveAtCursor()
            return
        }

        const pr = getPossibleRotations(FD.entities[this.name])
        if (pr.length === 0) return
        this.direction = pr[(pr.indexOf(this.direction) + (ccw ? 3 : 1)) % pr.length]

        this.redraw()
        this.moveAtCursor()
    }

    public override canFlipOrRotateByCopying(): boolean {
        return false
    }

    public override rotatedEntities(_ccw?: boolean): Entity[] {
        throw new Error('A single entity is not rotated by copying')
    }

    public override flippedEntities(_vertical: boolean): Entity[] {
        throw new Error('A single entity is not flipped by copying')
    }

    protected override redraw(): void {
        this.removeChildren()
        const sprites = EntitySprite.getParts({
            name: this.name,
            direction: this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
            directionType: this.directionType,
        })
        this.addChild(...sprites)
    }

    /**
     * Puts a rail signal on one of the positions the game will actually accept,
     * answering whether it did (issue #133 item 2).
     *
     * A signal is legal at 4 positions per rail - 5 on curved-rail-b, 2 on a
     * legacy-straight-rail at a diagonal - each at one fixed direction, and at
     * none at all away from a rail. So this sets the direction as well as the
     * position: there is no such thing as a legal position at a facing of the
     * user's choosing, and leaving the facing alone would snap the signal onto a
     * correct tile while it still pointed the wrong way.
     *
     * Answers false when no rail is near enough, which leaves the ordinary tile
     * snapping below in charge. Placing a signal in open ground is still
     * allowed - `isAreaAvailable` has not been made exact and #133 records why
     * that would be a bad trade - so this assists rather than enforces.
     */
    private snapToNearbyRail(): boolean {
        const cursor = { x: this.bpc.gridData.x / 32, y: this.bpc.gridData.y / 32 }

        /*
            The window comes from railSignalSnapping rather than being written
            down here, because it is a function of that module's distance limit
            and of how far a spot reaches from its rail - see RAIL_SEARCH_WINDOW.
            A literal here is a second, narrower distance limit, and a search
            that is too narrow fails by finding nothing rather than by looking
            wrong.
        */
        const rails = this.bpc.bp.entityPositionGrid
            .getEntitiesInArea({
                x: cursor.x,
                y: cursor.y,
                w: RAIL_SEARCH_WINDOW,
                h: RAIL_SEARCH_WINDOW,
            })
            .filter(entity => entity.name in RAIL_SIGNAL_SPOTS)
            .map(entity => ({
                name: entity.name,
                direction: entity.direction,
                position: entity.position,
            }))

        /*
            One call decides both which rail and which of its spots. Asking
            separately - a key first, a position after - meant two distance
            scans that had to agree, and mutation-checking found that breaking
            one of the two limits left the other silently in charge.

            Which rail gets picked does not depend on the rotation, so reading
            `target` off a call made with the current count is sound. Only when
            that names a *different* rail does the count get reset and the spot
            re-picked, which is the rare case rather than every mouse move.
        */
        let snapped = snapRailSignal(cursor, rails, this.snapRotation)
        if (snapped === undefined) {
            this.snapTarget = undefined
            return false
        }

        // Moving to a different rail restarts the cycle, so R always steps
        // around the rail under the cursor rather than continuing a count kept
        // from the last one.
        if (snapped.target !== this.snapTarget) {
            this.snapTarget = snapped.target
            this.snapRotation = 0
            snapped = snapRailSignal(cursor, rails, 0) ?? snapped
        }

        this.setPosition({ x: snapped.x * 32, y: snapped.y * 32 })
        if (this.direction !== snapped.direction) {
            this.direction = snapped.direction
            this.redraw()
        }
        return true
    }

    public override moveAtCursor(): void {
        if (!this.visible) return

        const railRelatedNames = [
            'legacy-straight-rail',
            'straight-rail',
            'half-diagonal-rail',
            'legacy-curved-rail',
            'curved-rail-a',
            'curved-rail-b',
            'train-stop',
        ]
        const firstRailPos = this.bpc.bp.getFirstRailRelatedEntityPos()

        if (isRailSignal(this.name) && this.snapToNearbyRail()) {
            // snapToNearbyRail placed it; fall through to the shared tail below
        } else if (railRelatedNames.includes(this.name) && firstRailPos) {
            // grid offsets
            const oX =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.x32) % 2) - (Math.abs(firstRailPos.x - 1) % 2)
                ) + 1
            const oY =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.y32) % 2) - (Math.abs(firstRailPos.y - 1) % 2)
                ) + 1

            this.setPosition({
                x: (this.bpc.gridData.x32 + oX) * 32,
                y: (this.bpc.gridData.y32 + oY) * 32,
            })
        } else {
            this.setNewPosition(this.size)
        }

        this.updateUndergroundBeltRotation()
        this.updateUndergroundLine()

        this.visualizationArea.moveTo(this.position)

        this.checkBuildable()
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        const entities = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
            ...this.getGridPosition(),
            w: this.size.x,
            h: this.size.y,
        })
        this.bpc.bp.removeEntities(entities)
        this.checkBuildable()
    }

    public override placeEntityContainer(): void {
        if (!this.visible) return

        const fd = FD.entities[this.name]
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (this.bpc.bp.fastReplaceEntity(this.name, direction, position)) return

        const snEnt = this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
            this.name,
            direction,
            position
        )
        if (snEnt) {
            snEnt.direction = direction
            return
        }

        if (this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)) {
            this.bpc.bp.createEntity(
                {
                    name: this.name,
                    position,
                    direction,
                    type:
                        fd.type === 'underground-belt' || fd.type === 'loader'
                            ? this.directionType
                            : undefined,
                },
                true
            )

            if (fd.type === 'underground-belt' || this.name === 'pipe-to-ground') {
                this.direction = (direction + 8) % 16
                this.redraw()
                this.destroyUndergroundLine()
            }
        }

        this.checkBuildable()
    }
}
