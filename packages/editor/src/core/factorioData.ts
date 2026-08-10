import { CircuitConnectorDefinition } from 'factorio:prototype'
import { IconData, LocalisedString } from 'factorio:prototype'
import {
    RecipePrototype,
    IngredientPrototype,
    ProductPrototype,
    ItemPrototype,
    VirtualSignalPrototype,
    ModulePrototype,
    FluidPrototype,
    ColorStruct,
    TilePrototype,
    EntityWithOwnerPrototype,
    UtilitySprites,
    UtilityConstants,
    GuiStyle,
    HeatBuffer,
    EnergySource,
    CraftingMachinePrototype,
    AccumulatorPrototype,
    AgriculturalTowerPrototype,
    AmmoTurretPrototype,
    ArtilleryTurretPrototype,
    AssemblingMachinePrototype,
    AsteroidCollectorPrototype,
    BeaconPrototype,
    BoilerPrototype,
    BurnerGeneratorPrototype,
    CargoLandingPadPrototype,
    ConstantCombinatorPrototype,
    ContainerPrototype,
    CombinatorPrototype,
    DisplayPanelPrototype,
    ElectricEnergyInterfacePrototype,
    ElectricPolePrototype,
    ElectricTurretPrototype,
    FluidTurretPrototype,
    FurnacePrototype,
    FusionGeneratorPrototype,
    FusionReactorPrototype,
    GeneratorPrototype,
    HeatInterfacePrototype,
    HeatPipePrototype,
    InserterPrototype,
    LabPrototype,
    LampPrototype,
    LightningAttractorPrototype,
    LinkedContainerPrototype,
    LoaderPrototype,
    MiningDrillPrototype,
    OffshorePumpPrototype,
    PipePrototype,
    PipeToGroundPrototype,
    PowerSwitchPrototype,
    ProgrammableSpeakerPrototype,
    ProxyContainerPrototype,
    PumpPrototype,
    RadarPrototype,
    RailSignalBasePrototype,
    ReactorPrototype,
    RoboportPrototype,
    SolarPanelPrototype,
    SpacePlatformHubPrototype,
    SplitterPrototype,
    StorageTankPrototype,
    ThrusterPrototype,
    TrainStopPrototype,
    TransportBeltPrototype,
    TransportBeltConnectablePrototype,
    UndergroundBeltPrototype,
    LogisticContainerPrototype,
    TurretPrototype,
    ValvePrototype,
    WallPrototype,
} from 'factorio:prototype'
import { IPoint } from '../types'
import { need } from './need'
import { WireConnectionPoint } from 'factorio:prototype'
import { BoundingBox } from 'factorio:prototype'
import { MapPosition } from 'factorio:prototype'
import { FluidBox } from 'factorio:prototype'
import { EffectTypeLimitation } from 'factorio:prototype'

function getModulesFor(entityName: string): ModulePrototype[] {
    const e = FD.entities[entityName]
    if (!hasModuleFunctionality(e)) return []
    const allowed_effects = getAllowedEffects(e)
    if (allowed_effects.length === 0) return []
    const allowed_module_categories = e.allowed_module_categories
    return (
        Object.keys(FD.items)
            .map(k => FD.items[k])
            .filter(isModule)
            // filter modules based on entity allowed_effects (ex: beacons don't accept productivity effect)
            .filter(module =>
                Object.keys(module.effect)
                    .filter(effect => (module.effect[effect] ?? 0) > 0) // needed or else speed modules can't be placed in beacons, not sure what the game does here
                    .every(effect => allowed_effects.includes(effect))
            )
            .filter(
                module =>
                    !allowed_module_categories ||
                    allowed_module_categories.includes(module.category)
            )
    )
}

/**
 * A recipe's ingredient and result lists arrive in three shapes, not one, and
 * these hand back an array for all of them.
 *
 * typed-factorio models both fields as `readonly X[] | undefined`, which covers
 * two. The third is `{}`: the exporter writes Lua tables out as JSON, and an
 * empty Lua table has no way to say whether it was a list or a map, so it encodes
 * as an object. A recipe with no ingredients therefore arrives as `{}`, which is
 * neither undefined nor an array - it survives a `!== undefined` guard and a
 * `?? []` untouched and then throws "ingredients is not iterable" in the first
 * for-of that reaches it.
 *
 * In the current data all three are populated: the ten `parameter-N` placeholders
 * omit both fields, `recipe-unknown` has `{}` for both, and Space Age's
 * `biter-egg` pairs `{}` ingredients with a real results array. The first of those
 * is the one a player meets - a parametrised blueprint sets machines to
 * `parameter-N`, and the info panel threw on hovering one.
 */
