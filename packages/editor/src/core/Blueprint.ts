import EventEmitter from 'eventemitter3'
import { Sprite, Texture } from 'pixi.js'
import {
    BlueprintInsertPlan,
    IBlueprint,
    IEntity,
    InventoryPosition,
    IPoint,
    ISchedule,
    ScheduleData,
    LogisticFilter,
    LogisticSection,
    LogisticSections,
    SignalType,
} from '../types'
import G from '../common/globals'
import util from '../common/util'
import FD, { getEntitySize, getModuleInventoryIndex, hasModuleFunctionality } from './factorioData'
import { Entity } from './Entity'
import { WireConnections } from './WireConnections'
import { PositionGrid } from './PositionGrid'
import * as generators from './generators'
import { IVisualization } from './generators'
import { History } from './History'
import { Tile } from './Tile'
import { need } from './need'
import { getFactorioVersion } from './factorioVersion'

export interface IOilOutpostSettings extends Record<string, string | boolean | number> {
    DEBUG: boolean
    PUMPJACK_MODULE: string
    MIN_GAP_BETWEEN_UNDERGROUNDS: number
    BEACONS: boolean
    MIN_AFFECTED_ENTITIES: number
    BEACON_MODULE: string
}

const oilOutpostSettings: IOilOutpostSettings = {
    DEBUG: false,
    PUMPJACK_MODULE: 'productivity-module-3',
    MIN_GAP_BETWEEN_UNDERGROUNDS: 1,
    BEACONS: true,
    MIN_AFFECTED_ENTITIES: 1,
    BEACON_MODULE: 'speed-module-3',
}

class OurMap<K, V> extends Map<K, V> {
    // The two arguments only ever make sense together - there is no key without
    // a key function - which the overloads say and a pair of optionals did not.
    public constructor()
    public constructor(values: V[], mapFn: (value: V) => K)
    public constructor(values?: V[], mapFn?: (value: V) => K) {
        if (values !== undefined && mapFn !== undefined) {
            super(values.map(e => [mapFn(e), e]))
        } else {
            super()
        }
    }

    public isEmpty(): boolean {
        return this.size === 0
    }

    public valuesArray(): V[] {
        return [...this.values()]
    }

    public find(predicate: (value: V, key: K) => boolean): V | undefined {
        for (const [k, v] of this) {
            if (predicate(v, k)) return v
        }
        return undefined
    }

    public filter(predicate: (value: V, key: K) => boolean): V[] {
        const result: V[] = []
        for (const [k, v] of this) {
            if (predicate(v, k)) {
                result.push(v)
            }
        }
        return result
    }
}

interface IEntityData extends Omit<IEntity, 'entity_number'> {
    entity_number?: number
}

export interface BlueprintEvents {
    'create-entity': [entity: Entity]
    'remove-entity': []
    'create-tile': [tile: Tile]
    name: []
    description: []
    icon: [index: 1 | 2 | 3 | 4]
    snapToGrid: []
    absoluteSnapping: []
    positionRelativeToGrid: []
    gridPositionOffset: []
}

/** `IPoint`s compare by value everywhere they're read; this is the one place
 * that needs to know whether a new one is actually a change. */
function pointsEqual(a: IPoint | undefined, b: IPoint | undefined): boolean {
    if (a === b) return true
    if (a === undefined || b === undefined) return false
    return a.x === b.x && a.y === b.y
}

/** Blueprint base class */
class Blueprint extends EventEmitter<BlueprintEvents> {
    // Boxed rather than bare fields, same reasoning as scheduleStore below:
    // `History.updateValue` needs `keyof T` on whatever it is handed, and
    // `keyof this` never includes a private member, so routing edits through
    // `this` directly does not type check.
    private readonly nameStore: { name: string } = { name: 'Blueprint' }
    private readonly descriptionStore: { description?: string } = {}
    private readonly icons = new Map<1 | 2 | 3 | 4, string>()
    public readonly wireConnections = new WireConnections(this)
    public readonly entityPositionGrid = new PositionGrid(this)
    public readonly entities = new OurMap<number, Entity>()
    public readonly tiles = new OurMap<string, Tile>()
    public readonly history = new History()

