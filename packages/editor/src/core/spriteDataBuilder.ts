/*
    Entity rendering. `generateGraphics` dispatches on prototype `type` to a
    `draw_*` function that returns `(data) => SpriteData[]` - the sprite layers
    for one facing. `getSpriteData` caches the returned closure per entity name
    and wraps *the closure* in a try/catch, so a throw at draw time degrades to a
    placeholder box.

    That try does not cover the factory. `generateGraphics(entity)` is called one
    line above it, so anything a `draw_*` throws before it returns its closure
    propagates out of `getSpriteData` uncaught - and neither `EntitySprite` nor
    `EntityContainer` has a try above that, so it loses the blueprint. Two do it
    today: `draw_mining_drill`, whose `switch (e.name)` is in the factory body,
    and `draw_furnace`, whose `need(e, 'graphics_set')` runs there. Keep new work
    that can throw - `need()` especially - inside the returned closure.

    Common `draw_*` patterns:

      Static layers            return () => e.picture.layers                 draw_container
      4-way animation          getAnimation(e.graphics_set.animation, dir)   draw_asteroid_collector
      Direction-indexed        e.sprites[getDirName(data.dir)].layers        draw_constant_combinator
      X-offset spritesheet     duplicateAndSetPropertyUsing(l,'x','width',   draw_electric_pole
                                 data.dir / 4)
      Y-offset spritesheet     duplicateAndSetPropertyUsing(l,'y','height',  draw_ammo_turret
                                 data.dir / 4)
      Multi-file (filenames)   l.filename = l.filenames[data.dir / 4]        draw_locomotive, draw_cargo_wagon
      Rail 8-way               e.pictures[getDirName8Way(dir)], pick keys    draw_rail
      Flatten picture array    e.graphics_set.picture.flatMap(p => p.layers) draw_cargo_bay
      Chargable graphics       e.chargable_graphics.picture.layers          draw_accumulator

    Two Space Age hazards, both because the DLC adds members to existing types:

    - A `draw_*` that switches on `e.name` needs a `default` arm that throws
      naming the entity. Falling off the end returns `undefined`, `getSpriteData`
      then calls it, and the failure is `graphicsFn is not a function`, which
      names neither the entity nor the cause (issue #29, `big-mining-drill`).
    - Which layer keys a prototype carries is per entity, not per type - ground
      rails have all five picture layers, elevated rails have no `ties`,
      `heating-tower` is a reactor with no `lower_layer_picture`. Probe
      `data.json` per entity rather than assuming a whole `type` matches. That
      decides the tool: `draw_rail` can read its keys through `need()` because
      every ground rail has all of them, while `draw_elevated_rail` has to
      `.filter(p => p !== undefined)` because they are not all there. Reaching
      for `need()` on a key this particular entity lacks is the way this bites.
*/
import util from '../common/util'
import {
    ArithmeticOperation,
    ComparatorString,
    IPoint,
    ISignal,
    SelectorCombinatorOperation,
} from '../types'
import FD, {
    ColorWithAlpha,
    getHeatBuffer,
    getEnergySource,
    getCircuitConnector,
    getEntitySize,
    getFluidBoxes,
    isCraftingMachine,
} from './factorioData'
import { PositionGrid } from './PositionGrid'
import { Entity } from './Entity'
import {
    dirLayers,
    layersOf,
    sheetOf,
    sheetsOf,
    fourWayAnimation,
    baseVisualisationLayers,
    toSpriteArray,
    dirEntry,
} from './spriteShape'
import {
    SpriteVariations,
    EntityWithOwnerPrototype,
    TransportBeltAnimationSetWithCorners,
    Sprite as SpriteData,
    HeatConnection,
    Sprite4Way,
    AccumulatorPrototype,
    AgriculturalTowerPrototype,
    AmmoTurretPrototype,
    ArithmeticCombinatorPrototype,
    ArtilleryTurretPrototype,
    ArtilleryWagonPrototype,
    AssemblingMachinePrototype,
    AsteroidCollectorPrototype,
    BeaconPrototype,
    BoilerPrototype,
    BurnerGeneratorPrototype,
    CargoBayPrototype,
    CargoLandingPadPrototype,
    CargoWagonPrototype,
    ConstantCombinatorPrototype,
    ContainerPrototype,
    DeciderCombinatorPrototype,
    DisplayPanelPrototype,
    ElectricEnergyInterfacePrototype,
    ElectricPolePrototype,
    ElectricTurretPrototype,
    ElevatedCurvedRailAPrototype,
    ElevatedCurvedRailBPrototype,
    ElevatedHalfDiagonalRailPrototype,
    ElevatedStraightRailPrototype,
    FluidTurretPrototype,
    FluidWagonPrototype,
    FurnacePrototype,
    FusionGeneratorPrototype,
    FusionReactorPrototype,
    GatePrototype,
    GeneratorPrototype,
    HeatInterfacePrototype,
    HeatPipePrototype,
    InfinityCargoWagonPrototype,
    InfinityContainerPrototype,
    InserterPrototype,
    LabPrototype,
    LampPrototype,
    LandMinePrototype,
    LaneSplitterPrototype,
    LightningAttractorPrototype,
    LinkedBeltPrototype,
    LinkedContainerPrototype,
    LoaderPrototype,
    LocomotivePrototype,
    LogisticContainerPrototype,
    MiningDrillPrototype,
    ModulePrototype,
    OffshorePumpPrototype,
    PipePrototype,
    PipeToGroundPrototype,
    PowerSwitchPrototype,
    ProgrammableSpeakerPrototype,
    ProxyContainerPrototype,
    PumpPrototype,
    RadarPrototype,
    RailRampPrototype,
    RailSignalBasePrototype,
    RailSupportPrototype,
    ReactorPrototype,
    RoboportPrototype,
    RocketSiloPrototype,
    SelectorCombinatorPrototype,
    SolarPanelPrototype,
    SpacePlatformHubPrototype,
    SplitterPrototype,
    StorageTankPrototype,
    ThrusterPrototype,
    TrainStopPrototype,
    TransportBeltPrototype,
    TurretPrototype,
    UndergroundBeltPrototype,
    ValvePrototype,
    WallPrototype,
    RailPrototype,
} from 'factorio:prototype'
import { Animation } from 'factorio:prototype'
import { Animation4Way } from 'factorio:prototype'
import { need } from './need'

/**
 * What a `draw_*` function gets to work with.
 *
 * Everything a caller can leave out is `| undefined` here rather than required,
 * because two of the four getParts call sites do leave things out - the paint
 * preview passes a bare `{ name, direction, directionType }` with no position
 * and no grid, and the entity editor preview passes an Entity but no grid. The
 * fields that stay required are the ones EntitySprite.getDrawData defaults, and
 * it defaults them because the alternative reads worse everywhere: `data.dir`
 * appears in `data.dir / 4` arithmetic throughout the file.
 */
export interface IDrawData {
    /** Defaulted to 0 (north) by getDrawData, matching what getParts already does. */
    dir: number

    name: string
    /** Absent when nothing was placed yet - the paint and editor previews. */
    positionGrid: PositionGrid | undefined
    /** Only meaningful alongside `positionGrid`; getDrawData defaults it to the origin. */
    position: IPoint
    /** Defaulted to false by getDrawData. */
    generateConnector: boolean

    displayPanelIcon: undefined | ISignal
    /** Defaulted to false by getDrawData. */
    assemblerHasFluidInputs: boolean
    /** Defaulted to false by getDrawData. */
    assemblerHasFluidOutputs: boolean
    /** Undefined for anything that is not an underground belt or loader. */
    dirType: string | undefined
    /** Defaulted to false by getDrawData. */
    selectorCombinatorSelectMax: boolean
    operator: undefined | ComparatorString | ArithmeticOperation | SelectorCombinatorOperation
    railLayer: string | undefined
    /** Undefined for a train stop left the default colour. */
    trainStopColor: ColorWithAlpha | undefined
    /** Defaulted to [] by getDrawData; an entry is undefined for an empty slot. */
    modules: (string | undefined)[]
}

export interface ExtendedSpriteData extends SpriteData {
    anchorX?: number
    anchorY?: number
    squishY?: number
    rotAngle?: number
}

/**
 * Sprite-sheet column metadata read off runtime sprites. typed-factorio carries
 * these only on specific sheet subtypes (and types `frames` as a struct array on
 * RotatedSprite), but data.json supplies plain frame/column counts here. Used as
 * a read-only cast target so we don't narrow these onto ExtendedSpriteData (which
 * would break its assignability from the base Sprite type).
 */
type SheetMeta = { size?: number; frames?: number; line_length?: number }

/**
 * Numeric sprite keys usable as a multiply source/target in the property
 * helpers. Adds `size` - a runtime scalar shorthand typed-factorio models as
 * `number | [w, h]` (so it's excluded from the numeric PickByType) but data.json
 * supplies as a number.
 */
type SpriteNumberKey = keyof PickByType<ExtendedSpriteData, number> | 'size'

export const SPRITE_GENERATION_FAILED = Symbol('SPRITE_GENERATION_FAILED')

const generatorCache = new Map<string, (data: IDrawData) => readonly ExtendedSpriteData[]>()

function getSpriteData(data: IDrawData): readonly ExtendedSpriteData[] {
    const cached = generatorCache.get(data.name)
    if (cached) {
        return cached(data)
    }

    const entity = FD.entities[data.name]
    if (!entity) {
        console.warn(`Entity '${data.name}' not found in FD.entities`)
        const failedGenerator = () => SPRITE_GENERATION_FAILED as any
        generatorCache.set(data.name, failedGenerator)
        return SPRITE_GENERATION_FAILED as any
    }
    const graphicsFn = generateGraphics(entity)
    const generator = (data: IDrawData): readonly ExtendedSpriteData[] => {
        try {
            return [
                ...graphicsFn(data),
                ...generateCovers(entity, data),
                ...generateConnection(entity, data),
            ]
        } catch (err) {
            console.warn(`Error generating sprites for '${data.name}' (type: ${entity.type}):`, err)
            return SPRITE_GENERATION_FAILED as any
        }
    }
    generatorCache.set(data.name, generator)

    return generator(data)
}

function generateConnection(e: EntityWithOwnerPrototype, data: IDrawData): readonly SpriteData[] {
    if (!data.generateConnector) return []
    const isLoaderInputting = () => data.dirType === 'input'
    const getBeltConnectionIndex = () =>
        getBeltWireConnectionIndex(data.positionGrid, data.position, data.dir)
    const cc = getCircuitConnector(e, data.dir, isLoaderInputting, getBeltConnectionIndex)
    if (cc?.sprites) {
        const ccs = cc.sprites
        // Not all three exist for every connector - a transport belt has no
        // connector_main - and the absent ones were previously passed through as
        // undefined for EntitySprite.getParts to skip
        return [ccs.connector_main, ccs.wire_pins, ccs.led_blue_off].filter(s => s !== undefined)
    }
    return []
}
// UTIL FUNCTIONS
function addToShift(shift: IPoint | readonly [number, number], tab: SpriteData): SpriteData {
    const SHIFT: readonly [number, number] = Array.isArray(shift) ? shift : [shift.x, shift.y]

    const prev = tab.shift ? util.vectorToTuple(tab.shift) : undefined
    tab.shift = prev ? [SHIFT[0] + prev[0], SHIFT[1] + prev[1]] : SHIFT

    return tab
}