export function recipeIngredients(recipe: RecipePrototype): readonly IngredientPrototype[] {
    return Array.isArray(recipe.ingredients) ? recipe.ingredients : []
}

/** @see recipeIngredients - same three shapes. */
export function recipeResults(recipe: RecipePrototype): readonly ProductPrototype[] {
    return Array.isArray(recipe.results) ? recipe.results : []
}

/**
 * A prototype's display name, as a string that can go straight into a `Text`.
 *
 * typed-factorio types `localised_name` as `LocalisedString`, which is the
 * nested form Factorio resolves at runtime - `['item-name.iron-plate']`, or a
 * number, or an array of those. The exporter resolves it before writing
 * data.json, so all 1352 in the current output are plain strings, and the field
 * is also optional on most prototypes while every one of them has it.
 *
 * Neither of those is worth trusting silently: a `LocalisedString` assigned to a
 * pixi `Text` is a type error, and the two sites that read it around a template
 * literal would have quietly rendered `[object Object]` instead. So the array
 * form is joined rather than dropped - a name that ever does arrive nested shows
 * up on screen looking wrong, which is findable, rather than not showing at all.
 */
export function localisedName(proto: { localised_name?: LocalisedString }): string {
    const name = proto.localised_name
    if (name === undefined) return ''
    if (Array.isArray(name))
        return name.map(part => localisedName({ localised_name: part })).join(' ')
    return String(name)
}

/**
 * Names of everything that can be picked as a signal-like icon: items, fluids,
 * and virtual signals. Used by `BlueprintIcon`, for one of a blueprint's own
 * four icon slots - Factorio allows the same range there as for any other
 * signal picker.
 */
export function acceptedSignalIcons(): string[] {
    const itemNames = FD.inventoryLayout.flatMap(group =>
        group.subgroups.flatMap(subgroup => subgroup.items.map(item => item.name))
    )
    return [...itemNames, ...Object.keys(FD.fluids), ...Object.keys(FD.signals)]
}

export function recipeSupportsModule(recipe: string, module: ModulePrototype): boolean {
    const r = FD.recipes[recipe]
    if (r.allowed_module_categories && !r.allowed_module_categories.includes(module.category))
        return false
    if (module.effect.consumption && !(r.allow_consumption === undefined || r.allow_consumption))
        return false
    if (module.effect.speed && !(r.allow_speed === undefined || r.allow_speed)) return false
    if (module.effect.productivity && !r.allow_productivity) return false
    if (module.effect.pollution && !(r.allow_pollution === undefined || r.allow_pollution))
        return false
    if (module.effect.quality && !(r.allow_quality === undefined || r.allow_quality)) return false
    return true
}

export function isInserter(e: EntityWithOwnerPrototype): e is InserterPrototype {
    const type: InserterPrototype['type'] = 'inserter'
    return e.type === type
}
export function isCraftingMachine(e: EntityWithOwnerPrototype): e is CraftingMachinePrototype {
    switch (e.type) {
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo': {
            return true
        }
        default:
            return false
    }
}
export function isTrainStop(e: EntityWithOwnerPrototype): e is TrainStopPrototype {
    const type: TrainStopPrototype['type'] = 'train-stop'
    return e.type === type
}
export function isMiningDrill(e: EntityWithOwnerPrototype): e is MiningDrillPrototype {
    const type: MiningDrillPrototype['type'] = 'mining-drill'
    return e.type === type
}
export function isBeacon(e: EntityWithOwnerPrototype): e is BeaconPrototype {
    const type: BeaconPrototype['type'] = 'beacon'
    return e.type === type
}
export function isRoboport(e: EntityWithOwnerPrototype): e is RoboportPrototype {
    const type: RoboportPrototype['type'] = 'roboport'
    return e.type === type
}
export function isElectricPole(e: EntityWithOwnerPrototype): e is ElectricPolePrototype {
    const type: ElectricPolePrototype['type'] = 'electric-pole'
    return e.type === type
}
export function isUndergroundBelt(e: EntityWithOwnerPrototype): e is UndergroundBeltPrototype {
    const type: UndergroundBeltPrototype['type'] = 'underground-belt'
    return e.type === type
}
export function isLoader(e: EntityWithOwnerPrototype): e is LoaderPrototype {
    return e.type === 'loader' || e.type === 'loader-1x1'
}
export function isLogisticContainer(e: EntityWithOwnerPrototype): e is LogisticContainerPrototype {
    return e.type === 'logistic-container' || e.type === 'infinity-container'
}
export function isTransportBeltConnectable(
    e: EntityWithOwnerPrototype
): e is TransportBeltConnectablePrototype {
    switch (e.type) {
        case 'transport-belt':
        case 'underground-belt':
        case 'splitter':
        case 'loader':
        case 'loader-1x1':
        case 'linked-belt':
        case 'lane-splitter':
            return true
        default:
            return false
    }
}