    // unused blueprint properties
    /*
        Boxed, unlike its neighbours, because it is the one of them that changes:
        `setSchedule` rewrites it when a locomotive is pasted onto (issue #115),
        and that goes through `history` so it undoes with everything else.
        `History.updateValue` takes an object and a key, and `keyof this` never
        includes a private member, so handing it `this` does not type check and
        casting around that would mean asserting a lie about the class. A box it
        can address honestly is cheaper than either.

        Still carried verbatim in every other respect - the editor has no schedule
        editor, and nothing reads the contents.
    */
    private readonly scheduleStore: { schedules?: ISchedule[] } = {}
    // Boxed for the same reason as nameStore/descriptionStore above - editable
    // now via BlueprintAlignmentEditor, so each needs a History.updateValue
    // target `keyof this` cannot give it directly.
    private readonly snapToGridStore: { snapToGrid?: IPoint } = {}
    private readonly absoluteSnappingStore: { absoluteSnapping?: boolean } = {}
    private readonly positionRelativeToGridStore: { positionRelativeToGrid?: IPoint } = {}
    /**
     * `BlueprintAlignment`'s "Grid position" field - carries no field of its
     * own in the blueprint string, unlike `absoluteSnapping`/
     * `positionRelativeToGrid` beside it, and is not directly settable
     * through the game's own scripting API either (confirmed against
     * `probe-blueprint-grid-position.mjs`, which set
     * `blueprint_position_relative_to_grid` - that is Absolute X/Y, a
     * different field, and its own conclusion that grid position leaves
     * entities alone does not transfer). Round-tripping a real export
     * directly through the game showed the opposite for the field this
     * class means: typing a target there moves every entity so that
     * `getGridPositionDisplay()`'s formula, applied to the result, equals
     * what was typed - see that method's own doc comment for the formula.
     *
     * This store holds that shift, applied only inside `serialize()` against
     * `computeExportCenter()`'s result - never against `entities`/`tiles`
     * themselves. An earlier version moved every entity directly and relied
     * on the shifted bounding box surviving into the export; that cannot
     * work in *this* codebase, since `serialize()` re-centers on that same
     * bounding box on every call, which any uniform translation is invisible
     * to by construction - translating every entity by (dx, dy) moves the
     * box's centre by exactly (dx, dy) too, so subtracting the (now-shifted)
     * centre from the (now-shifted) positions always reproduces the
     * pre-translation numbers. (The game itself evidently does not re-centre
     * an export around its own bounding box the way this class does - a
     * real export's entities sit nowhere near centred on their own bounding
     * box - which is the other half of why moving entities here would not
     * reproduce what the game does even if the recentre problem were fixed.)
     * Storing the offset separately and applying it once, after the real
     * centre is computed, is what a bounding-box recentre cannot undo - and
     * it comes with tiles for free, since both loops in `serialize()`
     * subtract the same adjusted centre and can no longer drift apart the
     * way moving only entities did.
     */
    private readonly gridPositionOffsetStore: { gridPositionOffset?: IPoint } = {}

    private m_nextEntityNumber = 1