function setProperty<K extends keyof ExtendedSpriteData>(
    img: ExtendedSpriteData,
    key: K,
    val: ExtendedSpriteData[K]
): ExtendedSpriteData {
    img[key] = val
    return img
}

/**
 * Optional properties are `Value | undefined`, which does not extend `Value`, so
 * matching on NonNullable is what keeps `width?: number` in the numeric set. Under
 * strictNullChecks the naive form picked nothing.
 */
type PickByType<T, Value> = {
    [P in keyof T as NonNullable<T[P]> extends Value ? P : never]: T[P]
}

function setPropertyUsing<K0 extends SpriteNumberKey, K1 extends SpriteNumberKey>(
    img: ExtendedSpriteData,
    key0: K0,
    key1: K1,
    mult = 1
): ExtendedSpriteData {
    if (key1) {
        // `size` is part of SpriteNumberKey but typed-factorio types it as
        // `number | [w, h]`; at these call sites it is always the scalar form.
        const rec = img as Record<SpriteNumberKey, number>
        rec[key0] = rec[key1] * mult
    }
    return img
}

function duplicateAndSetPropertyUsing<K0 extends SpriteNumberKey, K1 extends SpriteNumberKey>(
    img: ExtendedSpriteData,
    key0: K0,
    key1: K1,
    mult: number
): ExtendedSpriteData {
    return setPropertyUsing(util.duplicate(img), key0, key1, mult)
}

function generateCovers(e: EntityWithOwnerPrototype, data: IDrawData): readonly SpriteData[] {
    if (e.name === 'pipe' || e.name === 'infinity-pipe') {
        return []
    }

    const fbs = getFluidBoxes(e, data.assemblerHasFluidInputs || data.assemblerHasFluidOutputs)

    const output = []
    for (const fb of fbs) {
        const force_cover =
            isCraftingMachine(e) &&
            ((fb.production_type === 'input' && !data.assemblerHasFluidInputs) ||
                (fb.production_type === 'output' && !data.assemblerHasFluidOutputs))
        if (
            force_cover &&
            e.type === 'assembling-machine' &&
            (e as AssemblingMachinePrototype).fluid_boxes_off_when_no_fluid_recipe
        ) {
            continue
        }
        if (!fb.pipe_covers) continue
        for (const connection of fb.pipe_connections) {
            if (
                !(
                    connection.connection_type === undefined ||
                    connection.connection_type === 'normal'
                )
            )
                continue

            const dir = (data.dir + need(connection, 'direction')) % 16

            const offset = connection.position
                ? util.rotatePointBasedOnDir(connection.position, data.dir)
                : util.Point(need(connection, 'positions')[data.dir / 4])
            const offset2 = util.rotatePointBasedOnDir([0, -1], dir)
            offset.x += offset2.x
            offset.y += offset2.y

            const isConnected = () => {
                if (!data.positionGrid) return false
                const pos = {
                    x: Math.floor(data.position.x + offset.x),
                    y: Math.floor(data.position.y + offset.y),
                }
                const ent = data.positionGrid.getEntityAtPosition(pos)
                return ent && checkFluidConnection(pos.x, pos.y, ent, dir)
            }

            const needs_cover = force_cover || !isConnected()
            if (needs_cover) {
                let temp = dirLayers(fb.pipe_covers, util.getDirName(dir))[0]
                temp = addToShift(offset, util.duplicate(temp))
                output.push(temp)
            }
        }
    }
    return output
}

function checkFluidConnection(x: number, y: number, entity: Entity, relDir: number): boolean {
    const fbs = getFluidBoxes(
        entity.entityData,
        entity.assemblerHasFluidInputs || entity.assemblerHasFluidOutputs
    )
    const connections = fbs
        .filter(
            conn =>
                !isCraftingMachine(entity.entityData) ||
                (entity.assemblerHasFluidInputs && conn.production_type === 'input') ||
                (entity.assemblerHasFluidOutputs && conn.production_type === 'output')
        )
        .flatMap(fb => fb.pipe_connections)
        .filter(conn => conn.connection_type === undefined || conn.connection_type === 'normal')

    for (const connection of connections) {
        const offset = connection.position
            ? util.rotatePointBasedOnDir(connection.position, entity.direction)
            : util.Point(need(connection, 'positions')[entity.direction / 4])
        if (
            x === Math.floor(entity.position.x + offset.x) &&
            y === Math.floor(entity.position.y + offset.y) &&
            (entity.direction + need(connection, 'direction')) % 16 === (relDir + 8) % 16
        ) {
            return true
        }
    }

    return false
}

function getFluidConnections(position: IPoint, positionGrid: PositionGrid): boolean[] {
    return positionGrid.getNeighbourData(position).map(({ x, y, entity, relDir }) => {
        if (!entity) {
            return false
        }

        return checkFluidConnection(x, y, entity, relDir)
    })
}

function getHeatConnections(position: IPoint, positionGrid: PositionGrid): boolean[] {
    return positionGrid.getNeighbourData(position).map(({ x, y, entity }) => {
        if (!entity) {
            return false
        }

        const checkConnections = (connections: readonly HeatConnection[]): boolean => {
            return (
                connections
                    .map(conn => util.rotatePointBasedOnDir(conn.position, entity.direction))
                    .filter(
                        offset =>
                            x === Math.floor(entity.position.x + offset.x) &&
                            y === Math.floor(entity.position.y + offset.y)
                    ).length > 0
            )
        }

        // check for heat_buffer first since the reactor has both properties
        const heat_buffer = getHeatBuffer(entity.entityData)
        if (heat_buffer) {
            return checkConnections(need(heat_buffer, 'connections'))
        }

        const energy_source = getEnergySource(entity.entityData)
        if (energy_source) {
            if (energy_source.type === 'heat') {
                return checkConnections(need(energy_source, 'connections'))
            }
        }

        return false
    })
}

// X, H, V, SE, SW, NE and NW.
function getBeltWireConnectionIndex(
    positionGrid: PositionGrid | undefined,
    position: IPoint,
    dir: number
): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
    /*
        Reached from generateConnection for a transport belt, which the entity
        editor preview and the paint preview both draw without a grid. Nothing
        placed means no neighbouring belts, which is index 0 - the standalone
        connector, and the same answer this falls through to below.
    */
    if (!positionGrid) return 0
    let C = positionGrid.getNeighbourData(position).map(d => {
        if (
            d.entity &&
            (d.entity.type === 'transport-belt' ||
                d.entity.type === 'splitter' ||
                ((d.entity.type === 'underground-belt' || d.entity.type === 'loader') &&
                    d.entity.directionType === 'output')) &&
            d.entity.direction === (d.relDir + 8) % 16
        ) {
            return d
        }
    })
    // Rotate directions
    C = [...C, ...C].splice(dir / 4, 4)

    if (!C[1] && C[2] && !C[3]) {
        if (dir === 0 || dir === 8) {
            return 2
        }
        return 1
    }
    if (C[1] && !C[2] && !C[3]) {
        switch (dir) {
            case 0:
                return 5
            case 4:
                return 3
            case 8:
                return 4
            case 12:
                return 6
        }
    }
    if (!C[1] && !C[2] && C[3]) {
        switch (dir) {
            case 0:
                return 6
            case 4:
                return 5
            case 8:
                return 3
            case 12:
                return 4
        }
    }
    return 0
}

function getBeltSprites(
    bas: TransportBeltAnimationSetWithCorners,
    position: IPoint,
    direction: number,
    positionGrid?: PositionGrid,
    start = true,
    end = true,
    forceStraight = false
): readonly SpriteData[] {
    const parts = []

    if (positionGrid) {
        const conn = getConnForPos(positionGrid, position, direction, forceStraight)

        parts.push(getBeltSpriteFromData(bas, direction, conn.curve))

        if (start) {
            let spawn = true

            if (conn.from) {
                const C = getConnForPos(positionGrid, conn.from, conn.from.entity.direction)

                if (
                    (C.from &&
                        C.from.x === Math.floor(position.x) &&
                        C.from.y === Math.floor(position.y)) ||
                    (C.to && C.to.x === Math.floor(position.x) && C.to.y === Math.floor(position.y))
                ) {
                    spawn = false
                }
            }

            if (spawn) {
                parts.push(
                    addToShift(
                        util.rotatePointBasedOnDir([0, 1], direction),
                        getBeltSpriteFromData(bas, direction, 'start')
                    )
                )
            }
        }

        if (end) {
            let spawn = true

            if (conn.to) {
                const C = getConnForPos(positionGrid, conn.to, conn.to.entity.direction)
                if (
                    (C.from &&
                        C.from.x === Math.floor(position.x) &&
                        C.from.y === Math.floor(position.y)) ||
                    (C.to && C.to.x === Math.floor(position.x) && C.to.y === Math.floor(position.y))
                ) {
                    spawn = false
                }
            }

            if (spawn) {
                parts.push(
                    addToShift(
                        util.rotatePointBasedOnDir([0, -1], direction),
                        getBeltSpriteFromData(bas, direction, 'end')
                    )
                )
            }
        }
    } else {
        parts.push(getBeltSpriteFromData(bas, direction, 'straight'))

        if (start) {
            parts.push(
                addToShift(
                    util.rotatePointBasedOnDir([0, 1], direction),
                    getBeltSpriteFromData(bas, direction, 'start')
                )
            )
        }

        if (end) {
            parts.push(
                addToShift(
                    util.rotatePointBasedOnDir([0, -1], direction),
                    getBeltSpriteFromData(bas, direction, 'end')
                )
            )
        }
    }

    return parts

    type BeltShape = 'straight' | 'right' | 'left' | 'start' | 'end'

    interface IFromTo extends IPoint {
        /** Direction of this neighbour relative to the belt, as getNeighbourData gives it. */
        relDir: number
        entity: Entity
    }

    /*
        `from` and `to` are the neighbouring belts feeding this one and being fed
        by it, and either can be absent - a belt with nothing behind it has no
        `from`. Every caller already tests them (`if (conn.from)`, `C.from && ...`
        in getBeltSprites), so the optionality is what the code has always meant.
    */
    interface IConnection {
        from: IFromTo | undefined
        to: IFromTo | undefined
        curve: BeltShape
    }

    function getConnForPos(
        positionGrid: PositionGrid,
        pos: IPoint,
        direction: number,
        forceStraight = false
    ): IConnection {
        /*
            getNeighbourData's `entity` is undefined for an empty cell, so the
            entries that survive the type check carry one. Rebuilding the entry
            with the narrowed entity is what lets IFromTo keep saying `entity:
            Entity` rather than pushing the check onto everything downstream.
        */
        let C = positionGrid.getNeighbourData(pos).map((d): IFromTo | undefined => {
            const entity = d.entity
            if (
                entity &&
                (entity.type === 'transport-belt' ||
                    entity.type === 'splitter' ||
                    entity.type === 'underground-belt' ||
                    entity.type === 'loader')
            ) {
                return { ...d, entity }
            }
        })
        // Rotate based on belt direction
        C = [...C, ...C].splice(direction / 4, 4)

        // Belt facing this belt
        const C2 = C.map(d => {
            if (
                !d ||
                ((d.entity.type === 'underground-belt' || d.entity.type === 'loader') &&
                    d.entity.directionType === 'input')
            ) {
                return
            }
            if (d.entity.direction === (d.relDir + 8) % 16) {
                return d
            }
        })

        /*
            Every call site passes a position that holds a belt, so this is only
            `?.` rather than a throw because an empty cell answering "not a
            splitter" is the same answer the checks below want anyway.
        */
        const entAtPos = positionGrid.getEntityAtPosition(pos)
        if (
            forceStraight ||
            entAtPos?.type === 'splitter' ||
            entAtPos?.type === 'underground-belt' ||
            entAtPos?.type === 'loader'
        ) {
            return {
                from: C[2],
                to: C[0],
                curve: 'straight',
            }
        }

        if (C2[1] && !C2[3] && !C2[2]) {
            return {
                from: C[1],
                to: C[0],
                curve: 'right',
            }
        }
        if (C2[3] && !C2[1] && !C2[2]) {
            return {
                from: C[3],
                to: C[0],
                curve: 'left',
            }
        }
        return {
            from: C[2],
            to: C[0],
            curve: 'straight',
        }
    }

    function getBeltSpriteFromData(
        bas: TransportBeltAnimationSetWithCorners,
        dir: number,
        type: BeltShape
    ): SpriteData {
        return duplicateAndSetPropertyUsing(bas.animation_set, 'y', 'size', getIndex() - 1)

        function getIndex(): number {
            switch (type) {
                case 'straight':
                    switch (dir) {
                        case 0:
                            return bas.north_index || 3
                        case 4:
                            return bas.east_index || 1
                        case 8:
                            return bas.south_index || 4
                        case 12:
                            return bas.west_index || 2
                    }
                    break
                case 'right':
                    switch (dir) {
                        case 0:
                            return bas.east_to_north_index || 5
                        case 4:
                            return bas.south_to_east_index || 9
                        case 8:
                            return bas.west_to_south_index || 12
                        case 12:
                            return bas.north_to_west_index || 8
                    }
                    break
                case 'left':
                    switch (dir) {
                        case 0:
                            return bas.west_to_north_index || 7
                        case 4:
                            return bas.north_to_east_index || 6
                        case 8:
                            return bas.east_to_south_index || 10
                        case 12:
                            return bas.south_to_west_index || 11
                    }
                    break
                case 'start':
                    switch (dir) {
                        case 0:
                            return bas.starting_south_index || 13
                        case 4:
                            return bas.starting_west_index || 15
                        case 8:
                            return bas.starting_north_index || 17
                        case 12:
                            return bas.starting_east_index || 19
                    }
                    break
                case 'end':
                    switch (dir) {
                        case 0:
                            return bas.ending_north_index || 18
                        case 4:
                            return bas.ending_east_index || 20
                        case 8:
                            return bas.ending_south_index || 14
                        case 12:
                            return bas.ending_west_index || 16
                    }
            }
            /*
                Belts only ever face a cardinal, and every BeltShape is covered
                above, so falling through means the caller passed something that
                cannot happen. getSpriteData turns this into a named log line
                and a placeholder box; returning a default index instead would
                draw a silently wrong belt piece.
            */
            throw new Error(`no belt sprite index for shape '${type}' at direction ${dir}`)
        }
    }
}