/**
 * Exported for `Entity.effectiveCraftingSpeed`, which sums the speed bonus of
 * whatever is in a machine's module slots. It uses the guard rather than
 * `getModule` because that throws for a non-module, and a paste that threw would
 * lose everything else it was carrying - here a non-module simply contributes no
 * speed.
 */
export function isModule(item: ItemPrototype): item is ModulePrototype {
    const type: ModulePrototype['type'] = 'module'
    return item.type === type
}
export function getModule(name: string): ModulePrototype {
    const item = FD.items[name]
    /*
        Two different failures, told apart (issue #55). An absent name used to
        reach `isModule(undefined)` and die on `.type` with a TypeError naming
        nothing; a present but non-module item reached a bare "Internal Error!".
        Callers pass a name off an entity's module slots, so either one means
        the blueprint and FD disagree, and which way round is the first thing
        anyone debugging it needs.
    */
    if (item === undefined) throw new Error(`No item named ${name}`)
    if (!isModule(item)) throw new Error(`Item ${name} is a ${item.type}, not a module`)
    return item
}

/*
    Returns undefined, not null, for "this entity has no circuit connector".
    The two used to be mixed: the default arm returned null while every other arm
    returned an optional prototype field, so the same absence arrived spelled two
    ways and the type could describe neither. Every caller tests truthiness, so
    settling on undefined - which is what the fields themselves are - costs
    nothing and removes the coercion the split would otherwise need at each arm.
*/
export function getCircuitConnector(
    e: EntityWithOwnerPrototype,
    dir: number,
    isLoaderInputting: () => boolean,
    getBeltConnectionIndex: () => number
): CircuitConnectorDefinition | undefined {
    switch (e.type) {
        case 'accumulator':
        case 'agricultural-tower':
        case 'artillery-turret':
        case 'cargo-landing-pad':
        case 'container':
        case 'infinity-container':
        case 'logistic-container':
        case 'temporary-container':
        case 'lamp':
        case 'linked-container':
        case 'programmable-speaker':
        case 'proxy-container':
        case 'radar':
        case 'reactor':
        case 'roboport':
        case 'space-platform-hub':
        case 'wall': {
            const e_resolved = e as
                | AccumulatorPrototype
                | AgriculturalTowerPrototype
                | ArtilleryTurretPrototype
                | CargoLandingPadPrototype
                | ContainerPrototype
                | LampPrototype
                | LinkedContainerPrototype
                | ProgrammableSpeakerPrototype
                | ProxyContainerPrototype
                | RadarPrototype
                | ReactorPrototype
                | RoboportPrototype
                | SpacePlatformHubPrototype
                | WallPrototype
            return e_resolved.circuit_connector
        }
        /*
            `splitter` is in this arm because a splitter takes circuit wires in
            2.0 and all four in data.json carry a four-entry circuit_connector
            indexed exactly the way the rest of this arm is. Leaving it out was
            not a missing sprite: nothing catches around WiresContainer.add, so
            a single wired splitter threw "Could not find the wire connection
            point!" out of initBP and lost the whole blueprint. It is also the
            only type in data.json carrying a circuit_connector that this
            function did not name - measured, not assumed.
        */
        case 'assembling-machine':
        case 'rocket-silo':
        case 'asteroid-collector':
        case 'display-panel':
        case 'furnace':
        case 'inserter':
        case 'mining-drill':
        case 'offshore-pump':
        case 'pump':
        case 'splitter':
        case 'storage-tank':
        case 'train-stop': {
            const e_resolved = e as
                | AssemblingMachinePrototype // also has circuit_connector_flipped
                | AsteroidCollectorPrototype
                | DisplayPanelPrototype
                | FurnacePrototype // also has circuit_connector_flipped
                | InserterPrototype
                | MiningDrillPrototype
                | OffshorePumpPrototype
                | PumpPrototype
                | SplitterPrototype
                | StorageTankPrototype
                | TrainStopPrototype
            return e_resolved.circuit_connector?.[dir / 4]
        }
        case 'rail-chain-signal':
        case 'rail-signal': {
            const e_resolved = e as RailSignalBasePrototype
            return e_resolved.ground_picture_set.circuit_connector?.[dir]
        }
        case 'loader':
        case 'loader-1x1': {
            const e_resolved = e as LoaderPrototype
            // First the four cardinal directions for `direction_out`, followed by the four directions for `direction_in`.
            return e_resolved.circuit_connector?.[(isLoaderInputting() ? 4 : 0) + dir / 4]
        }
        case 'transport-belt': {
            const e_resolved = e as TransportBeltPrototype
            // Set of 7 CircuitConnectorDefinition in order: X, H, V, SE, SW, NE and NW.
            return e_resolved.circuit_connector?.[getBeltConnectionIndex()]
        }
        case 'ammo-turret':
        case 'electric-turret':
        case 'fluid-turret':
        case 'turret': {
            const e_resolved = e as TurretPrototype
            // Set of CircuitConnectorDefinition for all directions used by this turret.
            // Required amount of elements is based on other prototype values: 8 elements if
            // building-direction-8-way flag is set, or 16 elements if
            // building-direction-16-way flag is set, or 4 elements if
            // turret_base_has_direction is set to true, or 1 element.
            let d = 0
            if (e.flags && e.flags.includes('building-direction-16-way')) {
                d = dir
            } else if (e.flags && e.flags.includes('building-direction-8-way')) {
                d = dir / 2
            } else if (e_resolved.turret_base_has_direction) {
                d = dir / 4
            }
            return e_resolved.circuit_connector?.[d]
        }
        default:
            return undefined
    }
}