    public constructor(data?: Partial<IBlueprint>) {
        super()

        if (data) {
            if (data.label) {
                this.name = data.label
            }

            if (data.icons) {
                for (const icon of data.icons) {
                    if (!icon.signal.name) continue
                    this.icons.set(icon.index, icon.signal.name)
                }
            }

            const offset = getOffset(data)

            if (data.tiles) {
                this.tiles = new OurMap(
                    data.tiles.map(
                        tile =>
                            new Tile(
                                tile.name,
                                Math.floor(tile.position.x + offset.x) + 0.5,
                                Math.floor(tile.position.y + offset.y) + 0.5
                            )
                    ),
                    t => t.hash
                )
            }

            if (data.entities !== undefined) {
                const pre_2_0 =
                    data.version !== undefined && data.version < getFactorioVersion(2, 0, 0)
                const dirMult = pre_2_0 ? 2 : 1

                this.m_nextEntityNumber =
                    data.entities.reduce((acc, e) => Math.max(acc, e.entity_number), 0) + 1

                this.history.startTransaction()

                if (pre_2_0) {
                    for (const e of data.entities) {
                        this.wireConnections.createEntityConnections(
                            e.entity_number,
                            e.connections,
                            e.neighbours
                        )
                        delete e.connections
                        delete e.neighbours
                    }
                } else if (data.wires) {
                    this.wireConnections.createBpConnections(data.wires)
                    delete data.wires
                }

                this.entities = new OurMap(
                    data.entities.map(e => {
                        const direction = (e.direction || 0) * dirMult
                        let position = util.sumprod(e.position, offset)
                        // Approximate position of placeable_off_grid entities (i.e. landmines)
                        if (FD.entities[e.name]?.flags?.includes('placeable-off-grid')) {
                            const e_size = getEntitySize(FD.entities[e.name])
                            const size = util.rotatePointBasedOnDir(
                                [e_size.x / 2, e_size.y / 2],
                                direction
                            )
                            // Take the offset into account for accurate positioning
                            const x = Math.round(e.position.x + offset.x - size.x) + size.x
                            const y = Math.round(e.position.y + offset.y - size.y) + size.y
                            position = { x, y }
                        }
                        if (pre_2_0 && e.name === 'straight-rail') {
                            e.name = 'legacy-straight-rail'
                        }
                        let items: BlueprintInsertPlan[] | undefined
                        if (e.items) {
                            if (!Array.isArray(e.items)) {
                                if (!pre_2_0) {
                                    throw new Error('Items is object but bp is not pre 2.0')
                                }
                                items = []
                                let stack = 0
                                for (const [name, count] of Object.entries(e.items)) {
                                    const item = FD.items[name]
                                    if (!item) continue
                                    if (item.type === 'module') {
                                        const inventory = getModuleInventoryIndex(
                                            FD.entities[e.name]
                                        )
                                        if (!inventory) {
                                            throw new Error("Can't find inventory index!")
                                        }
                                        const in_inventory: InventoryPosition[] = []
                                        for (let i = 0; i < count; i++) {
                                            in_inventory.push({
                                                inventory,
                                                stack,
                                            })
                                            stack += 1
                                        }
                                        items.push({
                                            id: { name },
                                            items: { in_inventory },
                                        })
                                    } else {
                                        throw new Error("Can't map item to new format!")
                                    }
                                }
                            } else {
                                items = e.items
                            }
                        }
                        if (
                            e.parameters &&
                            e.parameters.playback_globally !== undefined &&
                            !e.parameters.playback_mode
                        ) {
                            e.parameters.playback_mode = e.parameters.playback_globally
                                ? 'global'
                                : 'local'
                            delete e.parameters.playback_globally
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.read_logistics !== undefined &&
                            !e.control_behavior.read_items_mode
                        ) {
                            e.control_behavior.read_items_mode = e.control_behavior.read_logistics
                                ? FD.defines.control_behavior.roboport.read_items_mode.logistics
                                : FD.defines.control_behavior.roboport.read_items_mode.none
                            delete e.control_behavior.read_logistics
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.filters !== undefined &&
                            !e.control_behavior.sections
                        ) {
                            const filters: LogisticFilter[] = e.control_behavior.filters.map(f => ({
                                index: f.index,
                                type: f.signal.type,
                                name: f.signal.name,
                                count: f.count,
                            }))
                            const section: LogisticSection = { index: 1, filters }
                            e.control_behavior.sections = { sections: [section] }
                            delete e.control_behavior.filters
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.circuit_enable_disable !== undefined &&
                            e.control_behavior.circuit_enabled === undefined
                        ) {
                            e.control_behavior.circuit_enabled =
                                e.control_behavior.circuit_enable_disable
                            delete e.control_behavior.circuit_enable_disable
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.decider_conditions !== undefined &&
                            e.control_behavior.decider_conditions.conditions === undefined &&
                            e.control_behavior.decider_conditions.outputs === undefined
                        ) {
                            const c = e.control_behavior.decider_conditions
                            c.conditions = [
                                {
                                    comparator: c.comparator,
                                    constant: c.constant,
                                    first_signal: c.first_signal,
                                    first_signal_networks: c.first_signal_networks,
                                    second_signal: c.second_signal,
                                    second_signal_networks: c.second_signal_networks,
                                },
                            ]
                            c.outputs =
                                c.output_signal === undefined
                                    ? []
                                    : [
                                          {
                                              signal: c.output_signal,
                                              copy_count_from_input: c.copy_count_from_input,
                                          },
                                      ]
                            delete c.comparator
                            delete c.constant
                            delete c.copy_count_from_input
                            delete c.first_signal
                            delete c.first_signal_networks
                            delete c.second_signal
                            delete c.second_signal_networks
                            delete c.output_signal
                        }
                        if (typeof e.filter === 'string') {
                            e.filter = { name: e.filter }
                        }
                        if (
                            e.auto_launch !== undefined &&
                            e.launch_to_orbit_automatically === undefined
                        ) {
                            e.launch_to_orbit_automatically = e.auto_launch
                            delete e.auto_launch
                        }
                        if (
                            (e.request_filters !== undefined && Array.isArray(e.request_filters)) ||
                            e.request_from_buffers !== undefined
                        ) {
                            if (!pre_2_0) {
                                throw new Error('request_filters is array but bp is not pre 2.0')
                            }
                            const out: LogisticSections = {
                                request_from_buffers: e.request_from_buffers,
                            }
                            delete e.request_from_buffers
                            if (Array.isArray(e.request_filters)) {
                                const filters: LogisticFilter[] = e.request_filters.map(f => ({
                                    index: f.index,
                                    name: f.name,
                                    count: f.count === undefined ? 1 : f.count,
                                }))
                                /*
                                    1, not 0: every section Factorio writes is
                                    numbered from 1 - measured over the corpus,
                                    all 6017 request_filters sections are at 1,
                                    2 or 3 and all 1344 control_behavior ones run
                                    1 to 15. Nothing in this editor could see
                                    the difference, since every reader indexes
                                    the array positionally rather than by the
                                    section's own index, so a 0 round-tripped
                                    here perfectly and showed up only in the
                                    game (issue #89).
                                */
                                const section: LogisticSection = { index: 1, filters }
                                out.sections = [section]
                            }
                            e.request_filters = out
                        }

                        return this.createEntity({
                            ...e,
                            direction,
                            position,
                            items,
                        })
                    }),
                    e => e.entityNumber
                )

                if (data.version !== undefined && data.version < getFactorioVersion(1, 1, 11)) {
                    this.wireConnections.generatePowerPoleWires()
                }

                this.history.commitTransaction()
            }

            this.description = data.description
            this.scheduleStore.schedules = data.schedules
            this.snapToGridStore.snapToGrid = data['snap-to-grid']
            this.absoluteSnappingStore.absoluteSnapping = data['absolute-snapping']
            this.positionRelativeToGridStore.positionRelativeToGrid =
                data['position-relative-to-grid']
        }

        // makes initial entities non undoable and resets the history if the user cleared the editor
        this.history.reset()
        this.history.logging = G.debug

        return this
    }

    public get name(): string {
        return this.nameStore.name
    }

    public set name(name: string) {
        if (this.nameStore.name === name) return

        this.history
            .updateValue(this.nameStore, 'name', name, 'Change blueprint name')
            .onDone(() => this.emit('name'))
            .commit()
    }

    public get description(): string | undefined {
        return this.descriptionStore.description
    }