function getAnimation(a: Animation4Way, dir: number): Animation {
    const ad = dirEntry<Animation>(a, util.getDirName(dir))
    if (ad) {
        return ad
    }
    const north = dirEntry<Animation>(a, 'north')
    if (north) {
        return north
    }
    return a as Animation
}

function generateGraphics(e: EntityWithOwnerPrototype): (data: IDrawData) => readonly SpriteData[] {
    switch (e.type) {
        case 'accumulator':
            return draw_accumulator(e as AccumulatorPrototype)
        case 'agricultural-tower':
            return draw_agricultural_tower(e as AgriculturalTowerPrototype)
        case 'ammo-turret':
            if (e.name === 'railgun-turret') {
                return draw_railgun_turret(e as AmmoTurretPrototype)
            }
            return draw_ammo_turret(e as AmmoTurretPrototype)
        case 'arithmetic-combinator':
            return draw_arithmetic_combinator(e as ArithmeticCombinatorPrototype)
        case 'artillery-turret':
            return draw_artillery_turret(e as ArtilleryTurretPrototype)
        case 'artillery-wagon':
            return draw_artillery_wagon(e as ArtilleryWagonPrototype)
        case 'assembling-machine':
            return draw_assembling_machine(e as AssemblingMachinePrototype)
        case 'asteroid-collector':
            return draw_asteroid_collector(e as AsteroidCollectorPrototype)
        case 'beacon':
            return draw_beacon(e as BeaconPrototype)
        case 'boiler':
            return draw_boiler(e as BoilerPrototype)
        case 'burner-generator':
            return draw_burner_generator(e as BurnerGeneratorPrototype)
        case 'cargo-bay':
            return draw_cargo_bay(e as CargoBayPrototype)
        case 'cargo-landing-pad':
            return draw_cargo_landing_pad(e as CargoLandingPadPrototype)
        case 'cargo-wagon':
            return draw_cargo_wagon(e as CargoWagonPrototype)
        case 'constant-combinator':
            return draw_constant_combinator(e as ConstantCombinatorPrototype)
        case 'container':
            return draw_container(e as ContainerPrototype)
        case 'decider-combinator':
            return draw_decider_combinator(e as DeciderCombinatorPrototype)
        case 'display-panel':
            return draw_display_panel(e as DisplayPanelPrototype)
        case 'electric-energy-interface':
            return draw_electric_energy_interface(e as ElectricEnergyInterfacePrototype)
        case 'electric-pole':
            return draw_electric_pole(e as ElectricPolePrototype)
        case 'electric-turret':
            return draw_electric_turret(e as ElectricTurretPrototype)
        case 'elevated-curved-rail-a':
            return draw_elevated_curved_rail_a(e as ElevatedCurvedRailAPrototype)
        case 'elevated-curved-rail-b':
            return draw_elevated_curved_rail_b(e as ElevatedCurvedRailBPrototype)
        case 'elevated-half-diagonal-rail':
            return draw_elevated_half_diagonal_rail(e as ElevatedHalfDiagonalRailPrototype)
        case 'elevated-straight-rail':
            return draw_elevated_straight_rail(e as ElevatedStraightRailPrototype)
        case 'fluid-turret':
            return draw_fluid_turret(e as FluidTurretPrototype)
        case 'fluid-wagon':
            return draw_fluid_wagon(e as FluidWagonPrototype)
        case 'furnace':
            return draw_furnace(e as FurnacePrototype)
        case 'fusion-generator':
            return draw_fusion_generator(e as FusionGeneratorPrototype)
        case 'fusion-reactor':
            return draw_fusion_reactor(e as FusionReactorPrototype)
        case 'gate':
            return draw_gate(e as GatePrototype)
        case 'generator':
            return draw_generator(e as GeneratorPrototype)
        case 'heat-interface':
            return draw_heat_interface(e as HeatInterfacePrototype)
        case 'heat-pipe':
            return draw_heat_pipe(e as HeatPipePrototype)
        case 'infinity-cargo-wagon':
            return draw_infinity_cargo_wagon(e as InfinityCargoWagonPrototype)
        case 'infinity-container':
            return draw_infinity_container(e as InfinityContainerPrototype)
        case 'inserter':
            return draw_inserter(e as InserterPrototype)
        case 'lab':
            return draw_lab(e as LabPrototype)
        case 'lamp':
            return draw_lamp(e as LampPrototype)
        case 'land-mine':
            return draw_land_mine(e as LandMinePrototype)
        case 'lane-splitter':
            return draw_lane_splitter(e as LaneSplitterPrototype)
        case 'curved-rail-a':
        case 'curved-rail-b':
        case 'legacy-curved-rail':
        case 'half-diagonal-rail':
            return draw_rail(e as RailPrototype)
        case 'straight-rail':
        case 'legacy-straight-rail':
            return draw_straight_rail(e as RailPrototype)
        case 'lightning-attractor':
            return draw_lightning_attractor(e as LightningAttractorPrototype)
        case 'linked-belt':
            return draw_linked_belt(e as LinkedBeltPrototype)
        case 'linked-container':
            return draw_linked_container(e as LinkedContainerPrototype)
        case 'loader-1x1':
        case 'loader':
            return draw_loader(e as LoaderPrototype)
        case 'locomotive':
            return draw_locomotive(e as LocomotivePrototype)
        case 'logistic-container':
            return draw_logistic_container(e as LogisticContainerPrototype)
        case 'mining-drill':
            return draw_mining_drill(e as MiningDrillPrototype)
        case 'offshore-pump':
            return draw_offshore_pump(e as OffshorePumpPrototype)
        case 'pipe':
        case 'infinity-pipe':
            return draw_pipe(e as PipePrototype)
        case 'pipe-to-ground':
            return draw_pipe_to_ground(e as PipeToGroundPrototype)
        case 'power-switch':
            return draw_power_switch(e as PowerSwitchPrototype)
        case 'programmable-speaker':
            return draw_programmable_speaker(e as ProgrammableSpeakerPrototype)
        case 'proxy-container':
            return draw_proxy_container(e as ProxyContainerPrototype)
        case 'pump':
            return draw_pump(e as PumpPrototype)
        case 'radar':
            return draw_radar(e as RadarPrototype)
        case 'rail-ramp':
            return draw_rail_ramp(e as RailRampPrototype)
        case 'rail-signal':
        case 'rail-chain-signal':
            return draw_rail_signal_base(e as RailSignalBasePrototype)
        case 'rail-support':
            return draw_rail_support(e as RailSupportPrototype)
        case 'reactor':
            return draw_reactor(e as ReactorPrototype)
        case 'roboport':
            return draw_roboport(e as RoboportPrototype)
        case 'rocket-silo':
            return draw_rocket_silo(e as RocketSiloPrototype)
        case 'selector-combinator':
            return draw_selector_combinator(e as SelectorCombinatorPrototype)
        case 'solar-panel':
            return draw_solar_panel(e as SolarPanelPrototype)
        case 'space-platform-hub':
            return draw_space_platform_hub(e as SpacePlatformHubPrototype)
        case 'splitter':
            return draw_splitter(e as SplitterPrototype)
        case 'storage-tank':
            return draw_storage_tank(e as StorageTankPrototype)
        case 'thruster':
            return draw_thruster(e as ThrusterPrototype)
        case 'train-stop':
            return draw_train_stop(e as TrainStopPrototype)
        case 'transport-belt':
            return draw_transport_belt(e as TransportBeltPrototype)
        case 'turret':
            return draw_turret(e as TurretPrototype)
        case 'underground-belt':
            return draw_underground_belt(e as UndergroundBeltPrototype)
        case 'valve':
            return draw_valve(e as ValvePrototype)
        case 'wall':
            return draw_wall(e as WallPrototype)
        case 'market':
        case 'simple-entity-with-owner':
        case 'simple-entity-with-force':
        case 'temporary-container':
            return draw_simple_entity(e)
        default:
            console.warn(`Missing draw function for: '${e.type}' - rendering with fallback`)
            return draw_simple_entity(e)
    }
}