export function getWireConnectionPoint(
    e: EntityWithOwnerPrototype,
    dir: number,
    getCombinatorSide: () => 'input' | 'output',
    getPowerSwitchSide: () => 'circuit' | 'left' | 'right'
): null | WireConnectionPoint {
    switch (e.type) {
        case 'arithmetic-combinator':
        case 'decider-combinator':
        case 'selector-combinator': {
            const e_resolved = e as CombinatorPrototype
            if (getCombinatorSide() === 'input') {
                return e_resolved.input_connection_points[dir / 4]
            } else {
                return e_resolved.output_connection_points[dir / 4]
            }
        }
        case 'constant-combinator': {
            const e_resolved = e as ConstantCombinatorPrototype
            return e_resolved.circuit_wire_connection_points[dir / 4]
        }
        case 'electric-pole': {
            const e_resolved = e as ElectricPolePrototype
            return e_resolved.connection_points[dir / 4]
        }
        case 'power-switch': {
            const e_resolved = e as PowerSwitchPrototype
            switch (getPowerSwitchSide()) {
                case 'circuit':
                    return e_resolved.circuit_wire_connection_point
                case 'left':
                    return e_resolved.left_wire_connection_point
                case 'right':
                    return e_resolved.right_wire_connection_point
            }
            // falls through
        }
        default:
            return null
    }
}

export function getFluidBoxes(
    e: EntityWithOwnerPrototype,
    assemblingMachineHasFluidRecipe: boolean
): readonly FluidBox[] {
    const fbs = getInnerFluidBoxes(e, assemblingMachineHasFluidRecipe)
    const es = getEnergySource(e)
    if (es && es.type === 'fluid') {
        fbs.push(es.fluid_box)
    }
    return fbs
}

function getInnerFluidBoxes(
    e: EntityWithOwnerPrototype,
    assemblingMachineHasFluidRecipe: boolean
): FluidBox[] {
    switch (e.type) {
        case 'boiler': {
            const e_resolved = e as BoilerPrototype
            const out = [e_resolved.fluid_box]
            if (e_resolved.mode === 'output-to-separate-pipe') {
                out.push(e_resolved.output_fluid_box)
            }
            return out
        }
        case 'assembling-machine': {
            const e_resolved = e as AssemblingMachinePrototype
            if (
                e_resolved.fluid_boxes_off_when_no_fluid_recipe &&
                !assemblingMachineHasFluidRecipe
            ) {
                return []
            } else {
                return [...(e_resolved.fluid_boxes || [])]
            }
        }
        case 'furnace':
        case 'rocket-silo': {
            const e_resolved = e as CraftingMachinePrototype
            return [...(e_resolved.fluid_boxes || [])]
        }
        case 'fluid-turret':
        case 'generator':
        case 'offshore-pump':
        case 'infinity-pipe':
        case 'pipe':
        case 'pipe-to-ground':
        case 'pump':
        case 'storage-tank':
        case 'valve': {
            const e_resolved = e as
                | FluidTurretPrototype
                | GeneratorPrototype
                | OffshorePumpPrototype
                | PipePrototype
                | PipeToGroundPrototype
                | PumpPrototype
                | StorageTankPrototype
                | ValvePrototype
            return [e_resolved.fluid_box]
        }
        case 'fusion-generator':
        case 'fusion-reactor': {
            const e_resolved = e as FusionGeneratorPrototype | FusionReactorPrototype
            return [e_resolved.input_fluid_box, e_resolved.output_fluid_box]
        }
        case 'mining-drill': {
            const e_resolved = e as MiningDrillPrototype
            const out = []
            // if (e_resolved.input_fluid_box) out.push(e_resolved.input_fluid_box)
            if (e_resolved.output_fluid_box) out.push(e_resolved.output_fluid_box)
            return out
        }
        case 'thruster': {
            const e_resolved = e as ThrusterPrototype
            return [e_resolved.fuel_fluid_box, e_resolved.oxidizer_fluid_box]
        }
        default:
            return []
    }
}