    public set description(description: string | undefined) {
        if (this.descriptionStore.description === description) return

        this.history
            .updateValue(
                this.descriptionStore,
                'description',
                description,
                'Change blueprint description'
            )
            .onDone(() => this.emit('description'))
            .commit()
    }

    /** Undefined means snapping is off - the same absence that made the
     * blueprint string omit `snap-to-grid` in the first place. */
    public get snapToGrid(): IPoint | undefined {
        return this.snapToGridStore.snapToGrid
    }

    public set snapToGrid(point: IPoint | undefined) {
        if (pointsEqual(this.snapToGridStore.snapToGrid, point)) return

        this.history
            .updateValue(this.snapToGridStore, 'snapToGrid', point, 'Change blueprint grid size')
            .onDone(() => this.emit('snapToGrid'))
            .commit()
    }

    /**
     * False (relative) is Factorio's own default - confirmed by decoding a
     * real blueprint string exported with Relative selected: the game omits
     * `absolute-snapping` entirely rather than writing `false`, the same way
     * it omits `position-relative-to-grid` at `{0, 0}`. Only an explicit
     * Absolute choice serializes the key, as `true`.
     */
    public get absoluteSnapping(): boolean {
        return this.absoluteSnappingStore.absoluteSnapping ?? false
    }

    public set absoluteSnapping(value: boolean) {
        if (this.absoluteSnapping === value) return

        this.history
            .updateValue(
                this.absoluteSnappingStore,
                'absoluteSnapping',
                value,
                'Change blueprint grid position mode'
            )
            .onDone(() => this.emit('absoluteSnapping'))
            .commit()
    }

    /** Only meaningful while `absoluteSnapping` is true - Absolute is the
     * mode the game actually carries a grid position under (issue #226);
     * `serialize()` drops it under Relative regardless of what this holds. */
    public get positionRelativeToGrid(): IPoint | undefined {
        return this.positionRelativeToGridStore.positionRelativeToGrid
    }

    public set positionRelativeToGrid(point: IPoint | undefined) {
        if (pointsEqual(this.positionRelativeToGridStore.positionRelativeToGrid, point)) return

        this.history
            .updateValue(
                this.positionRelativeToGridStore,
                'positionRelativeToGrid',
                point,
                'Change blueprint grid position'
            )
            .onDone(() => this.emit('positionRelativeToGrid'))
            .commit()
    }

    /** See `gridPositionOffsetStore`'s own doc comment - a pure export-time
     * shift, accumulated across every "Grid position" commit, never applied
     * to `entities`/`tiles` themselves. */
    public get gridPositionOffset(): IPoint {
        return this.gridPositionOffsetStore.gridPositionOffset ?? { x: 0, y: 0 }
    }

    public set gridPositionOffset(point: IPoint) {
        if (pointsEqual(this.gridPositionOffsetStore.gridPositionOffset, point)) return

        this.history
            .updateValue(
                this.gridPositionOffsetStore,
                'gridPositionOffset',
                point,
                'Change blueprint grid position offset'
            )
            .onDone(() => this.emit('gridPositionOffset'))
            .commit()
    }

    public getIcon(index: 1 | 2 | 3 | 4): string | undefined {
        return this.icons.get(index)
    }

    /**
     * `generateIcons` only fills the map in when it is empty at `serialize` time,
     * so clearing every slot by hand (all four `undefined`) is a real choice
     * rather than a no-op - it puts the blueprint back into "auto" the same way
     * it started, rather than locking in an all-empty icon set.
     */
    public setIcon(index: 1 | 2 | 3 | 4, name: string | undefined): void {
        if (this.icons.get(index) === name) return

        this.history
            .updateMap(this.icons, index, name, 'Change blueprint icon')
            .onDone(() => this.emit('icon', index))
            .commit()
    }

    public createEntity(rawData: IEntityData, connectPowerPole = false): Entity {
        const rawEntity = new Entity(
            {
                ...rawData,
                entity_number: rawData.entity_number
                    ? rawData.entity_number
                    : this.nextEntityNumber,
            },
            this
        )

        this.history
            .updateMap(this.entities, rawEntity.entityNumber, rawEntity, 'Create entity')
            .onDone(this.onCreateOrRemoveEntity.bind(this))
            .commit()

        if (connectPowerPole) this.wireConnections.connectPowerPole(rawEntity.entityNumber)

        return rawEntity
    }

    public removeEntity(entity: Entity): void {
        this.history.startTransaction('Remove entity')

        this.wireConnections.removeEntityConnections(entity.entityNumber)

        this.history
            .updateMap(this.entities, entity.entityNumber, undefined, 'Remove entity')
            .onDone(this.onCreateOrRemoveEntity.bind(this))
            .commit()

        this.history.commitTransaction()
    }

    public removeEntities(entities: Entity[]): void {
        this.history.startTransaction('Remove entities')
        for (const e of entities) {
            this.removeEntity(e)
        }
        this.history.commitTransaction()
    }

