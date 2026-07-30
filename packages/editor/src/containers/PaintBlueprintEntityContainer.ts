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
    | { type: 'replace'; entity: Entity }
    | { type: 'rotate'; entity: Entity }
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

    private checkBuildable(): void {
        const position = this.entityPosition
        const direction = this.entity.direction

        const allow =
            this.bpc.bp.entityPositionGrid.checkFastReplaceableGroup(
                this.entity.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
                this.entity.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.isAreaAvailable(this.entity.name, position, direction)

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

    public planPlacement(): BlueprintEntityPlacement {
        const position = this.entityPosition
        const direction = this.entity.direction
        const grid = this.bpc.bp.entityPositionGrid

        const replacement = grid.checkFastReplaceableGroup(this.entity.name, direction, position)
        if (replacement) return { type: 'replace', entity: replacement }

        const rotated = grid.checkSameEntityAndDifferentDirection(
            this.entity.name,
            direction,
            position
        )
        if (rotated) return { type: 'rotate', entity: rotated }

        return grid.isAreaAvailable(this.entity.name, position, direction)
            ? { type: 'create' }
            : { type: 'blocked' }
    }

    public placeEntityContainer(placement = this.planPlacement()): Entity | undefined {
        const position = this.entityPosition
        const direction = this.entity.direction

        if (placement.type === 'replace') {
            this.bpc.bp.fastReplaceEntity(this.entity.name, direction, position, placement.entity)
            return undefined
        }

        if (placement.type === 'rotate') {
            placement.entity.direction = direction
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
