import { Container, Graphics, Sprite } from 'pixi.js'
import { IPoint } from '../types'
import FD, {
    getFluidBoxes,
    isCraftingMachine,
    isMiningDrill,
    isUndergroundBelt,
    hasModuleFunctionality,
    getModuleInventoryIndex,
    hasModuleIconsSuppressed,
} from '../core/factorioData'
import F from '../UI/controls/functions'
import G from '../common/globals'
import util from '../common/util'
import { Entity } from '../core/Entity'
import { EditorMode, BlueprintContainer } from './BlueprintContainer'
import { EntityContainer } from './EntityContainer'
import { CursorBoxSpecification } from 'factorio:prototype'
import { Sprite as SpriteData } from 'factorio:prototype'
import { need } from '../core/need'

/**
 * Every sprite this file draws is a utility sprite or an entity sprite that the
 * data export always supplies a `filename` for. The field is optional on the
 * prototype because a sprite may instead be multi-file (`filenames`), which is a
 * Space Age shape - none of the sprites read here are, so a missing filename is a
 * broken export rather than a case to handle, and need() says so by name.
 */
function textureOf(data: SpriteData): ReturnType<typeof G.getTexture> {
    return G.getTexture(need(data, 'filename'), data.x, data.y, data.width, data.height)
}

export class OverlayContainer extends Container {
    private readonly bpc: BlueprintContainer
    private readonly entityInfos = new Container()
    private readonly cursorBoxes = new Container()
    private readonly undergroundLines = new Container()
    private readonly selectionArea = new Graphics()
    private copyCursorBox: Container | undefined
    private selectionAreaUpdateFn: (endX: number, endY: number) => void

    public constructor(bpc: BlueprintContainer) {
        super()
        this.bpc = bpc

        this.addChild(this.entityInfos, this.cursorBoxes, this.undergroundLines, this.selectionArea)
    }