    public fastReplaceEntity(name: string, direction: number, position: IPoint): boolean {
        const entity = this.entityPositionGrid.checkFastReplaceableGroup(name, direction, position)

        if (!entity) return false

        this.history.startTransaction('Fast replace entity')

        const connections = this.wireConnections.getEntityConnections(entity.entityNumber)

        this.removeEntity(entity)

        this.createEntity({
            name,
            direction,
            position: entity.position,
            entity_number: entity.entityNumber,
        }).pasteSettings(entity)

        for (const conn of connections) {
            this.wireConnections.create(conn)
        }

        this.history.commitTransaction()

        return true
    }

    private onCreateOrRemoveEntity(
        newValue: Entity | undefined,
        oldValue: Entity | undefined
    ): void {
        if (newValue) {
            this.entityPositionGrid.setTileData(newValue)
            this.emit('create-entity', newValue)
        } else if (oldValue) {
            this.entityPositionGrid.removeTileData(oldValue)
            oldValue.destroy()
            this.emit('remove-entity')
        }
    }

    public createTiles(name: string, positions: IPoint[]): void {
        this.history.startTransaction('Create tiles')

        for (const p of positions) {
            const tile = new Tile(name, p.x, p.y)
            this.history
                .updateMap(this.tiles, tile.hash, tile, 'Create tile')
                .onDone(this.onCreateOrRemoveTile.bind(this))
                .commit()
        }

        this.history.commitTransaction()
    }

    public removeTiles(positions: IPoint[]): void {
        this.history.startTransaction('Remove tiles')

        positions
            .map(p => this.tiles.get(`${p.x},${p.y}`))
            .filter(tile => !!tile)
            .forEach(tile => {
                this.history
                    .updateMap(this.tiles, tile.hash, undefined, 'Remove tile')
                    .onDone(this.onCreateOrRemoveTile.bind(this))
                    .commit()
            })

        this.history.commitTransaction()
    }

    private onCreateOrRemoveTile(newValue: Tile | undefined, oldValue: Tile | undefined): void {
        if (oldValue) {
            oldValue.destroy()
        }

        if (newValue) {
            this.emit('create-tile', newValue)
        }
    }

    private get nextEntityNumber(): number {
        const nr = this.m_nextEntityNumber
        this.m_nextEntityNumber += 1
        return nr
    }

    public getFirstRailRelatedEntityPos(): IPoint | undefined {
        for (const [, e] of this.entities) {
            switch (e.type) {
                case 'legacy-straight-rail':
                case 'straight-rail':
                case 'half-diagonal-rail':
                case 'curved-rail-a':
                case 'curved-rail-b':
                case 'train-stop':
                    return e.position
                case 'legacy-curved-rail':
                    return { x: e.position.x - 1, y: e.position.y - 1 }
            }
        }
        return undefined
    }

    public isEmpty(): boolean {
        return this.entities.isEmpty() && this.tiles.isEmpty()
    }

    private getCenter(): IPoint {
        if (this.isEmpty()) return { x: 0, y: 0 }

        const data = [
            ...this.entities
                .valuesArray()
                .map(e => ({ x: e.position.x, y: e.position.y, w: e.size.x, h: e.size.y })),
            ...this.tiles.valuesArray().map(t => ({ x: t.x, y: t.y, w: 1, h: 1 })),
        ]

        const minX = data.reduce((min, d) => Math.min(min, d.x - d.w / 2), Infinity)
        const minY = data.reduce((min, d) => Math.min(min, d.y - d.h / 2), Infinity)
        const maxX = data.reduce((max, d) => Math.max(max, d.x + d.w / 2), -Infinity)
        const maxY = data.reduce((max, d) => Math.max(max, d.y + d.h / 2), -Infinity)

        return {
            x: Math.round((minX + maxX) / 2),
            y: Math.round((minY + maxY) / 2),
        }
    }

