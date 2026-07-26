import { Container } from 'pixi.js'
import { IPoint } from '../types'
import FD, { isCraftingMachine } from '../core/factorioData'
import G from '../common/globals'
import { Entity } from '../core/Entity'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { CursorBoxSpecification } from 'factorio:prototype'

export class EntityContainer {
    public static readonly mappings: Map<number, EntityContainer> = new Map()

    /**
     * The container drawing `entityNumber`, for callers holding an entity that is
     * live in the current blueprint.
     *
     * `mappings` is an index into `bp.entities`, not an independent store:
     * `initBP` constructs a container for every entity and the constructor is the
     * only thing that writes, while the only delete is on that same entity's
     * `destroy`. So an entity reached through `bp.entityPositionGrid` or through a
     * stored wire connection always has a container, and a miss means the two have
     * drifted apart rather than that the caller asked for something reasonable -
     * the same signal `PositionGrid.entityAt` gives.
     *
     * `mappings` stays public for the lookups where absence is a real answer:
     * `OverlayContainer` asks about `entityForCopyData`, which is remembered
     * across the entity being deleted.
     */
    public static containerOf(entityNumber: number): EntityContainer {
        const ec = EntityContainer.mappings.get(entityNumber)
        if (ec === undefined) {
            throw new Error(`Entity ${entityNumber} has no container`)
        }
        return ec
    }

    private static _updateGroups: Map<string, Set<string>>
    private static get updateGroups(): Map<string, Set<string>> {
        if (!EntityContainer._updateGroups) {
            EntityContainer._updateGroups = EntityContainer.generateUpdateGroups()
        }
        return EntityContainer._updateGroups
    }

    private visualizationArea: VisualizationArea
    private entityInfo: Container | undefined
    private entitySprites: EntitySprite[] = []
    /** This is only a reference */
    private cursorBoxContainer: Container | undefined
    /** This is only a reference */
    private undergroundLine: Container | undefined

    private readonly m_Entity: Entity

    public constructor(entity: Entity, sort = true) {
        this.m_Entity = entity

        EntityContainer.mappings.set(this.m_Entity.entityNumber, this)

        this.visualizationArea = G.BPC.underlayContainer.create(this.m_Entity.name, this.position)
        this.entityInfo = G.BPC.overlayContainer.createEntityInfo(this.m_Entity, this.position)

        this.redraw(false, sort)
        if (sort) {
            this.redrawSurroundingEntities()
        }

        const onRecipeChange = (): void => {
            this.redrawEntityInfo()
            if (this.m_Entity.name === 'chemical-plant' || this.m_Entity.mayCraftWithFluid) {
                this.redraw()
                this.redrawSurroundingEntities()
            }
        }

        const onDirectionChange = (): void => {
            this.redraw()
            this.redrawSurroundingEntities()

            this.updateUndergroundLine()
            this.redrawEntityInfo()
            G.BPC.wiresContainer.update(this.m_Entity.entityNumber)
        }

        const onDirectionTypeChange = (): void => {
            this.redraw()
            this.redrawSurroundingEntities()

            this.updateUndergroundLine()
        }

        const onPositionChange = (newPos: IPoint, oldPos: IPoint): void => {
            this.redraw()
            this.redrawSurroundingEntities(oldPos)
            this.redrawSurroundingEntities(newPos)

            this.updateUndergroundLine()
            this.redrawEntityInfo()
            G.BPC.wiresContainer.update(this.m_Entity.entityNumber)
            this.visualizationArea.moveTo(this.position)
        }

        const onModulesChange = (): void => {
            this.redrawEntityInfo()
            if (this.m_Entity.type === 'beacon') {
                this.redraw()
            }
        }

        const onEntityDestroy = (): void => {
            this.redrawSurroundingEntities()

            for (const s of this.entitySprites) {
                s.destroy()
            }

            EntityContainer.mappings.delete(this.m_Entity.entityNumber)

            this.cursorBox = undefined

            this.visualizationArea.destroy()

            if (this.entityInfo !== undefined) {
                this.entityInfo.destroy()
            }
        }

        this.m_Entity.on('recipe', onRecipeChange)
        this.m_Entity.on('direction', onDirectionChange)
        this.m_Entity.on('directionType', onDirectionTypeChange)
        this.m_Entity.on('position', onPositionChange)
        this.m_Entity.on('modules', onModulesChange)

        this.m_Entity.on('filters', this.redrawEntityInfo, this)
        this.m_Entity.on('splitterInputPriority', this.redrawEntityInfo, this)
        this.m_Entity.on('splitterOutputPriority', this.redrawEntityInfo, this)

        this.m_Entity.on('destroy', onEntityDestroy)

        G.BPC.on('destroyed', () => {
            this.m_Entity.off('recipe', onRecipeChange)
            this.m_Entity.off('direction', onDirectionChange)
            this.m_Entity.off('directionType', onDirectionTypeChange)
            this.m_Entity.off('position', onPositionChange)
            this.m_Entity.off('modules', onModulesChange)

            this.m_Entity.off('filters', this.redrawEntityInfo, this)
            this.m_Entity.off('splitterInputPriority', this.redrawEntityInfo, this)
            this.m_Entity.off('splitterOutputPriority', this.redrawEntityInfo, this)

            this.m_Entity.off('destroy', onEntityDestroy)

            /*
                Replacing a blueprint never destroys the outgoing one's entities,
                so nothing else takes these out of the index (issue #42). The
                identity check is what makes this safe under the load ordering:
                Editor.loadBlueprint runs the new blueprint's initBP() *before*
                destroying the old container, so the new containers have already
                claimed the entity numbers they share - and a blanket delete here
                would remove the entries just written.
            */
            if (EntityContainer.mappings.get(this.m_Entity.entityNumber) === this) {
                EntityContainer.mappings.delete(this.m_Entity.entityNumber)
            }

            // Unlinking alone would leave these for the GC; the old container was
            // destroyed with pixi's default destroyChildren: false, so its sprites
            // are merely detached from the stage.
            for (const s of this.entitySprites) {
                s.destroy()
            }
            this.visualizationArea.destroy()
            if (this.entityInfo !== undefined) {
                this.entityInfo.destroy()
            }
        })
    }