    /** undefined when the entity has nothing to draw, which is most of them. */
    public static createEntityInfo(entity: Entity, position: IPoint): Container | undefined {
        const entityInfo = new Container()

        if (
            entity.recipe &&
            isCraftingMachine(entity.entityData) &&
            (entity.entityData.show_recipe_icon === undefined || entity.entityData.show_recipe_icon)
        ) {
            /*
                icon_draw_specification is optional because Factorio has defaults
                for it, which the two lines below already implement - so read it
                through `?.` rather than need(). Throwing here would cost the
                entity its whole overlay, not just the recipe icon's placement.
            */
            const spec = entity.entityData.icon_draw_specification
            const shift = spec?.shift ? util.vectorToTuple(spec.shift) : [0, 0]
            const scale = spec?.scale || 1
            const recipeInfo = new Container()
            createIconWithBackground(recipeInfo, entity.recipe)
            recipeInfo.scale.set(scale)
            recipeInfo.position.set(shift[0] * 32, shift[1] * 32)
            entityInfo.addChild(recipeInfo)
        }

        {
            const fluidIcons = new Container()
            const arrows = new Container()

            const fbs = getFluidBoxes(
                entity.entityData,
                entity.assemblerHasFluidInputs || entity.assemblerHasFluidOutputs
            )
                .filter(
                    conn =>
                        !isCraftingMachine(entity.entityData) ||
                        (entity.assemblerHasFluidInputs && conn.production_type === 'input') ||
                        (entity.assemblerHasFluidOutputs && conn.production_type === 'output')
                )
                .filter(fb => !fb.hide_connection_info)

            for (const [i, fb] of fbs.entries()) {
                let filter = fb.filter
                if (isCraftingMachine(entity.entityData) && entity.recipe !== undefined) {
                    const recipe = FD.recipes[entity.recipe]
                    if (recipe) {
                        // Both are optional: a recipe can have no ingredients or no results.
                        const items =
                            (fb.production_type === 'input'
                                ? recipe.ingredients
                                : recipe.results) ?? []
                        const fluids = items
                            .filter(item => item.type === 'fluid')
                            .map(fluid => fluid.name)
                        filter = fluids[i >= fluids.length ? 0 : i]
                    }
                }

                for (const connection of fb.pipe_connections) {
                    if (
                        !(
                            connection.connection_type === undefined ||
                            connection.connection_type === 'normal'
                        )
                    )
                        continue

                    /*
                        `position` and `positions` are a discriminated union in the
                        data - across every pipe connection in data.json, exactly
                        one of the two is present, and `direction` is always there.
                        need() states that rather than inventing a fallback
                        direction, which would silently point an arrow the wrong way.
                    */
                    const dir = (entity.direction + need(connection, 'direction')) % 16
                    const offset = connection.position
                        ? util.rotatePointBasedOnDir(connection.position, entity.direction)
                        : util.Point(need(connection, 'positions')[entity.direction / 4])
                    const offset2 = util.rotatePointBasedOnDir([0, -0.5], dir)
                    offset2.x += offset.x
                    offset2.y += offset.y

                    const type =
                        connection.flow_direction === undefined ||
                        connection.flow_direction === 'input-output'
                            ? 2
                            : 1
                    const arrow = createArrow(util.sumprod(64, offset2), type)
                    arrow.rotation = dir * 0.125 * Math.PI
                    if (connection.flow_direction === 'input') {
                        arrow.rotation += Math.PI
                    }
                    arrows.addChild(arrow)

                    if (filter) {
                        createIconWithBackground(fluidIcons, filter, {
                            x: offset.x * 64,
                            y: offset.y * 64,
                        })
                    }
                }
            }

            fluidIcons.scale.set(0.5, 0.5)
            if (fluidIcons.children.length !== 0) {
                entityInfo.addChild(fluidIcons)
            }
            arrows.scale.set(0.5, 0.5)
            if (arrows.children.length !== 0) {
                entityInfo.addChild(arrows)
            }
        }

        const modules = entity.modules
        const e = entity.entityData
        if (
            modules.filter(m => m).length !== 0 &&
            hasModuleFunctionality(e) &&
            !hasModuleIconsSuppressed(e)
        ) {
            // Absent means none, and `undefined > 0` was already false here.
            const module_slots = e.module_slots ?? 0
            if (module_slots > 0) {
                const moduleInfo = new Container()
                const icons_positioning = e.icons_positioning || []
                const module_icon_positioning = icons_positioning.find(
                    ip => ip.inventory_index === getModuleInventoryIndex(e)
                )

                const shift = module_icon_positioning?.shift
                    ? util.vectorToTuple(module_icon_positioning.shift)
                    : [0, 0.7]
                const scale = module_icon_positioning?.scale || 0.5
                const separation_multiplier = module_icon_positioning?.separation_multiplier || 1.1
                for (let slot = 0; slot < module_slots; slot++) {
                    // Bound to a local so the truthiness check narrows it; an
                    // indexed read does not stay narrowed across the call.
                    const module = modules[slot]
                    if (module) {
                        createIconWithBackground(moduleInfo, module, {
                            x: slot * 32 * separation_multiplier,
                            y: 0,
                        })
                    }
                }
                moduleInfo.scale.set(scale)
                moduleInfo.position.set(
                    shift[0] * 32 - module_slots * 8 * separation_multiplier + 8,
                    shift[1] * 32
                )
                entityInfo.addChild(moduleInfo)
            }
        }

        const filters =
            entity.filters === undefined
                ? undefined
                : entity.filters.filter(v => v.name !== undefined)
        if (
            filters !== undefined &&
            (entity.type === 'inserter' ||
                entity.type === 'logistic-container' ||
                entity.type === 'infinity-container' ||
                entity.type === 'infinity-pipe')
        ) {
            const filterInfo = new Container()
            for (let i = 0; i < filters.length; i++) {
                if (i === 4) {
                    break
                }
                const filterName = filters[i].name
                if (filterName === undefined) {
                    break
                }

                createIconWithBackground(filterInfo, filterName, {
                    x: (i % 2) * 32 - (filters.length === 1 ? 0 : 16),
                    y: filters.length < 3 ? 0 : (i < 2 ? -1 : 1) * 16,
                })
            }
            let S = 0.5
            if (entity.type === 'inserter' && filters.length !== 1) {
                S = 0.4
            }
            if (entity.type === 'logistic-container' && filters.length === 1) {
                S = 0.6
            }
            filterInfo.scale.set(S, S)
            entityInfo.addChild(filterInfo)
        }

        const constantCombinatorFilters = entity.constantCombinatorFilters
        if (constantCombinatorFilters.length > 0) {
            const filterInfo = new Container()
            for (let i = 0; i < constantCombinatorFilters.length; i++) {
                if (i === 4) {
                    break
                }
                createIconWithBackground(filterInfo, constantCombinatorFilters[i], {
                    x: (i % 2) * 32 - (constantCombinatorFilters.length === 1 ? 0 : 16),
                    y: constantCombinatorFilters.length < 3 ? 0 : (i < 2 ? -1 : 1) * 16,
                })
            }
            filterInfo.scale.set(0.5, 0.5)
            entityInfo.addChild(filterInfo)
        }

        const combinatorConditions = entity.combinatorConditions
        if (combinatorConditions) {
            const filterInfo = new Container()
            const cFS = combinatorConditions.first_signal
            const cSS = combinatorConditions.second_signal
            const cOS = combinatorConditions.output_signal
            if (cFS && cFS.name) {
                createIconWithBackground(filterInfo, cFS.name, { x: cSS ? -16 : 0, y: -16 })
            }
            if (cSS && cSS.name) {
                createIconWithBackground(filterInfo, cSS.name, { x: 16, y: -16 })
            }
            if (cOS && cOS.name) {
                createIconWithBackground(filterInfo, cOS.name, { x: 0, y: 16 })
            }
            filterInfo.scale.set(0.5, 0.5)
            if (filterInfo.children.length !== 0) {
                entityInfo.addChild(filterInfo)
            }
        }

        if (entity.splitterInputPriority || entity.splitterOutputPriority) {
            const filterInfo = new Container()

            const createArrowForDirection = (direction: string, offsetY: number): void => {
                const arrow = createArrow(
                    util.rotatePointBasedOnDir(
                        { x: direction === 'right' ? 32 : -32, y: offsetY },
                        entity.direction
                    )
                )
                arrow.scale.set(0.75, 0.75)
                arrow.rotation = entity.direction * Math.PI * 0.125
                filterInfo.addChild(arrow)
            }

            if (entity.filters && entity.filters.length > 0) {
                /*
                    The guard stays on the filter list, not on the name, so this
                    branch still wins over the output-priority arrow below exactly
                    when it did before. A filter with no name drew a broken icon;
                    now it draws none.
                */
                const splitterFilter = entity.filters[0].name
                if (splitterFilter !== undefined) {
                    createIconWithBackground(
                        filterInfo,
                        splitterFilter,
                        util.rotatePointBasedOnDir(
                            { x: entity.splitterOutputPriority === 'right' ? 32 : -32, y: 0 },
                            entity.direction
                        )
                    )
                }
            } else if (entity.splitterOutputPriority) {
                createArrowForDirection(entity.splitterOutputPriority, -16)
            }
            if (entity.splitterInputPriority) {
                createArrowForDirection(entity.splitterInputPriority, 16)
            }
            filterInfo.scale.set(0.5, 0.5)
            entityInfo.addChild(filterInfo)
        }

        if (
            entity.type === 'arithmetic-combinator' ||
            entity.type === 'decider-combinator' ||
            entity.type === 'selector-combinator'
        ) {
            const arrows = new Container()
            arrows.addChild(createArrow({ x: 0, y: -48 }), createArrow({ x: 0, y: 48 }))
            arrows.rotation = entity.direction * Math.PI * 0.125
            arrows.scale.set(0.5, 0.5)
            entityInfo.addChild(arrows)
        }

        const drillData = entity.entityData
        if (
            entity.type === 'mining-drill' &&
            entity.name !== 'pumpjack' &&
            isMiningDrill(drillData)
        ) {
            const arrows = new Container()
            const placeResult = util.vectorToTuple(drillData.vector_to_place_result)
            arrows.addChild(
                createArrow({
                    x: placeResult[0] * 64,
                    y: placeResult[1] * 64 + 18,
                })
            )
            arrows.rotation = entity.direction * Math.PI * 0.125
            arrows.scale.set(0.5, 0.5)
            entityInfo.addChild(arrows)
        }

        if (entityInfo.children.length !== 0) {
            entityInfo.position.set(position.x, position.y)
            return entityInfo
        }

        function createIconWithBackground(
            container: Container,
            itemName: string,
            position?: IPoint
        ): void {
            const icon = F.CreateIcon(itemName, undefined, true, true)
            const background = new Sprite(textureOf(FD.utilitySprites.entity_info_dark_background))
            background.anchor.set(0.5, 0.5)
            if (position) {
                icon.position.set(position.x, position.y)
                background.position.set(position.x, position.y)
            }
            const lastLength = container.children.length
            container.addChild(background, icon)
            if (lastLength !== 0) {
                container.swapChildren(
                    container.getChildAt(lastLength / 2),
                    container.getChildAt(lastLength)
                )
            }
        }

        // Narrowing the parameter to the three cases makes the switch exhaustive,
        // so it needs no default and cannot fall off the end returning undefined.
        function createArrow(position: IPoint, type: 0 | 1 | 2 = 0): Sprite {
            const typeToPath = (type: 0 | 1 | 2): SpriteData => {
                switch (type) {
                    case 0:
                        return FD.utilitySprites.indication_arrow
                    case 1:
                        return FD.utilitySprites.fluid_indication_arrow
                    case 2:
                        return FD.utilitySprites.fluid_indication_arrow_both_ways
                }
            }
            const arrow = new Sprite(textureOf(typeToPath(type)))
            arrow.anchor.set(0.5, 0.5)
            arrow.position.set(position.x, position.y)
            return arrow
        }
    }