    public generatePipes(): string | undefined {
        const {
            DEBUG,
            PUMPJACK_MODULE,
            MIN_GAP_BETWEEN_UNDERGROUNDS,
            MIN_AFFECTED_ENTITIES,
            BEACON_MODULE,
            BEACONS,
        } = oilOutpostSettings

        const pumpjacks = this.entities
            .filter(v => v.name === 'pumpjack')
            .map(p => ({ entity_number: p.entityNumber, name: p.name, position: p.position }))

        if (pumpjacks.length < 2 || pumpjacks.length > 200) {
            return 'There should be between 2 and 200 pumpjacks in the blueprint area!'
        }

        if (pumpjacks.length !== this.entities.size) {
            return 'Blueprint area should only contain pumpjacks!'
        }

        const visualizations: IVisualization[][] = []

        console.log('Generating pipes...')

        const T = util.timer('Total generation')

        // Generate pipes
        const GPT = util.timer('Pipe generation')

        // I wrapped generatePipes into a Web Worker but for some reason it sometimes takes x2 time to run the function
        // Usualy when there are more than 100 pumpjacks the function will block the main thread
        // which is not great but the user should wait for the generated entities anyway
        const GP = generators.generatePipes(pumpjacks, MIN_GAP_BETWEEN_UNDERGROUNDS)
        visualizations.push(GP.visualizations)

        console.log('Pipes:', GP.info.nrOfPipes)
        console.log('Underground Pipes:', GP.info.nrOfUPipes)
        console.log('Pipes replaced by underground pipes:', GP.info.nrOfPipesReplacedByUPipes)
        console.log(
            'Ratio (pipes replaced/underground pipes):',
            GP.info.nrOfPipesReplacedByUPipes / GP.info.nrOfUPipes
        )
        GPT.stop()

        // Generate beacons
        let beacons: {
            name: string
            position: IPoint
        }[] = []
        if (BEACONS) {
            const GBT = util.timer('Beacon generation')

            const entitiesForBeaconGen = [
                ...pumpjacks.map(p => ({ ...p, size: 3, effect: true })),
                ...GP.pipes.map(p => ({ ...p, size: 1, effect: false })),
            ]

            const GB = generators.generateBeacons(entitiesForBeaconGen, MIN_AFFECTED_ENTITIES)
            beacons = GB.beacons
            visualizations.push(GB.visualizations)

            if (BEACONS) {
                console.log('Beacons:', GB.info.totalBeacons)
                console.log('Effects given by beacons:', GB.info.effectsGiven)
            }

            GBT.stop()
        }

        // Generate poles
        const GPOT = util.timer('Pole generation')

        const entitiesForPoleGen = [
            ...pumpjacks.map(p => ({ ...p, size: 3, power: true })),
            ...GP.pipes.map(p => ({ ...p, size: 1, power: false })),
            ...beacons.map(p => ({ ...p, size: 3, power: true })),
        ]

        const GPO = generators.generatePoles(entitiesForPoleGen)
        visualizations.push(GPO.visualizations)

        console.log('Power Poles:', GPO.info.totalPoles)
        GPOT.stop()

        T.stop()

        // Apply Changes
        this.history.logging = false
        this.history.startTransaction('Generate Oil Outpost')

        for (const pipe of GP.pipes) {
            this.createEntity(pipe)
        }
        const e = FD.entities['beacon']
        const inventory = getModuleInventoryIndex(e)
        if (inventory === null) {
            throw new Error('beacon has no module inventory')
        }
        const beacon_module_slots = (hasModuleFunctionality(e) && e.module_slots) || 0
        const items: BlueprintInsertPlan[] = []
        const in_inventory: InventoryPosition[] = []
        for (let i = 0; i < beacon_module_slots; i++) {
            in_inventory.push({
                inventory,
                stack: i,
            })
        }
        items.push({
            id: { name: BEACON_MODULE },
            items: { in_inventory },
        })
        for (const beacon of beacons) {
            this.createEntity({
                ...beacon,
                items,
            })
        }
        for (const pole of GPO.poles) {
            this.createEntity(pole)
        }

        this.wireConnections.generatePowerPoleWires()

        for (const p of GP.pumpjacksToRotate) {
            // Created by this same method a few lines up, so its absence would
            // mean the generator returned a number we never placed.
            const entity = this.entities.get(p.entity_number)
            if (entity === undefined) {
                throw new Error(`generator returned unknown entity ${p.entity_number}`)
            }
            entity.direction = p.direction
            if (PUMPJACK_MODULE !== 'none') {
                entity.modules = Array.from<string>({ length: entity.moduleSlots }).fill(
                    PUMPJACK_MODULE
                )
            }
        }

        this.history.commitTransaction()
        this.history.logging = true

        // Create visualizations
        if (!DEBUG) return

        // TODO: make a container special for debugging purposes
        G.BPC.wiresContainer.removeChildren()

        const timePerVis = 1000
        visualizations
            .filter(vis => vis.length)
            .forEach((vis, i) => {
                vis.forEach((v, j, arr) => {
                    setTimeout(
                        () => {
                            const tint = v.color ? v.color : 0xffffff * Math.random()
                            v.path.forEach((p, k) => {
                                setTimeout(
                                    () => {
                                        const s = new Sprite(Texture.WHITE)
                                        s.tint = tint
                                        s.anchor.set(0.5)
                                        s.alpha = v.alpha
                                        s.width = v.size
                                        s.height = v.size
                                        s.position.set(p.x * 32, p.y * 32)
                                        G.BPC.wiresContainer.addChild(s)
                                    },
                                    k * (timePerVis / arr.length / v.path.length)
                                )
                            })
                        },
                        j * (timePerVis / arr.length) + i * timePerVis
                    )
                })
            })
    }

    /** behaves like in Factorio 0.17.14 */
    private generateIcons(): void {
        /** returns [iconName, count][] */
        const getIconPairs = (
            tilesOrEntities: (Tile | Entity)[],
            getItemName: (name: string) => string | undefined
        ): [string, number][] => [
            ...tilesOrEntities.reduce<Map<string, number>>((map, tileOrEntity) => {
                const itemName = getItemName(tileOrEntity.name)
                // nothing to show for an entity that cannot be mined into an item
                if (itemName === undefined) return map
                const count = map.get(itemName)
                return map.set(itemName, count === undefined ? 0 : count + 1)
            }, new Map()),
        ]

        if (!this.entities.isEmpty()) {
            const getSize = (name: string): number => {
                const e_size = getEntitySize(FD.entities[need(FD.items[name], 'place_result')])
                return e_size.x * e_size.y
            }
            const getItemScore = (item: [string, number]): number => getSize(item[0]) * item[1]

            const iconPairs = getIconPairs(this.entities.valuesArray(), Entity.getItemName).sort(
                (a, b) => getItemScore(b) - getItemScore(a)
            )

            this.icons.set(1, iconPairs[0][0])
            if (
                iconPairs[1] &&
                getSize(iconPairs[1][0]) > 1 &&
                getItemScore(iconPairs[1]) * 2.5 > getItemScore(iconPairs[0])
            ) {
                this.icons.set(2, iconPairs[1][0])
            }
        } else if (!this.tiles.isEmpty()) {
            const iconPairs = getIconPairs(this.tiles.valuesArray(), Tile.getItemName).sort(
                (a, b) => b[1] - a[1]
            )

            this.icons.set(1, iconPairs[0][0])
        }
    }