    private static generateUpdateGroups(): Map<string, Set<string>> {
        const mappigs = [
            {
                is: [
                    'transport-belt',
                    'fast-transport-belt',
                    'express-transport-belt',
                    'turbo-transport-belt',
                    'splitter',
                    'fast-splitter',
                    'express-splitter',
                    'turbo-splitter',
                    'underground-belt',
                    'fast-underground-belt',
                    'express-underground-belt',
                    'turbo-underground-belt',
                    'loader',
                    'fast-loader',
                    'express-loader',
                    'turbo-loader',
                    'lane-splitter',
                ],
                updates: [
                    'transport-belt',
                    'fast-transport-belt',
                    'express-transport-belt',
                    'turbo-transport-belt',
                    'splitter',
                    'fast-splitter',
                    'express-splitter',
                    'turbo-splitter',
                    'underground-belt',
                    'fast-underground-belt',
                    'express-underground-belt',
                    'turbo-underground-belt',
                    'loader',
                    'fast-loader',
                    'express-loader',
                    'turbo-loader',
                    'lane-splitter',
                ],
            },
            {
                is: ['heat-pipe', 'nuclear-reactor', 'heat-exchanger', 'heat-interface'],
                updates: ['heat-pipe', 'nuclear-reactor', 'heat-exchanger', 'heat-interface'],
            },
            {
                has: ['fluid_box', 'output_fluid_box', 'fluid_boxes'],
                updates: ['fluid_box', 'output_fluid_box', 'fluid_boxes'],
            },
            {
                is: ['stone-wall', 'gate', 'legacy-straight-rail', 'straight-rail'],
                updates: ['stone-wall', 'gate', 'legacy-straight-rail', 'straight-rail'],
            },
            {
                is: ['cargo-bay', 'cargo-landing-pad'],
                updates: ['cargo-bay', 'cargo-landing-pad'],
            },
        ]

        return mappigs
            .map(uG => {
                if (!uG.has) return uG
                const entities = Object.values(FD.entities)
                return {
                    is: entities
                        .filter(e => Object.keys(e).find(k => uG.has.includes(k)))
                        .map(e => e.name),
                    updates: entities
                        .filter(e => Object.keys(e).find(k => uG.updates.includes(k)))
                        .map(e => e.name),
                }
            })
            .reduce<Map<string, Set<string>>>((map, cV) => {
                for (const k of cV.is) {
                    const updates = map.get(k)
                    if (updates === undefined) {
                        map.set(k, new Set(cV.updates))
                    } else {
                        for (const v of cV.updates) {
                            updates.add(v)
                        }
                    }
                }
                return map
            }, new Map())
    }

    public get entity(): Entity {
        return this.m_Entity
    }

    public get position(): IPoint {
        return {
            x: this.m_Entity.position.x * 32,
            y: this.m_Entity.position.y * 32,
        }
    }