/*
    `splitter` is listed here for the same reason it is listed in
    getCircuitConnector, but the cost of the omission was smaller: a missing
    distance is 0, and a wire whose reach is 0 is drawn at alpha 0.3 as though it
    never reached. Wrong, but visible rather than fatal.
*/
export function getMaxWireDistance(e: EntityWithOwnerPrototype): number {
    switch (e.type) {
        case 'electric-pole': {
            const e_resolved = e as ElectricPolePrototype
            return e_resolved.maximum_wire_distance || 0
        }
        case 'power-switch': {
            const e_resolved = e as PowerSwitchPrototype
            return e_resolved.wire_max_distance || 0
        }
        case 'accumulator':
        case 'agricultural-tower':
        case 'artillery-turret':
        case 'assembling-machine':
        case 'rocket-silo':
        case 'asteroid-collector':
        case 'cargo-landing-pad':
        case 'arithmetic-combinator':
        case 'decider-combinator':
        case 'selector-combinator':
        case 'constant-combinator':
        case 'container':
        case 'infinity-container':
        case 'logistic-container':
        case 'temporary-container':
        case 'display-panel':
        case 'furnace':
        case 'inserter':
        case 'lamp':
        case 'linked-container':
        case 'loader-1x1':
        case 'loader':
        case 'mining-drill':
        case 'offshore-pump':
        case 'programmable-speaker':
        case 'proxy-container':
        case 'pump':
        case 'radar':
        case 'rail-chain-signal':
        case 'rail-signal':
        case 'reactor':
        case 'roboport':
        case 'space-platform-hub':
        case 'splitter':
        case 'storage-tank':
        case 'train-stop':
        case 'transport-belt':
        case 'ammo-turret':
        case 'electric-turret':
        case 'fluid-turret':
        case 'turret':
        case 'wall': {
            const e_resolved = e as
                | AccumulatorPrototype
                | AgriculturalTowerPrototype
                | ArtilleryTurretPrototype
                | AssemblingMachinePrototype
                | AsteroidCollectorPrototype
                | CargoLandingPadPrototype
                | CombinatorPrototype
                | ConstantCombinatorPrototype
                | ContainerPrototype
                | DisplayPanelPrototype
                | FurnacePrototype
                | InserterPrototype
                | LampPrototype
                | LinkedContainerPrototype
                | LoaderPrototype
                | MiningDrillPrototype
                | OffshorePumpPrototype
                | ProgrammableSpeakerPrototype
                | ProxyContainerPrototype
                | PumpPrototype
                | RadarPrototype
                | RailSignalBasePrototype
                | ReactorPrototype
                | RoboportPrototype
                | SpacePlatformHubPrototype
                | SplitterPrototype
                | StorageTankPrototype
                | TrainStopPrototype
                | TransportBeltPrototype
                | TurretPrototype
                | WallPrototype
            return e_resolved.circuit_wire_max_distance || 0
        }
        default:
            return 0
    }
}

export function mapBoundingBox(bb: BoundingBox): [[number, number], [number, number]] {
    const mapP = (p: MapPosition): [number, number] =>
        Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]
    if (Array.isArray(bb)) {
        return [mapP(bb[0]), mapP(bb[1])]
    } else {
        return [mapP(bb.left_top), mapP(bb.right_bottom)]
    }
}