    /**
     * The schedule the locomotive with this entity number is on, or undefined for
     * one that is on none.
     *
     * A schedule lives on the blueprint rather than on the entity - `schedules` is
     * a top-level list of `{locomotives, schedule}` - so this is the only way an
     * `Entity` can reach its own.
     */
    public getSchedule(entityNumber: number): ScheduleData | undefined {
        return this.scheduleStore.schedules?.find(s => s.locomotives.includes(entityNumber))
            ?.schedule
    }

    /**
     * Puts a locomotive on `schedule`, or takes it off whatever it was on when
     * that is undefined.
     *
     * Three behaviours here are measured rather than chosen, from
     * `tools/oracle/fixtures/copy-settings-schedule.json`:
     *
     * - it **replaces**. A locomotive already on a schedule is taken off that one
     *   first, so nothing merges.
     * - **undefined clears**, and is a real case rather than a no-op: the game's
     *   own copy from a locomotive with no schedule empties the target's, and the
     *   resulting blueprint has no `schedules` key at all.
     * - locomotives holding the **same** schedule share one entry, the way the
     *   game writes it, rather than getting one entry each.
     *
     * The sameness test is a JSON compare, which is exact for the case that
     * matters - a paste assigns the source's own schedule object, so the two
     * stringify identically. A separately built but equal schedule whose keys are
     * in another order would get its own entry, which is still valid output.
     */
    public setSchedule(entityNumber: number, schedule: ScheduleData | undefined): void {
        const key = schedule === undefined ? undefined : JSON.stringify(schedule)

        const next = (this.scheduleStore.schedules ?? [])
            .map(s => ({
                ...s,
                locomotives: s.locomotives.filter(n => n !== entityNumber),
            }))
            .filter(s => s.locomotives.length > 0)

        if (key !== undefined) {
            const existing = next.find(s => JSON.stringify(s.schedule) === key)
            if (existing) {
                existing.locomotives = [...existing.locomotives, entityNumber]
            } else {
                next.push({ locomotives: [entityNumber], schedule: schedule as ScheduleData })
            }
        }

        /*
            Absent rather than empty when nothing is left, so a blueprint that has
            had its last schedule removed serializes without the key, the way one
            that never had any does.
        */
        this.history
            .updateValue(
                this.scheduleStore,
                'schedules',
                next.length > 0 ? next : undefined,
                'Change train schedule'
            )
            .commit()
    }

    /** `getCenter()` plus the rail-parity nudge `serialize()` and
     * `getGridPositionDisplay()` both need - split out so the display method
     * can match what an export would actually centre on without duplicating
     * the parity arm. */
    private computeExportCenter(): IPoint {
        const center = this.getCenter()
        const firstRailPos = this.getFirstRailRelatedEntityPos()

        if (firstRailPos) {
            if ((firstRailPos.x - center.x) % 2 === 0) {
                center.x += 1
            }
            if ((firstRailPos.y - center.y) % 2 === 0) {
                center.y += 1
            }
        }

        return center
    }

    /**
     * What "Grid position" should display right now - measured directly
     * against the game rather than inferred from a screenshot (the #222
     * mistake `probe-blueprint-grid-position.mjs`'s own header describes):
     * typing a target into the field there moves every entity so that the
     * floored, negated minimum corner of the blueprint's own content equals
     * what was typed, and re-importing the result reproduces the same
     * number. That is this formula, applied to what this model would
     * currently export - `-floor(min x/y)` over every entity's and tile's
     * position, offset by `gridPositionOffset` exactly the way `serialize()`
     * offsets `computeExportCenter()`'s result, so the two stay in lockstep
     * without duplicating that arithmetic.
     *
     * Deliberately does not account for entity footprint size the way
     * `getCenter()` does - every measured case so far used 1x1 entities
     * sitting on a half-integer centre, where centre-floor and edge-floor
     * agree, so which one the game actually uses is untested. Revisit if a
     * larger entity (a `curved-rail-a`, an assembling machine) ever
     * disagrees with this.
     */
    public getGridPositionDisplay(): IPoint {
        if (this.isEmpty()) return { x: 0, y: 0 }

        const center = this.computeExportCenter()
        const offset = this.gridPositionOffset

        const xs = [
            ...this.entities.valuesArray().map(e => e.position.x),
            ...this.tiles.valuesArray().map(t => t.x),
        ]
        const ys = [
            ...this.entities.valuesArray().map(e => e.position.y),
            ...this.tiles.valuesArray().map(t => t.y),
        ]

        return {
            x: -Math.floor(Math.min(...xs) - center.x + offset.x),
            y: -Math.floor(Math.min(...ys) - center.y + offset.y),
        }
    }