    public updateCopyCursorBox(forceDisable = false): void {
        if (
            !forceDisable &&
            this.bpc.mode === EditorMode.EDIT &&
            this.copyCursorBox === undefined &&
            this.bpc.hoverContainer !== undefined &&
            this.bpc.entityForCopyData !== undefined &&
            EntityContainer.mappings.has(this.bpc.entityForCopyData.entityNumber) &&
            this.bpc.hoverContainer.entity.canPasteSettings(this.bpc.entityForCopyData)
        ) {
            // The condition above already established the mapping exists, but the
            // lookup has to be bound before it narrows.
            const srcEnt = EntityContainer.mappings.get(this.bpc.entityForCopyData.entityNumber)
            if (srcEnt !== undefined) {
                this.copyCursorBox = this.createCursorBox(
                    srcEnt.position,
                    this.bpc.entityForCopyData.size,
                    'copy'
                )
            }
        } else if (this.copyCursorBox !== undefined) {
            this.copyCursorBox.destroy()
            this.copyCursorBox = undefined
        }
    }

    public toggleEntityInfoVisibility(): void {
        this.entityInfos.visible = !this.entityInfos.visible
    }

    public createEntityInfo(entity: Entity, position: IPoint): Container | undefined {
        try {
            const entityInfo = OverlayContainer.createEntityInfo(entity, position)
            if (entityInfo !== undefined) {
                this.entityInfos.addChild(entityInfo)
                return entityInfo
            }
        } catch (e) {
            console.warn(`Failed to create entity info for ${entity.name}:`, e)
        }
    }