export function getEntitySize(e: EntityWithOwnerPrototype, dir: number = 0): IPoint {
    const bb = mapBoundingBox(need(e, 'collision_box'))
    const w = e.tile_width || Math.ceil(Math.abs(bb[0][0]) + Math.abs(bb[1][0]))
    const h = e.tile_height || Math.ceil(Math.abs(bb[0][1]) + Math.abs(bb[1][1]))
    if (w === h) {
        return { x: w, y: h }
    } else {
        // Normalize direction to nearest cardinal (0, 4, 8, 12) for size calculation
        // Curved rails use a 2-way swap; other entities round to nearest cardinal
        if (e.type === 'curved-rail-a' || e.type === 'curved-rail-b') {
            dir = Math.floor((dir % 8) / 4) * 4
        } else {
            dir = (Math.round(dir / 4) * 4) % 16
        }
        switch (dir) {
            case 0:
            case 8:
                return { x: w, y: h }
            case 4:
            case 12:
                return { x: h, y: w }
            default:
                return { x: w, y: h }
        }
    }
}

export function getPossibleRotations(
    e: EntityWithOwnerPrototype,
    assemblingMachineHasFluidRecipe: boolean = false
): number[] {
    if (e.flags && e.flags.includes('not-rotatable')) {
        return []
    }
    if (e.flags && e.flags.includes('building-direction-8-way')) {
        return [0, 2, 4, 6, 8, 10, 12, 14]
    }
    if (e.flags && e.flags.includes('building-direction-16-way')) {
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    }
    switch (e.type) {
        case 'agricultural-tower':
        case 'artillery-turret':
        case 'asteroid-collector':
        case 'boiler':
        case 'burner-generator':
        case 'arithmetic-combinator':
        case 'decider-combinator':
        case 'selector-combinator':
        case 'constant-combinator':
        case 'fusion-generator':
        case 'gate':
        case 'generator':
        case 'inserter':
        case 'lightning-attractor':
        case 'mining-drill':
        case 'offshore-pump':
        case 'pipe-to-ground':
        case 'pump':
        case 'curved-rail-a':
        case 'elevated-curved-rail-a':
        case 'curved-rail-b':
        case 'elevated-curved-rail-b':
        case 'half-diagonal-rail':
        case 'elevated-half-diagonal-rail':
        case 'legacy-curved-rail':
        case 'legacy-straight-rail':
        case 'rail-ramp':
        case 'straight-rail':
        case 'elevated-straight-rail':
        case 'rail-chain-signal':
        case 'rail-signal':
        case 'rail-support':
        case 'simple-entity-with-owner':
        case 'simple-entity-with-force':
        case 'thruster':
        case 'train-stop':
        case 'lane-splitter':
        case 'linked-belt':
        case 'loader-1x1':
        case 'loader':
        case 'splitter':
        case 'transport-belt':
        case 'underground-belt':
        case 'turret':
        case 'ammo-turret':
        case 'electric-turret':
        case 'fluid-turret':
        case 'valve':
        case 'artillery-wagon':
        case 'cargo-wagon':
        case 'infinity-cargo-wagon':
        case 'fluid-wagon':
        case 'locomotive':
        case 'display-panel':
            return [0, 4, 8, 12]
        case 'storage-tank':
        case 'fusion-reactor': {
            const e_resolved = e as StorageTankPrototype | FusionReactorPrototype
            if (e_resolved.two_direction_only) {
                return [0, 4]
            } else {
                return [0, 4, 8, 12]
            }
        }
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo': {
            const e_resolved = e as CraftingMachinePrototype
            const fbs = getFluidBoxes(e_resolved, assemblingMachineHasFluidRecipe)
            const energy_source = getEnergySource(e_resolved)
            const size = getEntitySize(e_resolved)
            let canBeRotated = false
            if (fbs.length > 0) {
                canBeRotated = true
            } else if (
                energy_source &&
                (energy_source.type === 'heat' || energy_source.type === 'fluid')
            ) {
                canBeRotated = true
            } else if (size.x !== size.y) {
                canBeRotated = true
            }
            if (canBeRotated) {
                return [0, 4, 8, 12]
            } else {
                return []
            }
        }
        default:
            return []
    }
}