    public serialize(): IBlueprint {
        if (!this.icons.size) {
            this.generateIcons()
        }
        const entityInfo = this.entities.valuesArray().map(e => e.serialize())
        const wires = this.wireConnections.serializeBpWires()
        const center = this.computeExportCenter()

        /*
            "Grid position"'s whole effect - see gridPositionOffsetStore's doc
            comment for why this has to land here, after the real centre (and
            its rail-parity nudge) are both settled, rather than as a move
            applied to entities/tiles beforehand: a recentre on the bounding
            box is blind to any translation of everything inside that box by
            the same amount, so the shift can only survive by being applied
            to the number doing the subtracting, once, after that number is
            final.
        */
        const offset = this.gridPositionOffset
        center.x -= offset.x
        center.y -= offset.y

        for (const e of entityInfo) {
            e.position.x -= center.x
            e.position.y -= center.y
        }
        const tileInfo = this.tiles.valuesArray().map(tile => ({
            position: {
                x: Math.floor(tile.x) - Math.floor(center.x),
                y: Math.floor(tile.y) - Math.floor(center.y),
            },
            name: tile.name,
        }))
        const iconData = [...this.icons.entries()].map(([index, icon]) => {
            const getItemTypeForBp = (name: string): SignalType => {
                if (FD.signals[name]) return 'virtual'
                if (FD.fluids[name]) return 'fluid'
                if (FD.recipes[name]) return 'recipe'
                if (FD.entities[name]) return 'entity'
                return 'item'
            }

            return {
                signal: { type: getItemTypeForBp(icon), name: icon },
                index,
            }
        })
        /*
            Measured against Factorio 2.0.77 (issue #226, tools/oracle/probe-
            blueprint-snapping.mjs), not reasoned about - the first version of
            this comment guessed `position-relative-to-grid` belongs to
            Relative mode from three hand-decoded strings, and the guess was
            wrong. The game writes the position under Absolute snapping and
            omits it under Relative; `tools/oracle/fixtures/blueprint-
            snapping.json` is the measured table this reads back to zero
            disagreements, the current condition disagreed on three of seven
            grid-bearing rows. Factorio omits each field at its own default
            (`snap-to-grid` off, `absolute-snapping` false, `position-
            relative-to-grid` `{0, 0}`) rather than writing it in both modes,
            and the two alignment fields both need `snap-to-grid` present
            before they mean anything - so this can't just forward the boxed
            stores the way `label`/`description` do, or turning `snap-to-grid`
            back off would leave a stale `absolute-snapping: true` behind from
            before it was.
        */
        const snapToGrid = this.snapToGridStore.snapToGrid
        const absoluteSnapping = this.absoluteSnappingStore.absoluteSnapping ?? false
        const positionRelativeToGrid = this.positionRelativeToGridStore.positionRelativeToGrid
        /*
            Unset only, not "or equals {0, 0}" - tests/blueprint-snapping.spec.ts's
            origin case pins that an explicit `{0, 0}` a blueprint arrived with
            passes straight through rather than being stripped as if it matched
            the game's own omit-at-origin behaviour. That is a deliberate
            difference from the game: this layer round-trips what it was given,
            and only an absent position (never set at all) counts as "nothing to
            write" here.
        */
        const positionIsUnset = positionRelativeToGrid === undefined

        return {
            icons: iconData,
            entities: this.entities.isEmpty() ? undefined : entityInfo,
            tiles: this.tiles.isEmpty() ? undefined : tileInfo,
            item: 'blueprint',
            version: getFactorioVersion(),
            label: this.name,
            description: this.description,
            schedules: this.scheduleStore.schedules,
            'absolute-snapping': snapToGrid && absoluteSnapping ? true : undefined,
            'snap-to-grid': snapToGrid,
            'position-relative-to-grid':
                snapToGrid && absoluteSnapping && !positionIsUnset
                    ? positionRelativeToGrid
                    : undefined,
            wires,
        }
    }
}

function getOffset(data: Partial<IBlueprint>): IPoint {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const comp = (x: number, y: number, w: number, h: number): void => {
        minX = Math.min(minX, x - w / 2)
        minY = Math.min(minY, y - h / 2)
        maxX = Math.max(maxX, x + w / 2)
        maxY = Math.max(maxY, y + h / 2)
    }

    if (data.entities) {
        for (const entity of data.entities) {
            if (FD.entities[entity.name]?.flags?.includes('placeable-off-grid')) continue

            const dirMult =
                data.version !== undefined && data.version < getFactorioVersion(2, 0, 0) ? 2 : 1
            const size = getEntitySize(FD.entities[entity.name], (entity.direction || 0) * dirMult)
            comp(entity.position.x, entity.position.y, size.x, size.y)
        }
    } else if (data.tiles) {
        for (const tile of data.tiles) {
            comp(tile.position.x + 0.5, tile.position.y + 0.5, 1, 1)
        }
    }

    if (minX === Infinity) {
        return { x: 0, y: 0 }
    }

    // The offset takes into account that the center of the blueprint might be shifted
    return {
        x: -Math.floor((minX + maxX) / 2) + (minX % 1),
        y: -Math.floor((minY + maxY) / 2) + (minY % 1),
    }
}

export { Blueprint, oilOutpostSettings, getFactorioVersion }
