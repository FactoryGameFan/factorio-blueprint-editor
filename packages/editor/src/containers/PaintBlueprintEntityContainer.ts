import { Container } from 'pixi.js'
import F from '../UI/controls/functions'
import { IPoint } from '../types'
import { Entity } from '../core/Entity'
import { Blueprint } from '../core/Blueprint'
import util from '../common/util'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { BlueprintContainer } from './BlueprintContainer'
import { PaintBlueprintContainer } from './PaintBlueprintContainer'

export type BlueprintEntityPlacement =
    | { type: 'replace' }
    | { type: 'rotate' }
    | { type: 'create' }
    | { type: 'blocked' }

export class PaintBlueprintEntityContainer {
    private readonly pbpc: PaintBlueprintContainer
    private readonly bpc: BlueprintContainer
    private readonly bp: Blueprint
    private readonly entity: Entity
    private readonly visualizationArea: VisualizationArea
    public readonly entitySprites: EntitySprite[]
    /** This is only a reference */
    private undergroundLine: Container | undefined

    public constructor(
        pbpc: PaintBlueprintContainer,
        bpc: BlueprintContainer,
        bp: Blueprint,
        entity: Entity
    ) {
        this.pbpc = pbpc
        this.bpc = bpc
        this.bp = bp
        this.entity = entity

        this.visualizationArea = this.bpc.underlayContainer.create(this.entity.name, this.position)

        this.entitySprites = EntitySprite.getParts(
            this.entity,
            util.sumprod(32, this.entity.position),
            this.bp.entityPositionGrid
        )
    }

    private get entityPosition(): IPoint {
        return util.sumprod(1 / 32, this.pbpc.position, this.entity.position)
    }

    private get position(): IPoint {
        return util.sumprod(32, this.entity.position, this.pbpc.position)
    }

    public destroy(): void {
        this.visualizationArea.destroy()
        this.destroyUndergroundLine()
    }

    /**
     * The green/red tint on the preview. It asks planPlacement rather than
     * repeating its three grid questions, because the preview agreeing with the
     * result is the whole point of the planning split (issue #163): before it,
     * the tint was computed against the unmutated grid while placement ran
     * sequentially against a grid the previous entity had already changed, so a
     * second overlapping rail rendered green and was then silently dropped.
     *
     * Writing the expression out a second time here restores that hazard in a
     * quieter form - add an arm to planPlacement and not to the copy and the
     * preview lies about what a click will do. Nothing can catch it: no test in
     * the suite reads a sprite tint, so the agreement has to be structural.
     *
     * This costs nothing over the inline form. moveAtCursor calls it on every
     * pointer move, and planPlacement makes the same three grid calls in the
     * same order and short-circuits the same way.
     */
    private checkBuildable(): void {
        const allow = this.planPlacement().type !== 'blocked'

        for (const s of this.entitySprites) {
            F.applyTint(s, {
                r: allow ? 0.4 : 1,
                g: allow ? 1 : 0.4,
                b: 0.4,
                a: 1,
            })
        }
    }

    private updateUndergroundLine(): void {
        this.destroyUndergroundLine()
        this.undergroundLine = this.bpc.overlayContainer.createUndergroundLine(
            this.entity.name,
            this.entityPosition,
            this.entity.directionType === 'input'
                ? this.entity.direction
                : (this.entity.direction + 8) % 16,
            this.entity.type === 'pipe-to-ground' || this.entity.directionType === 'output'
                ? (this.entity.direction + 8) % 16
                : this.entity.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
        }
    }

    public moveAtCursor(): void {
        this.updateUndergroundLine()

        this.visualizationArea.moveTo(this.position)

        this.checkBuildable()
    }

    public removeContainerUnder(): void {
        const size = this.entity.size

        const entities = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
            ...this.entityPosition,
            w: size.x,
            h: size.y,
        })
        this.bpc.bp.removeEntities(entities)
        this.checkBuildable()
    }

    /** Planned against the destination grid before any entity in this paste is placed. */
    public planPlacement(): BlueprintEntityPlacement {
        const position = this.entityPosition
        const direction = this.entity.direction
        const grid = this.bpc.bp.entityPositionGrid

        const replacement = grid.checkFastReplaceableGroup(this.entity.name, direction, position)
        if (replacement) return { type: 'replace' }

        const rotated = grid.checkSameEntityAndDifferentDirection(
            this.entity.name,
            direction,
            position
        )
        if (rotated) return { type: 'rotate' }

        return grid.isAreaAvailable(this.entity.name, position, direction)
            ? { type: 'create' }
            : { type: 'blocked' }
    }

    /**
     * The entity this placed, or undefined where it placed none - which is the
     * normal outcome of three of the four paths below, not a failure. A fast
     * replace and a rotate-in-place both reuse an entity that already exists,
     * and an unavailable area places nothing at all.
     *
     * The one caller, PaintBlueprintContainer.placeEntityContainer, is building
     * an old-entity-number -> new-entity-number map to copy wires through, and
     * already skips the undefined: only a genuinely new entity has a new number
     * to map to.
     */
    public placeEntityContainer(placement: BlueprintEntityPlacement): Entity | undefined {
        const position = this.entityPosition
        const direction = this.entity.direction

        if (placement.type === 'replace') {
            this.bpc.bp.fastReplaceEntity(this.entity.name, direction, position)
            return undefined
        }

        if (placement.type === 'rotate') {
            const entity = this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
                this.entity.name,
                direction,
                position
            )
            if (entity) entity.direction = direction
            return undefined
        }

        let ent: Entity | undefined
        if (placement.type === 'create') {
            ent = this.bpc.bp.createEntity({
                ...this.entity.serialize(),
                entity_number: undefined,
                position,
            })
        }

        this.checkBuildable()

        return ent
    }
}