function draw_accumulator(e: AccumulatorPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'chargable_graphics', 'picture', 'layers')
}
function draw_agricultural_tower(
    e: AgriculturalTowerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).graphics_set.animation.layers
}
function draw_ammo_turret(e: AmmoTurretPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [
        ...baseVisualisationLayers(need(e, 'graphics_set', 'base_visualisation')),
        duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[0], 'y', 'height', data.dir / 4),
        duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[1], 'y', 'height', data.dir / 4),
    ]
}
function draw_railgun_turret(e: AmmoTurretPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dirName = util.getDirName(data.dir)
        const base = (e as any).graphics_set.base_visualisation.animation[dirName]?.layers || []
        const folded = (e as any).folded_animation[dirName]?.layers || []
        return [...base, ...folded]
    }
}
function draw_arithmetic_combinator(
    e: ArithmeticCombinatorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const operatorToSpriteData = (operator: ArithmeticOperation): Sprite4Way => {
            switch (operator) {
                case '+':
                    return need(e, 'plus_symbol_sprites')
                case '-':
                    return need(e, 'minus_symbol_sprites')
                case '*':
                    return need(e, 'multiply_symbol_sprites')
                case '/':
                    return need(e, 'divide_symbol_sprites')
                case '%':
                    return need(e, 'modulo_symbol_sprites')
                case '^':
                    return need(e, 'power_symbol_sprites')
                case '<<':
                    return need(e, 'left_shift_symbol_sprites')
                case '>>':
                    return need(e, 'right_shift_symbol_sprites')
                case 'AND':
                    return need(e, 'and_symbol_sprites')
                case 'OR':
                    return need(e, 'or_symbol_sprites')
                case 'XOR':
                    return need(e, 'xor_symbol_sprites')
                default:
                    throw new Error(
                        `${e.name} has no sprite for arithmetic operation "${String(operator)}"`
                    )
            }
        }
        const out = [...dirLayers(need(e, 'sprites'), util.getDirName(data.dir))]
        if (data.operator) {
            out.push(
                dirEntry(
                    operatorToSpriteData(data.operator as ArithmeticOperation),
                    util.getDirName(data.dir)
                )
            )
        }
        return out
    }
}
function draw_artillery_turret(
    e: ArtilleryTurretPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 2
        let base = util.duplicate(need(e, 'cannon_base_pictures', 'layers')[0])
        base = setProperty(base, 'filename', need(base, 'filenames')[d])
        base = addToShift([0, -0.6875], base)
        let barrel = util.duplicate(need(e, 'cannon_barrel_pictures', 'layers')[0])
        barrel = setProperty(barrel, 'filename', need(barrel, 'filenames')[d])
        barrel = addToShift([0, -0.6875], barrel)
        barrel = addToShift(getShift(), barrel)
        function getShift(): readonly [number, number] {
            switch (data.dir) {
                case 0:
                    return [0, 1]
                case 4:
                    return [-1, 0.31]
                case 8:
                    return [0, -0.4]
                case 12:
                    return [1, 0.31]
                default:
                    // Artillery turrets only face a cardinal - same reasoning as
                    // getIndex above.
                    throw new Error(`no artillery barrel shift for direction ${data.dir}`)
            }
        }
        return [...layersOf(need(e, 'base_picture')), barrel, base]
    }
}
function draw_artillery_wagon(
    e: ArtilleryWagonPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 4
        const layers: SpriteData[] = []
        for (const layer of (e as any).pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        for (const layer of (e as any).cannon_barrel_pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        for (const layer of (e as any).cannon_base_pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        return layers
    }
}
/**
 * The electromagnetic plant's idle animation is only its shell - its core is a
 * separate `working_visualisation` the draw never picked up, leaving a hole.
 * Its one unconditional entry (`always_draw`, no `name`, no `enabled_by_name`)
 * is that core.
 *
 * Only the electromagnetic plant. Other crafting machines' `always_draw`
 * visualisations are `apply_runtime_tint` masks that read wrong without the
 * base they tint (cryogenic-plant) or recipe-gated (`enabled_by_name`, foundry);
 * folding those in is a wider change than fixing the hole this leaves.
 */
function restingCoreLayers(e: AssemblingMachinePrototype): readonly SpriteData[] {
    if (e.name !== 'electromagnetic-plant') return []
    const core = need(e, 'graphics_set').working_visualisations?.find(
        wv => wv.always_draw && !wv.name && !wv.enabled_by_name && wv.animation
    )
    return core?.animation ? layersOf(core.animation) : []
}

function draw_assembling_machine(
    e: AssemblingMachinePrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const core = restingCoreLayers(e)
        if (need(e, 'graphics_set').always_draw_idle_animation) {
            return [...layersOf(need(e, 'graphics_set', 'idle_animation')), ...core]
        } else {
            const out = [
                ...layersOf(getAnimation(need(e, 'graphics_set', 'animation'), data.dir)),
                ...core,
            ]

            const fbs = getFluidBoxes(
                e,
                data.assemblerHasFluidInputs || data.assemblerHasFluidOutputs
            ).filter(
                conn =>
                    (data.assemblerHasFluidInputs && conn.production_type === 'input') ||
                    (data.assemblerHasFluidOutputs && conn.production_type === 'output')
            )

            for (const fb of fbs) {
                if (!fb.pipe_picture) continue

                for (const conn of fb.pipe_connections) {
                    if (!(conn.connection_type === undefined || conn.connection_type === 'normal'))
                        continue

                    const dir = (data.dir + need(conn, 'direction')) % 16
                    // pipe_picture can be a directional map {north, east, south, west}
                    // or a single sprite object (e.g. foundry). The latter has no
                    // directional keys, so fall back to it as a SpriteData.
                    const pipePic =
                        dirEntry(fb.pipe_picture, util.getDirName(dir)) ||
                        (fb.pipe_picture as unknown as SpriteData)
                    if (!pipePic || !pipePic.filename) continue
                    out.push(
                        addToShift(
                            util.rotatePointBasedOnDir([0, -2], dir),
                            util.duplicate(pipePic)
                        )
                    )
                }
            }

            return out
        }
    }
}
function draw_asteroid_collector(
    e: AsteroidCollectorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => layersOf(getAnimation((e as any).graphics_set.animation, data.dir))
}
function draw_beacon(e: BeaconPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const layers = need(e, 'graphics_set', 'animation_list')
            .filter(vis => vis.always_draw)
            .map(vis => vis.animation)
            // A visualisation with nothing to draw contributes nothing; it should
            // not cost the beacon the rest of its layers.
            .filter(anim => anim !== undefined)
            // an animation either has layers or is itself the single layer
            .flatMap(vis => layersOf(vis))

        // Beacon module slots only ever hold modules; narrow from the base
        // ItemPrototype to read module-only `tier`/`beacon_tint`. An empty slot
        // has no name and falls through to the has_empty_slot branch below.
        const modules = (data.modules || []).map(name =>
            name === undefined ? undefined : (FD.items[name] as ModulePrototype)
        )
        const moduleLayers = need(e, 'graphics_set', 'module_visualisations')
            .flatMap(vis => vis.slots ?? [])
            .flatMap((arr, i) => {
                const module = modules[i]
                if (module) {
                    return arr.map(slot => {
                        const img = util.duplicate(sheetOf(need(slot, 'pictures')))

                        let variationIndex = module.tier - 1
                        if (slot.has_empty_slot) {
                            variationIndex += 1
                        }
                        setPropertyUsing(img, 'x', 'width', variationIndex)

                        if (slot.apply_module_tint) {
                            // beacon_tint is keyed by ModuleTint ('primary', ...);
                            // apply_module_tint may also be 'none', which has no entry.
                            const tints = module.beacon_tint as Record<
                                string,
                                ColorWithAlpha | readonly number[]
                            >
                            let tint = tints[slot.apply_module_tint]
                            if (Array.isArray(tint)) {
                                tint = { r: tint[0], g: tint[1], b: tint[2], a: 1 }
                            }
                            setProperty(img, 'tint', tint)
                        }
                        return img
                    })
                } else {
                    return arr
                        .filter(slot => slot.has_empty_slot)
                        .map(slot => sheetOf(need(slot, 'pictures')))
                }
            })

        return [...layers, ...moduleLayers]
    }
}
function draw_boiler(e: BoilerPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const patches = []
        /*
            EnergySource is a discriminated union on `type`, but getEnergySource
            can also answer undefined (a boiler prototype need not declare one),
            and undefined has no `type` for the check to narrow through - so the
            guard has to come first for `connections` and `pipe_covers` to be
            readable at all. heat-exchanger is the only boiler with a heat source
            and it carries both, same as the electric-mining-drill check above.
        */
        const energy_source = getEnergySource(e)
        if (energy_source && energy_source.type === 'heat') {
            for (const conn of need(energy_source, 'connections')) {
                let needsEnding = true
                if (data.positionGrid) {
                    const pos = util.rotatePointBasedOnDir(conn.position, data.dir)
                    const c = getHeatConnections(
                        {
                            x: Math.floor(data.position.x + pos.x),
                            y: Math.floor(data.position.y + pos.y),
                        },
                        data.positionGrid
                    )
                    needsEnding = !c[((data.dir + conn.direction) % 16) / 4]
                }
                if (needsEnding) {
                    patches.push(
                        addToShift(
                            util.rotatePointBasedOnDir([0, 1.5], data.dir),
                            util.duplicate(
                                dirEntry(
                                    need(energy_source, 'pipe_covers'),
                                    util.getDirName((data.dir + 8) % 16)
                                )
                            )
                        )
                    )
                }
            }
        }
        return [
            ...patches,
            ...layersOf(
                dirEntry<{ structure: SpriteData }>(need(e, 'pictures'), util.getDirName(data.dir))
                    .structure
            ),
        ]
    }
}
function draw_burner_generator(
    e: BurnerGeneratorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => layersOf(getAnimation((e as any).animation, data.dir))
}
function isCargoBayLike(entity: { type: string } | undefined): boolean {
    return (
        entity !== undefined && (entity.type === 'cargo-bay' || entity.type === 'cargo-landing-pad')
    )
}

function getCargoBayConnectionSprites(
    connections: any,
    position: IPoint,
    positionGrid: PositionGrid | undefined
): SpriteData[] {
    if (!connections || !positionGrid) return []

    // Cargo bays are 4x4 tiles. Check tiles just outside the boundary for adjacent cargo bays.
    const x0 = Math.round(position.x - 2)
    const y0 = Math.round(position.y - 2)

    const hasN = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 + 1, y: y0 - 1 }))
    const hasS = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 + 1, y: y0 + 4 }))
    const hasW = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 - 1, y: y0 + 1 }))
    const hasE = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 + 4, y: y0 + 1 }))

    const hasNW = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 - 1, y: y0 - 1 }))
    const hasNE = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 + 4, y: y0 - 1 }))
    const hasSW = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 - 1, y: y0 + 4 }))
    const hasSE = isCargoBayLike(positionGrid.getEntityAtPosition({ x: x0 + 4, y: y0 + 4 }))

    const sprites: SpriteData[] = []

    const addConnectionSprites = (key: string): void => {
        const variants = connections[key]
        if (!variants || variants.length === 0) return
        const variant = variants[0]
        for (const rendition of variant) {
            if (rendition.layers) {
                for (const layer of rendition.layers) {
                    sprites.push(util.duplicate(layer))
                }
            } else {
                const { render_layer: _render_layer, ...spriteData } = rendition
                sprites.push(util.duplicate(spriteData))
            }
        }
    }

    // Exterior walls: drawn on edges WITHOUT a neighbor
    if (!hasN) addConnectionSprites('top_wall')
    if (!hasS) addConnectionSprites('bottom_wall')
    if (!hasW) addConnectionSprites('left_wall')
    if (!hasE) addConnectionSprites('right_wall')

    // Outer corners: convex corners where two exterior walls meet
    if (!hasN && !hasW) addConnectionSprites('top_left_outer_corner')
    if (!hasN && !hasE) addConnectionSprites('top_right_outer_corner')
    if (!hasS && !hasW) addConnectionSprites('bottom_left_outer_corner')
    if (!hasS && !hasE) addConnectionSprites('bottom_right_outer_corner')

    // Inner corners: concave notch where two connected sides meet but diagonal is missing
    if (hasN && hasW && !hasNW) addConnectionSprites('top_left_inner_corner')
    if (hasN && hasE && !hasNE) addConnectionSprites('top_right_inner_corner')
    if (hasS && hasW && !hasSW) addConnectionSprites('bottom_left_inner_corner')
    if (hasS && hasE && !hasSE) addConnectionSprites('bottom_right_inner_corner')

    return sprites
}