export function getHeatBuffer(e: EntityWithOwnerPrototype): null | HeatBuffer {
    switch (e.type) {
        case 'heat-pipe':
        case 'heat-interface':
        case 'reactor': {
            const e_resolved = e as HeatPipePrototype | HeatInterfacePrototype | ReactorPrototype
            return e_resolved.heat_buffer
        }
        default:
            return null
    }
}
/** undefined for "no energy source", for the same reason getCircuitConnector is. */
export function getEnergySource(e: EntityWithOwnerPrototype): EnergySource | undefined {
    switch (e.type) {
        case 'agricultural-tower':
        case 'boiler':
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo':
        case 'inserter':
        case 'lab':
        case 'mining-drill':
        case 'offshore-pump':
        case 'pump':
        case 'radar':
        case 'reactor':
        case 'loader-1x1':
        case 'loader': {
            const e_resolved = e as
                | AgriculturalTowerPrototype
                | BoilerPrototype
                | CraftingMachinePrototype
                | InserterPrototype
                | LabPrototype
                | MiningDrillPrototype
                | OffshorePumpPrototype
                | PumpPrototype
                | RadarPrototype
                | ReactorPrototype
                | LoaderPrototype
            return e_resolved.energy_source
        }
        case 'accumulator':
        case 'ammo-turret':
        case 'asteroid-collector':
        case 'beacon':
        case 'burner-generator':
        case 'arithmetic-combinator':
        case 'decider-combinator':
        case 'selector-combinator':
        case 'electric-energy-interface':
        case 'electric-turret':
        case 'fusion-generator':
        case 'fusion-reactor':
        case 'generator':
        case 'lamp':
        case 'lightning-attractor':
        case 'programmable-speaker':
        case 'roboport':
        case 'solar-panel': {
            const e_resolved = e as
                | AccumulatorPrototype
                | AmmoTurretPrototype
                | AsteroidCollectorPrototype
                | BeaconPrototype
                | BurnerGeneratorPrototype
                | CombinatorPrototype
                | ElectricEnergyInterfacePrototype
                | ElectricTurretPrototype
                | FusionGeneratorPrototype
                | FusionReactorPrototype
                | GeneratorPrototype
                | LampPrototype
                | LightningAttractorPrototype
                | ProgrammableSpeakerPrototype
                | RoboportPrototype
                | SolarPanelPrototype
            return e_resolved.energy_source
        }
        default:
            return undefined
    }
}

export function getColor(
    color:
        | ColorStruct
        | readonly [number, number, number]
        | readonly [number, number, number, number]
): ColorWithAlpha {
    if (Array.isArray(color)) {
        return {
            r: color[0],
            g: color[1],
            b: color[2],
            a: color[3] || 1,
        }
    } else {
        return {
            r: color.r || 0,
            g: color.g || 0,
            b: color.b || 0,
            a: color.a || 1,
        }
    }
}

/**
 * Everything `data.json` carries, as the rest of the editor reads it.
 *
 * Named rather than inline so a fixture or a mock can say what shape it is
 * standing in for, and so the assertion below has something to point at.
 */
export interface FactorioData {
    items: Record<string, ItemPrototype>
    fluids: Record<string, FluidPrototype>
    signals: Record<string, VirtualSignalPrototype>
    recipes: Record<string, RecipePrototype>
    entities: Record<string, EntityWithOwnerPrototype>
    tiles: Record<string, TilePrototype>
    inventoryLayout: InventoryLayoutGroup[]
    utilitySprites: UtilitySprites
    utilityConstants: UtilityConstants
    guiStyle: GuiStyle
    defines: typeof defines
    // treesAndRocks: Record<string, TreeOrRock>

    getModulesFor: (entityName: string) => ModulePrototype[]
}

/*
    Empty until `loadData` runs, which fills in all twelve properties before
    anything reads one - the same fill-in-later invariant `G` carries in
    common/globals.ts, and asserted the same way it is there.

    This used to be a `@ts-ignore` over the declaration. The claim was fine; the
    suppression was the wrong shape for it. `@ts-ignore` silences *everything*
    reported on the next line, so a property whose type stopped resolving would
    have gone as quietly as the one error being waved through, and it would have
    kept doing so after the reason for it went away. The assertion says the one
    thing being claimed and leaves every other error on the line reported
    (issue #84).
*/
const FD = {} as FactorioData

/**
 * Every property `loadData` fills in, as a record rather than a list so the type
 * constrains it in both directions: `Record<keyof FactorioData, true>` rejects a
 * name that is not a property *and* requires every property to appear. A list
 * `satisfies readonly (keyof FactorioData)[]` would only do the first, leaving a
 * property added to the interface silently unguarded - which is the failure this
 * guard exists to stop, one field further along.
 */
const FD_KEYS: Record<keyof FactorioData, true> = {
    items: true,
    fluids: true,
    signals: true,
    recipes: true,
    entities: true,
    tiles: true,
    inventoryLayout: true,
    utilitySprites: true,
    utilityConstants: true,
    guiStyle: true,
    defines: true,
    getModulesFor: true,
}