    public createCursorBox(
        position: IPoint,
        size: IPoint,
        type: keyof CursorBoxSpecification = 'regular'
    ): Container {
        const cursorBox = new Container()
        cursorBox.scale.set(0.5, 0.5)
        cursorBox.position.set(position.x, position.y)
        this.cursorBoxes.addChild(cursorBox)

        if (size.x === 1 && size.y === 1) {
            const s = new Sprite(textureOf(FD.utilitySprites.cursor_box[type][0].sprite))
            s.anchor.set(0.5, 0.5)
            cursorBox.addChild(s)
        } else {
            cursorBox.addChild(...createCorners(Math.min(size.x, size.y)))
        }

        return cursorBox

        function createCorners(minSideLength: number): Sprite[] {
            const boxes = FD.utilitySprites.cursor_box[type]
            // An entry with no max_side_length never matched before either, since
            // `undefined > n` is false - it just falls through to the last box.
            const box =
                boxes.find(
                    t => t.max_side_length !== undefined && t.max_side_length > minSideLength
                )?.sprite ?? need(boxes[boxes.length - 1], 'sprite')
            const texture = textureOf(box)

            const c0 = new Sprite(texture)
            const c1 = new Sprite(texture)
            const c2 = new Sprite(texture)
            const c3 = new Sprite(texture)
            const X = size.x * 32
            const Y = size.y * 32
            c0.position.set(-X, -Y)
            c1.position.set(X, -Y)
            c2.position.set(-X, Y)
            c3.position.set(X, Y)
            c1.rotation = Math.PI * 0.5
            c2.rotation = Math.PI * 1.5
            c3.rotation = Math.PI
            return [c0, c1, c2, c3]
        }
    }