function draw_cargo_bay(e: CargoBayPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const base = (e as any).graphics_set.picture.flatMap((p: any) => p.layers)
        const connections = getCargoBayConnectionSprites(
            (e as any).graphics_set.connections,
            data.position,
            data.positionGrid
        )
        return [...connections, ...base]
    }
}
function draw_cargo_landing_pad(
    e: CargoLandingPadPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const base = (e as any).graphics_set.picture.flatMap((p: any) => p.layers)
        const connections = getCargoBayConnectionSprites(
            (e as any).graphics_set.connections,
            data.position,
            data.positionGrid
        )
        return [...connections, ...base]
    }
}
function draw_cargo_wagon(e: CargoWagonPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 4
        const layers: SpriteData[] = []
        for (const layer of (e as any).pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        return layers
    }
}
function draw_constant_combinator(
    e: ConstantCombinatorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        return dirLayers(need(e, 'sprites'), util.getDirName(data.dir))
    }
}
function draw_container(e: ContainerPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'picture', 'layers')
}
function draw_simple_entity(e: any): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        let layers: SpriteData[]

        // Try various property paths that Factorio prototypes use for graphics
        if (e.picture?.layers) {
            layers = e.picture.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.picture) {
            layers = [util.duplicate(e.picture)]
        } else if (e.pictures?.layers) {
            layers = e.pictures.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.pictures && Array.isArray(e.pictures)) {
            // Array of sprite variants (e.g., SpriteVariations) - pick first
            const first = e.pictures[0]
            layers = first?.layers
                ? first.layers.map((l: SpriteData) => util.duplicate(l))
                : [util.duplicate(first)]
        } else if (e.animations?.layers) {
            layers = e.animations.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.animations && !e.animations.layers) {
            // 4-way animation - use direction
            const dirName = util.getDirName(data.dir || 0)
            const anim = e.animations[dirName] || e.animations.north || e.animations
            layers = anim?.layers
                ? anim.layers.map((l: SpriteData) => util.duplicate(l))
                : [util.duplicate(anim)]
        } else if (e.graphics_set?.animation?.layers) {
            layers = e.graphics_set.animation.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.graphics_set?.animation) {
            // 4-way animation in graphics_set
            const anim = e.graphics_set.animation
            const dirName = util.getDirName(data.dir || 0)
            if (anim[dirName]) {
                const dirAnim = anim[dirName]
                layers = dirAnim.layers
                    ? dirAnim.layers.map((l: SpriteData) => util.duplicate(l))
                    : [util.duplicate(dirAnim)]
            } else if (anim.layers) {
                layers = anim.layers.map((l: SpriteData) => util.duplicate(l))
            } else {
                layers = [util.duplicate(anim)]
            }
        } else if (e.graphics_set?.picture?.layers) {
            layers = e.graphics_set.picture.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.graphics_set?.picture && Array.isArray(e.graphics_set.picture)) {
            // Flat array of pictures (e.g., cargo-bay)
            layers = e.graphics_set.picture.flatMap((p: SpriteData) =>
                p.layers ? p.layers.map((l: SpriteData) => util.duplicate(l)) : [util.duplicate(p)]
            )
        } else if (e.chargable_graphics?.picture?.layers) {
            layers = e.chargable_graphics.picture.layers.map((l: SpriteData) => util.duplicate(l))
        } else if (e.folded_animation?.layers) {
            layers = e.folded_animation.layers.map((l: SpriteData) => util.duplicate(l))
        } else {
            return []
        }

        // Apply direction-based filenames indexing
        const d = data.dir !== undefined ? Math.floor(data.dir / 4) : 0
        for (const l of layers) {
            if ((l as any).filenames && !(l as any).filename) {
                const filenames = (l as any).filenames as string[]
                ;(l as any).filename = filenames[Math.min(d, filenames.length - 1)]
            }
        }
        return layers
    }
}
function draw_decider_combinator(
    e: DeciderCombinatorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const operatorToSpriteData = (operator: ComparatorString): Sprite4Way => {
            switch (operator) {
                case '<':
                    return need(e, 'less_symbol_sprites')
                case '>':
                    return need(e, 'greater_symbol_sprites')
                case '≤':
                    return need(e, 'less_or_equal_symbol_sprites')
                case '≥':
                    return need(e, 'greater_or_equal_symbol_sprites')
                case '=':
                    return need(e, 'equal_symbol_sprites')
                case '≠':
                    return need(e, 'not_equal_symbol_sprites')
                default:
                    throw new Error(
                        `${e.name} has no sprite for decider comparator "${String(operator)}"`
                    )
            }
        }
        const out = [...dirLayers(need(e, 'sprites'), util.getDirName(data.dir))]
        if (data.operator) {
            out.push(
                dirEntry(
                    operatorToSpriteData(data.operator as ComparatorString),
                    util.getDirName(data.dir)
                )
            )
        }
        return out
    }
}
function draw_display_panel(e: DisplayPanelPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const out = [...dirLayers(need(e, 'sprites'), util.getDirName(data.dir))]
        if (data.displayPanelIcon && data.displayPanelIcon.name) {
            // TODO: move this out
            const map = () => {
                switch (need(data, 'displayPanelIcon').type) {
                    case undefined:
                    case 'item':
                        return FD.items
                    case 'fluid':
                        return FD.fluids
                    case 'virtual':
                        return FD.signals
                    case 'recipe':
                        return FD.recipes
                    case 'entity':
                        return FD.entities
                    default:
                        throw new Error('Missing signal type mapping!')
                }
            }
            const s = map()[data.displayPanelIcon.name]
            out.push({
                filename: s.icon,
                size: s.icon_size || 64,
                scale: 0.5 * (e.icon_draw_specification?.scale || 1),
                shift: e.icon_draw_specification?.shift,
            })
        }
        return out
    }
}
function draw_electric_energy_interface(
    e: ElectricEnergyInterfacePrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'picture', 'layers')
}
function draw_electric_pole(e: ElectricPolePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [
        duplicateAndSetPropertyUsing(need(e, 'pictures', 'layers')[0], 'x', 'width', data.dir / 4),
    ]
}
function draw_electric_turret(
    e: ElectricTurretPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const baseLayers = baseVisualisationLayers(need(e, 'graphics_set', 'base_visualisation'))
        return [
            ...baseLayers,
            duplicateAndSetPropertyUsing(
                layersOf(e.folded_animation)[0],
                'y',
                'height',
                data.dir / 4
            ),
            duplicateAndSetPropertyUsing(
                layersOf(e.folded_animation)[2],
                'y',
                'height',
                data.dir / 4
            ),
        ]
    }
}
function draw_elevated_rail(e: RailPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = data.dir
        let ps = e.pictures[util.getDirName8Way(dir)]
        if (Object.entries(ps).length === 0) {
            ps = e.pictures[util.getDirName8Way(dir % 8)]
        }
        return [ps.stone_path_background, ps.stone_path, ps.backplates, ps.metals]
            .filter(p => p !== undefined)
            .map(p => sheetOf(p))
    }
}
function draw_elevated_curved_rail_a(
    e: ElevatedCurvedRailAPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return draw_elevated_rail(e as unknown as RailPrototype)
}
function draw_elevated_curved_rail_b(
    e: ElevatedCurvedRailBPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return draw_elevated_rail(e as unknown as RailPrototype)
}
function draw_elevated_half_diagonal_rail(
    e: ElevatedHalfDiagonalRailPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return draw_elevated_rail(e as unknown as RailPrototype)
}
function draw_elevated_straight_rail(
    e: ElevatedStraightRailPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return draw_elevated_rail(e as unknown as RailPrototype)
}
function draw_fluid_turret(e: FluidTurretPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [
        ...baseVisualisationLayers(need(e, 'graphics_set', 'base_visualisation'), data.dir),
        ...dirLayers(e.folded_animation, util.getDirName(data.dir)),
    ]
}
function draw_fluid_wagon(e: FluidWagonPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 4
        const layers: SpriteData[] = []
        for (const layer of (e as any).pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        return layers
    }
}
function draw_furnace(e: FurnacePrototype): (data: IDrawData) => readonly SpriteData[] {
    const anim = need(e, 'graphics_set').animation as any
    if (anim.layers) {
        return () => anim.layers
    }
    // Directional animation (e.g. recycler has {north, east, south, west})
    return (data: IDrawData) => {
        const dirAnim = anim[util.getDirName(data.dir)]
        return dirAnim?.layers || []
    }
}
function draw_fusion_generator(
    e: FusionGeneratorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const gs = (e as any).graphics_set
        const dirMap: Record<string, any> = {
            north: gs.north_graphics_set,
            east: gs.east_graphics_set,
            south: gs.south_graphics_set,
            west: gs.west_graphics_set,
        }
        const dirSet = dirMap[util.getDirName(data.dir)]
        return dirSet?.animation?.layers || []
    }
}
function draw_fusion_reactor(
    e: FusionReactorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).graphics_set.structure.layers
}
function draw_gate(e: GatePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        function getBaseSprites(): readonly SpriteData[] {
            if (data.positionGrid) {
                const size = getEntitySize(e, data.dir)
                const rail = data.positionGrid.findInArea(
                    {
                        x: data.position.x,
                        y: data.position.y,
                        w: size.x,
                        h: size.y,
                    },
                    entity =>
                        entity.type === 'legacy-straight-rail' || entity.type === 'straight-rail'
                )
                if (rail) {
                    if (data.dir % 8 === 0) {
                        if (rail.position.y > data.position.y) {
                            return layersOf(need(e, 'vertical_rail_animation_left'))
                        }
                        return layersOf(need(e, 'vertical_rail_animation_right'))
                    } else {
                        if (rail.position.x > data.position.x) {
                            return layersOf(need(e, 'horizontal_rail_animation_left'))
                        }
                        return layersOf(need(e, 'horizontal_rail_animation_right'))
                    }
                }
            }

            if (data.dir % 8 === 0) {
                return layersOf(need(e, 'vertical_animation'))
            }
            return layersOf(need(e, 'horizontal_animation'))
        }

        if (data.dir % 8 === 0 && data.positionGrid) {
            const wall = data.positionGrid.getEntityAtPosition({
                x: data.position.x,
                y: data.position.y + 1,
            })
            if (wall && wall.type === 'wall') {
                return [...getBaseSprites(), ...need(e, 'wall_patch', 'layers')]
            }
        }

        return getBaseSprites()
    }
}
function draw_generator(e: GeneratorPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) =>
        data.dir % 8 === 0
            ? layersOf(need(e, 'vertical_animation'))
            : layersOf(need(e, 'horizontal_animation'))
}
function draw_heat_interface(
    e: HeatInterfacePrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => [need(e, 'picture')]
}
function draw_heat_pipe(e: HeatPipePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        if (data.positionGrid) {
            // Held in a local because the narrowing does not survive the closure.
            const positionGrid = data.positionGrid
            const getOpt = (): SpriteVariations => {
                const conn = getHeatConnections(data.position, positionGrid)
                if (conn[0] && conn[1] && conn[2] && conn[3]) {
                    return need(e, 'connection_sprites').cross
                }
                if (conn[0] && conn[1] && conn[3]) {
                    return need(e, 'connection_sprites').t_up
                }
                if (conn[1] && conn[2] && conn[3]) {
                    return need(e, 'connection_sprites').t_down
                }
                if (conn[0] && conn[1] && conn[2]) {
                    return need(e, 'connection_sprites').t_right
                }
                if (conn[0] && conn[2] && conn[3]) {
                    return need(e, 'connection_sprites').t_left
                }
                if (conn[0] && conn[2]) {
                    return need(e, 'connection_sprites').straight_vertical
                }
                if (conn[1] && conn[3]) {
                    return need(e, 'connection_sprites').straight_horizontal
                }
                if (conn[0] && conn[1]) {
                    return need(e, 'connection_sprites').corner_right_up
                }
                if (conn[0] && conn[3]) {
                    return need(e, 'connection_sprites').corner_left_up
                }
                if (conn[1] && conn[2]) {
                    return need(e, 'connection_sprites').corner_right_down
                }
                if (conn[2] && conn[3]) {
                    return need(e, 'connection_sprites').corner_left_down
                }
                if (conn[0]) {
                    return need(e, 'connection_sprites').ending_up
                }
                if (conn[2]) {
                    return need(e, 'connection_sprites').ending_down
                }
                if (conn[1]) {
                    return need(e, 'connection_sprites').ending_right
                }
                if (conn[3]) {
                    return need(e, 'connection_sprites').ending_left
                }
                return need(e, 'connection_sprites').single
            }
            return [util.getRandomItem(toSpriteArray(getOpt()))]
        }
        return [util.getRandomItem(toSpriteArray(need(e, 'connection_sprites').single))]
    }
}
function draw_infinity_cargo_wagon(
    e: InfinityCargoWagonPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 4
        const layers: SpriteData[] = []
        for (const layer of (e as any).pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        return layers
    }
}
function draw_infinity_container(
    e: InfinityContainerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'picture', 'layers')
}
function draw_inserter(e: InserterPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        let ho = util.duplicate(need(e, 'hand_open_picture'))
        let hb = util.duplicate(need(e, 'hand_base_picture'))

        const handData = {
            anchorX: 0.5,
            anchorY: 1,
            rotAngle: 0,
            squishY: 1,
            x: 0,
            y: 0,
        }
        const armData = { ...handData }

        const armAngle = 45
        const armAngleLHI = 25

        if (e.name === 'long-handed-inserter') {
            switch (data.dir) {
                case 12:
                    handData.rotAngle = armAngleLHI - 180
                    handData.squishY = 1.5
                    handData.x = -0.275
                    handData.y = -0.7

                    armData.rotAngle = -armAngleLHI
                    armData.squishY = 1.25
                    armData.x = 0.03
                    armData.y = 0.03
                    break
                case 4:
                    handData.rotAngle = -armAngleLHI + 180
                    handData.squishY = 1.5
                    handData.x = 0.275
                    handData.y = -0.7

                    armData.rotAngle = armAngleLHI
                    armData.squishY = 1.25
                    armData.x = -0.03
                    armData.y = 0.03
                    break
                case 8:
                    handData.rotAngle = 180
                    handData.squishY = 1.25
                    handData.y = -0.3

                    armData.squishY = 2.5
                    armData.y = 0.03
                    break
                case 0:
                    handData.rotAngle = 180
                    handData.squishY = 3.5
                    handData.y = -0.95

                    armData.y = 0.05
            }
        } else {
            switch (data.dir) {
                case 12:
                    handData.rotAngle = -armAngle - 90
                    handData.squishY = 2.5
                    handData.x = -0.325
                    handData.y = -0.325

                    armData.rotAngle = -armAngle
                    armData.squishY = 1.9
                    armData.x = 0.03
                    armData.y = 0.03
                    break
                case 4:
                    handData.rotAngle = armAngle + 90
                    handData.squishY = 2.5
                    handData.x = 0.325
                    handData.y = -0.325

                    armData.rotAngle = armAngle
                    armData.squishY = 1.9
                    armData.x = -0.03
                    armData.y = 0.03
                    break
                case 8:
                    handData.rotAngle = 180
                    handData.squishY = 1.75
                    handData.y = 0.03

                    armData.rotAngle = 180
                    armData.squishY = 7
                    armData.y = -0.03
                    break
                case 0:
                    handData.squishY = 3
                    handData.y = -0.5

                    armData.squishY = 1.4
                    armData.y = 0.05
            }
        }

        ho = setProperty(ho, 'anchorX', handData.anchorX)
        ho = setProperty(ho, 'anchorY', handData.anchorY)
        ho = setProperty(ho, 'rotAngle', handData.rotAngle)
        ho = setProperty(ho, 'squishY', handData.squishY)
        ho = addToShift(handData, ho)

        hb = setProperty(hb, 'anchorX', armData.anchorX)
        hb = setProperty(hb, 'anchorY', armData.anchorY)
        hb = setProperty(hb, 'rotAngle', armData.rotAngle)
        hb = setProperty(hb, 'squishY', armData.squishY)
        hb = addToShift(armData, hb)

        return [
            duplicateAndSetPropertyUsing(
                sheetOf(need(e, 'platform_picture')),
                'x',
                'width',
                ((data.dir + 8) % 16) / 4
            ),
            ho,
            hb,
        ]
    }
}
function draw_lab(e: LabPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'off_animation', 'layers')
}
function draw_lamp(e: LampPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'picture_off', 'layers')
}
function draw_land_mine(e: LandMinePrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => [need(e, 'picture_set')]
}
function draw_lane_splitter(e: LaneSplitterPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = util.getDirName(data.dir)
        const out: SpriteData[] = []
        const structure = (e as any).structure
        const structurePatch = (e as any).structure_patch
        if (structurePatch?.[dir]) out.push(structurePatch[dir])
        if (structure?.[dir]) out.push(structure[dir])
        return out
    }
}
/**
 * The layers a ground rail draws, back to front. Every non-empty direction entry
 * in data.json carries all five, so a missing one is data going wrong rather
 * than a layer to skip - unlike the elevated rails, which have no `ties` and
 * filter for it.
 */