/*
    Until `loadData` runs, reading any of them says so.

    An empty `FD` is silent by default and surfaces a long way from its cause: the
    reported shape was `Cannot read properties of undefined (reading
    'requester-chest')` thrown inside an AJV custom keyword, in a spec that had
    nothing to do with the change being made, which reads exactly like a
    regression (issue #109). Nothing in that message names `FD`, `loadData`, or
    the fact that data.json never arrived.

    Costs nothing once loaded, and costs `loadData` nothing to adopt: the setter
    replaces the accessor with an ordinary data property on the first write, so
    `loadData` assigns exactly as it always did and every read after startup is a
    plain property rather than a getter or a proxy trap.

    Note this guards the *shape*, not the timing of any one caller - there is no
    legitimate read of `FD` before `Editor.init()` has resolved, and measured,
    nothing in the editor reads one at module-init time.
*/
for (const key of Object.keys(FD_KEYS) as (keyof FactorioData)[]) {
    Object.defineProperty(FD, key, {
        configurable: true,
        enumerable: false,
        get(): never {
            throw new Error(
                `FD.${key} was read before data.json was loaded. ` +
                    'Editor.init() fetches it and calls loadData(); nothing may read FD ' +
                    'until that has resolved. See issue #109.'
            )
        },
        set(value: unknown): void {
            Object.defineProperty(FD, key, {
                value,
                writable: true,
                enumerable: true,
                configurable: true,
            })
        },
    })
}

export function loadData(str: string): void {
    const data = JSON.parse(str)
    console.log(data)
    FD.items = data.items
    FD.fluids = data.fluids
    FD.signals = data.signals
    FD.recipes = data.recipes
    FD.entities = data.entities
    FD.tiles = data.tiles
    FD.inventoryLayout = data.inventoryLayout
    FD.utilitySprites = data.utilitySprites
    FD.utilityConstants = data.utilityConstants
    FD.guiStyle = data.guiStyle
    FD.defines = data.defines
    FD.getModulesFor = getModulesFor

    for (const e of Object.values(FD.entities)) {
        // separate fast_replaceable_group since we don't support fast replacing different types
        if (e.type === 'splitter') {
            e.fast_replaceable_group = 'splitter'
        } else if (e.type === 'underground-belt') {
            e.fast_replaceable_group = 'underground-belt'
        }
    }
}

export default FD

export function hasModuleFunctionality(
    e: EntityWithOwnerPrototype
): e is LabPrototype | MiningDrillPrototype | BeaconPrototype | CraftingMachinePrototype {
    switch (e.type) {
        case 'lab':
        case 'mining-drill':
        case 'beacon':
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo':
            return true
        default:
            return false
    }
}

function getAllowedEffects(e: EntityWithOwnerPrototype): readonly EffectTypeLimitation[] {
    if (hasModuleFunctionality(e)) {
        const allowed_effects = e.allowed_effects
        if (allowed_effects) {
            return Array.isArray(allowed_effects) ? allowed_effects : [allowed_effects]
        }
    }
    // for defaults
    switch (e.type) {
        case 'lab':
            return ['speed', 'productivity', 'consumption', 'pollution']
        case 'mining-drill':
            return ['speed', 'productivity', 'consumption', 'pollution', 'quality']
        case 'beacon':
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo':
            return []
        default:
            throw new Error('Forgot to set a default!')
    }
}

export function hasModuleIconsSuppressed(e: EntityWithOwnerPrototype): boolean {
    switch (e.type) {
        case 'beacon': {
            const e_resolved = e as BeaconPrototype
            return !!e_resolved.graphics_set?.module_icons_suppressed
        }
        default:
            return false
    }
}

export function getModuleInventoryIndex(e: EntityWithOwnerPrototype): null | number {
    switch (e.type) {
        case 'lab':
            return FD.defines.inventory.lab_modules
        case 'mining-drill':
            return FD.defines.inventory.mining_drill_modules
        case 'beacon':
            return FD.defines.inventory.beacon_modules
        case 'assembling-machine':
        case 'furnace':
        case 'rocket-silo':
            return FD.defines.inventory.crafter_modules
        default:
            return null
    }
}

export interface Color {
    r: number
    g: number
    b: number
}

export interface ColorWithAlpha extends Color {
    a: number
}

export interface InventoryLayoutGroup {
    name: string
    icon: string
    icons?: IconData[]
    icon_size?: number
    order: string
    subgroups: InventoryLayoutSubgroup[]
    localised_name: string
}

export interface InventoryLayoutSubgroup {
    name: string
    order: string
    items: InventoryLayoutItem[]
}

export interface InventoryLayoutItem {
    name: string
    icon?: string
    icons?: IconData[]
    order: string
}