    public createUndergroundLine(
        name: string,
        position: IPoint,
        direction: number,
        searchDirection: number
        /*
            undefined whenever there is no line to draw: the entity is not an
            underground, has no partner in range, or the partner faces the same
            way. Every caller already stores the result in a `Container |
            undefined` field and checks it.
        */
    ): Container | undefined {
        const fd = FD.entities[name]
        if (fd.type === 'underground-belt' || fd.type === 'pipe-to-ground') {
            const opposingEntityNumber = this.bpc.bp.entityPositionGrid.getOpposingEntity(
                name,
                fd.type === 'pipe-to-ground' ? searchDirection : direction,
                position,
                searchDirection,
                (isUndergroundBelt(fd) ? fd.max_distance : undefined) || 10
            )
            const otherEntity =
                opposingEntityNumber === undefined
                    ? undefined
                    : this.bpc.bp.entities.get(opposingEntityNumber)

            if (otherEntity) {
                // Return if directionTypes are the same
                if (
                    fd.type === 'underground-belt' &&
                    (otherEntity.directionType === 'input'
                        ? otherEntity.direction
                        : otherEntity.direction + (8 % 16)) === searchDirection
                ) {
                    return
                }

                const searchingAlongY = searchDirection % 4 === 0
                const distance = searchingAlongY
                    ? Math.abs(otherEntity.position.y - position.y)
                    : Math.abs(otherEntity.position.x - position.x)

                const sign = searchDirection === 0 || searchDirection === 6 ? -1 : 1

                const lineParts = new Container()
                lineParts.x = position.x * 32
                lineParts.y = position.y * 32
                this.undergroundLines.addChild(lineParts)

                const data = isUndergroundBelt(fd)
                    ? need(fd, 'underground_sprite')
                    : FD.utilitySprites.underground_pipe_connection

                for (let i = 1; i < distance; i++) {
                    const s = new Sprite(textureOf(data))
                    s.rotation = direction * Math.PI * 0.125
                    if (data.scale) {
                        s.scale.set(data.scale)
                    }
                    s.anchor.set(0.5)
                    s.x = searchingAlongY ? 0 : sign * i * 32
                    s.y = searchingAlongY ? sign * i * 32 : 0
                    lineParts.addChild(s)
                }

                const otherEntityCursorBox = this.createCursorBox(
                    {
                        x: searchingAlongY ? 0 : sign * distance * 32,
                        y: searchingAlongY ? sign * distance * 32 : 0,
                    },
                    otherEntity.size,
                    'pair'
                )
                lineParts.addChild(otherEntityCursorBox)

                return lineParts
            }
        }
    }

    public showSelectionArea(color: number): void {
        const startPos = { x: this.bpc.gridData.x, y: this.bpc.gridData.y }

        this.selectionAreaUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x)
            const H = Math.abs(endY - startPos.y)

            this.selectionArea
                .clear()
                .moveTo(X, Y)
                .lineTo(X + W, Y)
                .lineTo(X + W, Y + H)
                .lineTo(X, Y + H)
                .lineTo(X, Y)
                .stroke({ width: 2 / this.bpc.getViewportScale(), color })
        }

        this.bpc.gridData.on('update', this.selectionAreaUpdateFn, this)
    }

    public hideSelectionArea(): void {
        this.selectionArea.clear()
        this.bpc.gridData.off('update', this.selectionAreaUpdateFn, this)
    }
}