    /** `undefined` removes the box, which is how every hover-out and mode exit clears it. */
    public set cursorBox(type: keyof CursorBoxSpecification | undefined) {
        if (this.cursorBoxContainer) {
            this.cursorBoxContainer.destroy()
            this.cursorBoxContainer = undefined
        }
        if (type !== undefined) {
            this.cursorBoxContainer = G.BPC.overlayContainer.createCursorBox(
                this.position,
                this.m_Entity.size,
                type
            )
        }
    }

    private createUndergroundLine(): void {
        this.undergroundLine = G.BPC.overlayContainer.createUndergroundLine(
            this.m_Entity.name,
            this.m_Entity.position,
            this.m_Entity.direction,
            this.m_Entity.directionType === 'output' || this.m_Entity.type === 'pipe-to-ground'
                ? (this.m_Entity.direction + 8) % 16
                : this.m_Entity.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
            this.undergroundLine = undefined
        }
    }

    private updateUndergroundLine(): void {
        if (G.BPC.hoverContainer === this) {
            this.destroyUndergroundLine()
            this.createUndergroundLine()
        }
    }

    private redrawEntityInfo(): void {
        if (
            this.m_Entity.moduleSlots !== 0 ||
            this.m_Entity.type === 'splitter' ||
            isCraftingMachine(this.m_Entity.entityData) ||
            this.m_Entity.type === 'mining-drill' ||
            this.m_Entity.type === 'boiler' ||
            this.m_Entity.type === 'generator' ||
            this.m_Entity.type === 'pump' ||
            this.m_Entity.type === 'offshore-pump' ||
            this.m_Entity.type === 'arithmetic-combinator' ||
            this.m_Entity.type === 'decider-combinator' ||
            this.m_Entity.type === 'inserter' ||
            this.m_Entity.type === 'logistic-container'
        ) {
            if (this.entityInfo !== undefined) {
                this.entityInfo.destroy()
            }
            this.entityInfo = G.BPC.overlayContainer.createEntityInfo(this.m_Entity, this.position)
        }

        G.UI.updateEntityInfoPanel(this.m_Entity)
    }

    public pointerOverEventHandler(): void {
        this.cursorBox = 'regular'
        this.createUndergroundLine()

        G.UI.updateEntityInfoPanel(this.m_Entity)
        this.visualizationArea.show()
    }

    public pointerOutEventHandler(): void {
        this.cursorBox = undefined
        this.destroyUndergroundLine()

        G.UI.updateEntityInfoPanel(undefined)
        this.visualizationArea.hide()
    }

    private redrawSurroundingEntities(position: IPoint = this.m_Entity.position): void {
        const updatesEntities = EntityContainer.updateGroups.get(this.m_Entity.name)
        if (!updatesEntities) return
        const area = {
            x: position.x,
            y: position.y,
            w: this.m_Entity.size.x,
            h: this.m_Entity.size.y,
        }
        if (
            this.m_Entity.type === 'legacy-straight-rail' ||
            this.m_Entity.type === 'straight-rail'
        ) {
            G.bp.entityPositionGrid
                .getEntitiesInArea(area)
                .filter(e => e.type === 'gate')
                .forEach(entity => EntityContainer.containerOf(entity.entityNumber).redraw())
        } else {
            const entities = G.bp.entityPositionGrid.getSurroundingEntities(area)

            // We need to update a larger area because belt endings might change
            if (
                this.m_Entity.type === 'transport-belt' ||
                this.m_Entity.type === 'splitter' ||
                this.m_Entity.type === 'underground-belt' ||
                this.m_Entity.type === 'loader'
            ) {
                entities.push(
                    ...G.bp.entityPositionGrid.getSurroundingEntities({
                        ...area,
                        w: area.w + 2,
                        h: area.h + 2,
                    })
                )
            }

            entities
                .filter(entity => updatesEntities.has(entity.name))
                .forEach(entity => {
                    EntityContainer.containerOf(entity.entityNumber).redraw()
                    if (entity.type === 'transport-belt') {
                        G.BPC.wiresContainer.update(entity.entityNumber)
                    }
                })
        }
    }

    public redraw(ignoreConnections?: boolean, sort?: boolean): void {
        for (const s of this.entitySprites) {
            s.destroy()
        }
        this.entitySprites = EntitySprite.getParts(
            this.m_Entity,
            this.position,
            ignoreConnections ? undefined : G.bp.entityPositionGrid
        )
        G.BPC.addEntitySprites(this.entitySprites, sort)
    }
}