const RAIL_LAYER_KEYS = [
    'stone_path_background',
    'stone_path',
    'ties',
    'backplates',
    'metals',
] as const

function draw_rail(e: RailPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = data.dir
        let ps = e.pictures[util.getDirName8Way(dir)]
        if (Object.entries(ps).length === 0) {
            ps = e.pictures[util.getDirName8Way(dir % 8)]
        }
        return RAIL_LAYER_KEYS.map(k => sheetOf(need(ps, k)))
    }
}
function draw_straight_rail(e: RailPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = data.dir
        function getBaseSprites(): readonly SpriteData[] {
            let ps = e.pictures[util.getDirName8Way(dir)]
            if (Object.entries(ps).length === 0) {
                ps = e.pictures[util.getDirName8Way(dir % 8)]
            }
            return RAIL_LAYER_KEYS.map(k => sheetOf(need(ps, k)))
        }

        if (data.positionGrid && dir % 4 === 0) {
            const size = getEntitySize(e, dir)

            const railBases = data.positionGrid
                .getEntitiesInArea({
                    x: data.position.x,
                    y: data.position.y,
                    w: size.x,
                    h: size.y,
                })
                .filter(e => e.type === 'gate')
                .map(e => util.sumprod(e.position, -1, data.position))
                // Rotate relative to mid point
                .map(p => util.rotatePointBasedOnDir(p, dir).y)
                /*
                    Sorts to group duplicates for the dedupe below. Numeric, not
                    the default: `.sort()` compares stringified numbers, which is
                    wrong in general even though it cannot bite here - the only
                    offsets a 2x2 rail can produce are -0.5 and 0.5, and those
                    happen to order the same either way. Measured across the
                    corpus: this runs 24 times and every one is a single value,
                    so nothing here was ever exercised with two. tests/rail-gate-bases.spec.ts
                    is the case that does.
                */
                .sort((a, b) => a - b)
                .filter((y, i, arr) => i === 0 || y !== arr[i - 1])
                // Reverse rotate relative to mid point
                .map(y => util.rotatePointBasedOnDir([0, y], (16 - dir) % 16))
                // Map positions to SpriteData
                .map(p =>
                    addToShift(
                        p,
                        util.duplicate(
                            dir % 8 === 0
                                ? need(FD.entities.gate as GatePrototype, 'horizontal_rail_base')
                                : need(FD.entities.gate as GatePrototype, 'vertical_rail_base')
                        )
                    )
                )

            return [...getBaseSprites(), ...railBases]
        }
        return getBaseSprites()
    }
}
function draw_lightning_attractor(
    e: LightningAttractorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).chargable_graphics.picture.layers
}
function draw_linked_belt(e: LinkedBeltPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const isInput = data.dirType === 'input'
        const dir = isInput ? data.dir : (data.dir + 8) % 16
        const structure = (e as any).structure
        const sheet = isInput ? structure.direction_in.sheet : structure.direction_out.sheet
        return [duplicateAndSetPropertyUsing(sheet, 'x', 'width', dir / 4)]
    }
}
function draw_linked_container(
    e: LinkedContainerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).picture.layers
}
function draw_loader(e: LoaderPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const isInput = data.dirType === 'input'
        const dir = isInput ? data.dir : (data.dir + 8) % 16
        const offset = util.rotatePointBasedOnDir([0, 0.5], dir)

        const beltParts = getBeltSprites(
            need(e, 'belt_animation_set'),
            data.positionGrid ? util.sumprod(data.position, offset) : offset,
            data.dir,
            data.positionGrid,
            isInput,
            !isInput,
            true
        ).map(sprite => addToShift(util.rotatePointBasedOnDir([0, 0.5], dir), sprite))

        let mainBelt = beltParts[0]
        if (dir === 4 || dir === 12) {
            mainBelt = setPropertyUsing(mainBelt, 'width', 'size', 0.5)
        } else {
            mainBelt = setPropertyUsing(mainBelt, 'height', 'size', 0.5)
        }

        if (dir === 4) {
            mainBelt = setProperty(mainBelt, 'anchorX', 1)
        }
        if (dir === 12) {
            mainBelt = setProperty(mainBelt, 'anchorX', 0.5)
        }
        if (dir === 8) {
            mainBelt = setProperty(mainBelt, 'anchorY', 1)
        }
        if (dir === 0) {
            mainBelt = setProperty(mainBelt, 'anchorY', 0.5)
        }

        const structure = need(e, 'structure')
        const sprites = []

        sprites.push(mainBelt)

        sprites.push(
            duplicateAndSetPropertyUsing(
                isInput
                    ? sheetOf(need(structure, 'direction_in'))
                    : sheetOf(need(structure, 'direction_out')),
                'x',
                'width',
                dir / 4
            )
        )

        if (beltParts[1]) {
            sprites.push(beltParts[1])
        }

        return sprites
    }
}
function draw_locomotive(e: LocomotivePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const d = data.dir / 4
        const layers: SpriteData[] = []
        for (const layer of (e as any).pictures.rotated.layers) {
            const l = util.duplicate(layer)
            if (l.filenames) l.filename = l.filenames[d]
            layers.push(l)
        }
        return layers
    }
}
function draw_logistic_container(
    e: LogisticContainerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'animation', 'layers')
}
function draw_mining_drill(e: MiningDrillPrototype): (data: IDrawData) => readonly SpriteData[] {
    switch (e.name) {
        case 'burner-mining-drill':
            return (data: IDrawData) =>
                dirLayers(need(e, 'graphics_set', 'animation'), util.getDirName(data.dir))

        case 'pumpjack':
            return (data: IDrawData) => [
                duplicateAndSetPropertyUsing(
                    sheetsOf(need(e, 'base_picture'))[0],
                    'x',
                    'width',
                    data.dir / 4
                ),
                ...fourWayAnimation(need(e, 'graphics_set', 'animation'), 0),
            ]

        case 'electric-mining-drill':
        case 'big-mining-drill':
            return (data: IDrawData) => {
                const dir = util.getDirName(data.dir)
                const layers0 = dirLayers(need(e, 'graphics_set', 'animation'), dir)

                const animDir = `${dir}_animation` as
                    | 'north_animation'
                    | 'east_animation'
                    | 'south_animation'
                    | 'west_animation'

                /*
                    An always_draw visualisation is either directional - one entry per
                    facing, and absent for facings it does not apply to - or a single
                    non-directional `animation` drawn the same way whichever way the
                    drill points. electric-mining-drill only has the first kind, so it
                    was enough to read the directional key and drop everything else.
                    big-mining-drill has two of the second kind (a scorch mark and the
                    drill head), which that would silently discard.

                    The order matters: a directional entry that omits this facing has
                    to stay dropped rather than fall back to a plain `animation` it
                    does not have, which is what the filter below still does.
                */
                const layers1 = need(e, 'graphics_set', 'working_visualisations')
                    .filter(vis => vis.always_draw)
                    .map(vis => vis[animDir] ?? vis.animation)
                    .filter(vis => !!vis)
                    .flatMap(vis => (vis.layers ? vis.layers : [vis]))

                return [...layers0, ...layers1]
            }

        default:
            /*
                Throwing here still beats falling off the end of the switch, which
                returned undefined and surfaced as "graphicsFn is not a function",
                naming neither the entity nor the real problem. See issue #29.

                But note where this runs: the switch is in the factory body, so this
                throw happens inside generateGraphics, which getSpriteData calls
                OUTSIDE its try. It is not caught and does not degrade to a
                placeholder - it loses the blueprint. Unreachable today, since every
                mining-drill prototype in data.json has a case above; a Space Age
                addition would reach it. See the file header.
            */
            throw new Error(`no draw case for mining drill '${e.name}'`)
    }
}
function draw_offshore_pump(e: OffshorePumpPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) =>
        dirLayers(need(e, 'graphics_set', 'animation'), util.getDirName(data.dir))
}
function draw_pipe(e: PipePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        // pipe and infinity-pipe both carry every junction sprite below; a
        // missing one is data going wrong, not a pipe piece to leave undrawn.
        const pictures = need(e, 'pictures')
        if (data.positionGrid) {
            const conn = getFluidConnections(data.position, data.positionGrid)

            if (conn[0] && conn[1] && conn[2] && conn[3]) {
                return [need(pictures, 'cross')]
            }
            if (conn[0] && conn[1] && conn[3]) {
                return [need(pictures, 't_up')]
            }
            if (conn[1] && conn[2] && conn[3]) {
                return [need(pictures, 't_down')]
            }
            if (conn[0] && conn[1] && conn[2]) {
                return [need(pictures, 't_right')]
            }
            if (conn[0] && conn[2] && conn[3]) {
                return [need(pictures, 't_left')]
            }
            if (conn[0] && conn[2]) {
                // Only show window variant in continuous straight runs (3+ pipes)
                let useWindow = false
                if (data.positionGrid) {
                    const above = { x: data.position.x, y: Math.floor(data.position.y) - 1 }
                    const below = { x: data.position.x, y: Math.floor(data.position.y) + 1 }
                    const aboveConn = getFluidConnections(above, data.positionGrid)
                    const belowConn = getFluidConnections(below, data.positionGrid)
                    // Both neighbors must also be vertical straight pipes
                    const aboveIsStraightV =
                        aboveConn[0] && aboveConn[2] && !aboveConn[1] && !aboveConn[3]
                    const belowIsStraightV =
                        belowConn[0] && belowConn[2] && !belowConn[1] && !belowConn[3]
                    if (aboveIsStraightV && belowIsStraightV) {
                        useWindow = Math.floor(data.position.y) % 2 !== 0
                    }
                }
                return useWindow
                    ? [
                          need(pictures, 'vertical_window_background'),
                          need(pictures, 'straight_vertical_window'),
                      ]
                    : [need(pictures, 'straight_vertical')]
            }
            if (conn[1] && conn[3]) {
                let useWindow = false
                if (data.positionGrid) {
                    const left = { x: Math.floor(data.position.x) - 1, y: data.position.y }
                    const right = { x: Math.floor(data.position.x) + 1, y: data.position.y }
                    const leftConn = getFluidConnections(left, data.positionGrid)
                    const rightConn = getFluidConnections(right, data.positionGrid)
                    const leftIsStraightH =
                        leftConn[1] && leftConn[3] && !leftConn[0] && !leftConn[2]
                    const rightIsStraightH =
                        rightConn[1] && rightConn[3] && !rightConn[0] && !rightConn[2]
                    if (leftIsStraightH && rightIsStraightH) {
                        useWindow = Math.floor(data.position.x) % 2 !== 0
                    }
                }
                return useWindow
                    ? [
                          need(pictures, 'horizontal_window_background'),
                          need(pictures, 'straight_horizontal_window'),
                      ]
                    : [need(pictures, 'straight_horizontal')]
            }
            if (conn[0] && conn[1]) {
                return [need(pictures, 'corner_up_right')]
            }
            if (conn[0] && conn[3]) {
                return [need(pictures, 'corner_up_left')]
            }
            if (conn[1] && conn[2]) {
                return [need(pictures, 'corner_down_right')]
            }
            if (conn[2] && conn[3]) {
                return [need(pictures, 'corner_down_left')]
            }
            if (conn[0]) {
                return [need(pictures, 'ending_up')]
            }
            if (conn[2]) {
                return [need(pictures, 'ending_down')]
            }
            if (conn[1]) {
                return [need(pictures, 'ending_right')]
            }
            if (conn[3]) {
                return [need(pictures, 'ending_left')]
            }
        }
        return [need(pictures, 'straight_vertical_single')]
    }
}
function draw_pipe_to_ground(e: PipeToGroundPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [dirEntry(need(e, 'pictures'), util.getDirName(data.dir))]
}
function draw_power_switch(e: PowerSwitchPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => [...need(e, 'power_on_animation', 'layers'), need(e, 'led_off')]
}
function draw_programmable_speaker(
    e: ProgrammableSpeakerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'sprite', 'layers')
}
function draw_proxy_container(
    e: ProxyContainerPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).picture.layers
}
function draw_pump(e: PumpPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [dirEntry(need(e, 'animations'), util.getDirName(data.dir))]
}
function draw_radar(e: RadarPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => need(e, 'pictures', 'layers')
}
function draw_rail_ramp(e: RailRampPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = data.dir
        let ps = (e as any).pictures[util.getDirName8Way(dir)]
        if (!ps || Object.entries(ps).length === 0) {
            ps = (e as any).pictures[util.getDirName8Way(dir % 8)]
        }
        if (!ps) return []
        return [ps.stone_path_background, ps.stone_path, ps.ties].filter(Boolean)
    }
}
function draw_rail_signal_base(
    e: RailSignalBasePrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = data.dir
        const pictureSet =
            data.railLayer === 'elevated' && (e as any).elevated_picture_set
                ? (e as any).elevated_picture_set
                : e.ground_picture_set

        // Rail piece sprites - elevated uses layers array, ground is flat
        const rpSprites = pictureSet.rail_piece.sprites.layers
            ? pictureSet.rail_piece.sprites.layers[0]
            : pictureSet.rail_piece.sprites
        const rpLineLength = rpSprites.line_length || 1
        let rp = duplicateAndSetPropertyUsing(rpSprites, 'x', 'width', dir % rpLineLength)
        rp = setPropertyUsing(rp, 'y', 'height', Math.floor(dir / rpLineLength))

        // Structure (signal body)
        let a = duplicateAndSetPropertyUsing(pictureSet.structure.layers[0], 'y', 'height', dir)
        const structure_index = pictureSet.signal_color_to_structure_frame_index.green
        a = setPropertyUsing(a, 'x', 'width', structure_index)
        return [rp, a]
    }
}
function draw_rail_support(e: RailSupportPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const layers = (e as any).graphics_set.structure.layers
        if (!layers || layers.length === 0) return []
        return [duplicateAndSetPropertyUsing(layers[0], 'x', 'width', data.dir / 4)]
    }
}
function draw_reactor(e: ReactorPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const patches = []
        for (const [i, conn] of need(e, 'heat_buffer', 'connections').entries()) {
            let patchSheet = sheetOf(need(e, 'connection_patches_disconnected'))
            if (data.positionGrid) {
                const connPos = util.vectorToTuple(conn.position)
                const c = getHeatConnections(
                    {
                        x: Math.floor(data.position.x) + connPos[0],
                        y: Math.floor(data.position.y) + connPos[1],
                    },
                    data.positionGrid
                )
                if (c[conn.direction / 4]) {
                    patchSheet = sheetOf(need(e, 'connection_patches_connected'))
                }
            }
            patchSheet = duplicateAndSetPropertyUsing(patchSheet, 'x', 'width', i)
            patchSheet = addToShift(conn.position, patchSheet)
            patches.push(patchSheet)
        }
        const lower = e.lower_layer_picture
        return [
            ...patches,
            // heating-tower has no lower layer; this used to put an undefined in
            // the list for EntitySprite.getParts to skip.
            ...(lower === undefined ? [] : [lower]),
            ...need(e, 'picture', 'layers'),
        ]
    }
}
function draw_roboport(e: RoboportPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => [
        ...need(e, 'base', 'layers'),
        need(e, 'door_animation_up'),
        need(e, 'door_animation_down'),
        need(e, 'base_animation'),
    ]
}
function draw_rocket_silo(e: RocketSiloPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => [
        need(e, 'door_back_sprite'),
        need(e, 'door_front_sprite'),
        need(e, 'base_day_sprite'),
        need(e, 'arm_01_back_animation'),
        need(e, 'arm_02_right_animation'),
        need(e, 'arm_03_front_animation'),
        need(e, 'satellite_animation'),
    ]
}
function draw_selector_combinator(
    e: SelectorCombinatorPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const operatorToSpriteData = (operator: SelectorCombinatorOperation): Sprite4Way => {
            switch (operator) {
                case 'select':
                    return data.selectorCombinatorSelectMax
                        ? need(e, 'max_symbol_sprites')
                        : need(e, 'min_symbol_sprites')
                case 'count':
                    return need(e, 'count_symbol_sprites')
                case 'random':
                    return need(e, 'random_symbol_sprites')
                case 'rocket-capacity':
                    return need(e, 'rocket_capacity_sprites')
                case 'stack-size':
                    return need(e, 'stack_size_sprites')
                case 'quality-transfer':
                case 'quality-filter':
                    return need(e, 'quality_symbol_sprites')
                default:
                    throw new Error(
                        `${e.name} has no sprite for selector operation "${String(operator)}"`
                    )
            }
        }
        const out = [...dirLayers(need(e, 'sprites'), util.getDirName(data.dir))]
        if (data.operator) {
            out.push(
                dirEntry(
                    operatorToSpriteData(data.operator as SelectorCombinatorOperation),
                    util.getDirName(data.dir)
                )
            )
        }
        return out
    }
}
function draw_solar_panel(e: SolarPanelPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => layersOf(need(e, 'picture'))
}
function draw_space_platform_hub(
    e: SpacePlatformHubPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return () => (e as any).graphics_set.picture.flatMap((p: any) => p.layers)
}
function draw_splitter(e: SplitterPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const b0Offset = util.rotatePointBasedOnDir([-0.5, 0], data.dir)
        const b1Offset = util.rotatePointBasedOnDir([0.5, 0], data.dir)

        const belt0Parts = getBeltSprites(
            need(e, 'belt_animation_set'),
            data.positionGrid ? util.sumprod(data.position, b0Offset) : b0Offset,
            data.dir,
            data.positionGrid,
            true,
            true,
            true
        ).map(sd => addToShift(b0Offset, sd))

        const belt1Parts = getBeltSprites(
            need(e, 'belt_animation_set'),
            data.positionGrid ? util.sumprod(data.position, b1Offset) : b1Offset,
            data.dir,
            data.positionGrid,
            true,
            true,
            true
        ).map(sd => addToShift(b1Offset, sd))

        const dir = util.getDirName(data.dir)
        return [
            ...belt0Parts,
            ...belt1Parts,
            dirEntry(need(e, 'structure_patch'), dir),
            dirEntry(need(e, 'structure'), dir),
        ]
    }
}
function draw_storage_tank(e: StorageTankPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [
        addToShift([0, 1], util.duplicate(need(need(e, 'pictures'), 'window_background'))),
        setPropertyUsing(
            util.duplicate(sheetsOf(need(e, 'pictures', 'picture'))[0]),
            'x',
            'width',
            Math.floor(data.dir / 4) %
                ((sheetsOf(need(e, 'pictures', 'picture'))[0] as SheetMeta).frames ?? 1)
        ),
    ]
}
function draw_thruster(e: ThrusterPrototype): (data: IDrawData) => readonly SpriteData[] {
    return () => {
        const gs = (e as any).graphics_set
        const out: SpriteData[] = []
        if (gs.integration_patch) out.push(gs.integration_patch)
        if (gs.animation?.layers) out.push(...gs.animation.layers)
        else if (gs.animation) out.push(gs.animation)
        return out
    }
}
function draw_train_stop(e: TrainStopPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const dir = util.getDirName(data.dir)
        let ta = util.duplicate(dirLayers(need(e, 'top_animations'), dir)[1])
        ta = setProperty(ta, 'tint', data.trainStopColor ? data.trainStopColor : e.color)
        return [
            dirEntry(need(e, 'rail_overlay_animations'), dir),
            ...dirLayers(need(e, 'animations'), dir),
            ...dirLayers(need(e, 'top_animations'), dir),
            ta,
            dirEntry(need(e, 'light1').picture, dir),
            dirEntry(need(e, 'light2').picture, dir),
        ]
    }
}
function draw_transport_belt(
    e: TransportBeltPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        if (data.generateConnector && data.positionGrid) {
            const connIndex = getBeltWireConnectionIndex(data.positionGrid, data.position, data.dir)
            const patchIndex = (() => {
                switch (connIndex) {
                    case 1:
                        return 0
                    case 3:
                        return 1
                    case 4:
                        return 2
                    default:
                        return undefined
                }
            })()

            const sprites = []

            if (patchIndex !== undefined) {
                const patch = sheetOf(need(e, 'connector_frame_sprites', 'frame_back_patch'))
                sprites.push(duplicateAndSetPropertyUsing(patch, 'x', 'width', patchIndex))
            }

            sprites.push(
                ...getBeltSprites(
                    need(e, 'belt_animation_set'),
                    data.position,
                    data.dir,
                    data.positionGrid
                )
            )

            let frame = sheetOf(need(e, 'connector_frame_sprites').frame_main)
            frame = duplicateAndSetPropertyUsing(frame, 'x', 'width', 1)
            sprites.push(setPropertyUsing(frame, 'y', 'height', connIndex))

            return sprites
        }
        return [
            ...getBeltSprites(
                need(e, 'belt_animation_set'),
                data.position,
                data.dir,
                data.positionGrid
            ),
        ]
    }
}
function draw_turret(e: TurretPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        if (e.folded_animation && layersOf(e.folded_animation)[0]) {
            return [
                duplicateAndSetPropertyUsing(
                    layersOf(e.folded_animation)[0],
                    'y',
                    'height',
                    data.dir / 4
                ),
            ]
        }
        return []
    }
}
function draw_underground_belt(
    e: UndergroundBeltPrototype
): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const isInput = data.dirType === 'input'
        const dir = isInput ? data.dir : (data.dir + 8) % 16

        const beltParts = getBeltSprites(
            need(e, 'belt_animation_set'),
            data.position,
            data.dir,
            data.positionGrid,
            isInput,
            !isInput,
            true
        )

        let mainBelt = beltParts[0]
        if (dir === 4 || dir === 12) {
            mainBelt = setPropertyUsing(mainBelt, 'width', 'size', 0.5)
        } else {
            mainBelt = setPropertyUsing(mainBelt, 'height', 'size', 0.5)
        }

        if (dir === 4) {
            mainBelt = setProperty(mainBelt, 'anchorX', 1)
        }
        if (dir === 12) {
            mainBelt = setProperty(mainBelt, 'anchorX', 0.5)
        }
        if (dir === 8) {
            mainBelt = setProperty(mainBelt, 'anchorY', 1)
        }
        if (dir === 0) {
            mainBelt = setProperty(mainBelt, 'anchorY', 0.5)
        }

        let sideloadingBack = false
        let sideloadingFront = false

        if (data.positionGrid && (dir === 4 || dir === 12)) {
            let C = data.positionGrid.getNeighbourData(data.position).map(d => {
                if (
                    d.entity &&
                    (d.entity.type === 'transport-belt' ||
                        d.entity.type === 'splitter' ||
                        ((d.entity.type === 'underground-belt' || d.entity.type === 'loader') &&
                            d.entity.directionType === 'output'))
                ) {
                    return d
                }
                return undefined
            })

            // Belt facing this belt
            C = C.map(d => {
                if (d && need(d, 'entity').direction === (d.relDir + 8) % 16) {
                    return d
                }
                return undefined
            })

            sideloadingBack = C[0] !== undefined
            sideloadingFront = C[2] !== undefined
        }

        const structure = need(e, 'structure')
        const sprites = []

        if (!sideloadingBack) {
            sprites.push(
                duplicateAndSetPropertyUsing(
                    sheetOf(need(structure, 'back_patch')),
                    'x',
                    'width',
                    dir / 4
                )
            )
        }

        sprites.push(mainBelt)

        sprites.push(
            duplicateAndSetPropertyUsing(
                sideloadingFront
                    ? isInput
                        ? sheetOf(need(structure, 'direction_in_side_loading'))
                        : sheetOf(need(structure, 'direction_out_side_loading'))
                    : isInput
                      ? sheetOf(need(structure, 'direction_in'))
                      : sheetOf(need(structure, 'direction_out')),
                'x',
                'width',
                dir / 4
            )
        )

        if (!sideloadingFront) {
            sprites.push(
                duplicateAndSetPropertyUsing(
                    sheetOf(need(structure, 'front_patch')),
                    'x',
                    'width',
                    dir / 4
                )
            )
        }

        if (beltParts[1]) {
            sprites.push(beltParts[1])
        }

        return sprites
    }
}
function draw_valve(e: ValvePrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => [(e as any).animations[util.getDirName(data.dir)]]
}
function draw_wall(e: WallPrototype): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        const pictures = need(e, 'pictures')

        if (data.positionGrid) {
            // Held in a local because the narrowing does not survive the
            // spawnFilling closure further down.
            const positionGrid = data.positionGrid
            const sprites = []

            const conn = positionGrid
                .getNeighbourData(data.position)
                .map(
                    ({ entity, relDir }) =>
                        entity &&
                        (entity.type === 'wall' ||
                            (entity.type === 'gate' && entity.direction % 8 === relDir % 8))
                )

            const wall = (() => {
                if (conn[1] && conn[2] && conn[3]) {
                    return layersOf(need(pictures, 't_up'))[0]
                } else if (conn[1] && conn[2]) {
                    return layersOf(need(pictures, 'corner_right_down'))[0]
                } else if (conn[2] && conn[3]) {
                    return layersOf(need(pictures, 'corner_left_down'))[0]
                } else if (conn[1] && conn[3]) {
                    return layersOf(need(pictures, 'straight_horizontal'))[0]
                } else if (conn[1]) {
                    return layersOf(need(pictures, 'ending_right'))[0]
                } else if (conn[2]) {
                    return layersOf(need(pictures, 'straight_vertical'))[0]
                } else if (conn[3]) {
                    return layersOf(need(pictures, 'ending_left'))[0]
                } else {
                    return layersOf(need(pictures, 'single'))[0]
                }
            })()

            sprites.push(
                duplicateAndSetPropertyUsing(
                    wall,
                    'x',
                    'width',
                    util.getRandomInt(0, (wall as SheetMeta).line_length ?? 1)
                )
            )

            const neighbourDirections = positionGrid
                .getNeighbourData(data.position)
                .filter(
                    ({ entity, relDir }) =>
                        entity && entity.type === 'gate' && entity.direction % 8 === relDir % 8
                )
                .map(({ relDir }) => relDir)

            for (const relDir of neighbourDirections) {
                const patch = duplicateAndSetPropertyUsing(
                    sheetsOf(need(pictures, 'gate_connection_patch'))[0],
                    'x',
                    'width',
                    relDir / 4
                )
                if (relDir === 0) {
                    sprites.unshift(patch)
                } else {
                    sprites.push(patch)
                }
            }

            const spawnFilling = [
                [-1, 0],
                [-1, 1],
                [0, 1],
            ]
                .map(o => {
                    const ent = positionGrid.getEntityAtPosition(util.sumprod(data.position, o))
                    return !!ent && ent.type === 'wall'
                })
                .every(e => e)

            if (spawnFilling) {
                let filling = duplicateAndSetPropertyUsing(
                    sheetOf(need(pictures, 'filling')),
                    'x',
                    'width',
                    util.getRandomInt(
                        0,
                        (pictures.filling as unknown as SheetMeta).line_length ?? 1
                    )
                )
                filling = setProperty(filling, 'anchorX', 1.17)
                sprites.push(filling)
            }

            sprites.push(
                ...neighbourDirections.map(relDir =>
                    duplicateAndSetPropertyUsing(
                        sheetOf(need(e, 'wall_diode_red')),
                        'x',
                        'width',
                        relDir / 4
                    )
                )
            )

            return sprites
        }

        return layersOf(need(pictures, 'single'))
    }
}

export { getSpriteData, getBeltWireConnectionIndex }
