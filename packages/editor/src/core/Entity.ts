import EventEmitter from 'eventemitter3'
import {
    IEntity,
    IPoint,
    FilterPriority,
    FilterMode,
    DirectionType,
    ComparatorString,
    ArithmeticOperation,
    ISignal,
    SelectorCombinatorOperation,
    LogisticSection,
    LogisticSections,
} from '../types'
import util from '../common/util'
import { IllegalFlipError } from '../containers/PaintContainer'
import G from '../common/globals'
import FD, {
    ColorWithAlpha,
    getCircuitConnector,
    getWireConnectionPoint,
    getEntitySize,
    getModule,
    getPossibleRotations,
    isCraftingMachine,
    isInserter,
    isLoader,
    isMiningDrill,
    isLogisticContainer,
    isRoboport,
    isUndergroundBelt,
    mapBoundingBox,
    getMaxWireDistance,
    hasModuleFunctionality,
    recipeSupportsModule,
    getModuleInventoryIndex,
    recipeIngredients,
    recipeResults,
} from './factorioData'
import { Blueprint } from './Blueprint'
import { getBeltWireConnectionIndex } from './spriteDataBuilder'
import U from './generators/util'
import { EntityWithOwnerPrototype, CombinatorPrototype, WirePosition } from 'factorio:prototype'

export interface IFilter {
    /** Slot index (1 based ... not 0 like arrays) */
    index: number
    /** Name of entity to be filtered */
    name: string
    /** If stacking is allowed, how many shall be stacked */
    count?: number
    /*
        The 2.0 fields this used to drop (issue #88). Optional because the
        entities sharing this shape do not all have them - a splitter filter is
        a bare name, and the pre-2.0 migration produces index/name/count - but
        for logistic chests they are the norm rather than the exception: every
        one of the 3461 filters in the corpus carries `quality` and `comparator`
        and 90 carry `max_count`.

        Absent is not the same as `normal` here. Factorio reads a filter with no
        quality as accepting any quality, so dropping the field on the way
        through is a silent change of meaning, not a cosmetic loss.
    */
    quality?: string
    comparator?: ComparatorString
    max_count?: number
}

/**
 * A filter as the editor's UI holds it, which is one entry per *slot* rather
 * than one per set filter - so an empty slot is present with no name.
 *
 * Only the `filters` setter takes these, and it drops the empty ones on the way
 * in (`list.filter(f => !!f.name)`), which is why the getter can still answer
 * the narrower `IFilter[]`: nothing without a name is ever stored.
 */
export interface IFilterSlot extends Omit<IFilter, 'name'> {
    name: string | undefined
}

export interface EntityEvents {
    destroy: []
    position: [newValue: IPoint, oldValue: IPoint]
    direction: []
    directionType: []
    recipe: [recipe: string | undefined]
    modules: [modules: (string | undefined)[]]
    splitterInputPriority: [priority: FilterPriority | undefined]
    splitterOutputPriority: [priority: FilterPriority | undefined]
    splitterFilter: []
    filters: []
    inserterFilters: []
    filterMode: [mode: FilterMode]
    logisticChestFilters: []
    requestFromBufferChest: []
    station: []
    manualTrainsLimit: []
}

/** Entity Base Class */
export class Entity extends EventEmitter<EntityEvents> {
    /** Field to hold raw entity */
    private readonly m_rawEntity: IEntity

    /** Field to hold reference to blueprint */
    private readonly m_BP: Blueprint

    /**
     * Construct Entity Base Class
     * @param rawEntity Raw entity object
     * @param blueprint Reference to blueprint
     */
    public constructor(rawEntity: IEntity, blueprint: Blueprint) {
        super()
        this.m_BP = blueprint
        this.m_rawEntity = rawEntity
    }

    public get rawEntity(): IEntity {
        return this.m_rawEntity
    }

    /** undefined for entities that cannot be mined into an item, e.g. the dummy rails */
    public static getItemName(name: string): string | undefined {
        return FD.entities[name]?.minable?.result
    }

    public destroy(): void {
        this.emit('destroy')
        this.removeAllListeners()
    }

    /** Return reference to blueprint */
    public get Blueprint(): Blueprint {
        return this.m_BP
    }

    /** Entity Number */
    public get entityNumber(): number {
        return this.m_rawEntity.entity_number
    }

    /** Entity Name */
    public get name(): string {
        return this.m_rawEntity.name
    }

    /** Entity Type */
    public get type(): EntityWithOwnerPrototype['type'] {
        return FD.entities[this.name].type
    }

    /** Direct access to entity meta data from core */
    public get entityData(): EntityWithOwnerPrototype {
        return FD.entities[this.name]
    }

    /** Entity size */
    public get size(): IPoint {
        return getEntitySize(this.entityData, this.direction)
    }

    /** Entity position */
    public get position(): IPoint {
        return this.m_rawEntity.position
    }

    public set position(position: IPoint) {
        if (util.areObjectsEquivalent(this.m_rawEntity.position, position)) return

        if (!this.m_BP.entityPositionGrid.canMoveTo(this, position)) return

        // Check if the new position breaks any valid entity connections
        const connectionsBreak = this.m_BP.wireConnections
            .getEntityConnections(this.entityNumber)
            .map(c =>
                c.cps[0].entityNumber === this.entityNumber
                    ? c.cps[1].entityNumber
                    : c.cps[0].entityNumber
            )
            .map(otherEntityNumer => this.m_BP.entities.get(otherEntityNumer))
            .filter(e => e !== undefined)
            .some(
                e =>
                    // Make sure that a reaching connection is not broken
                    U.pointInCircle(
                        e.position,
                        this.position,
                        Math.min(e.maxWireDistance, this.maxWireDistance)
                    ) &&
                    !U.pointInCircle(
                        e.position,
                        position,
                        Math.min(e.maxWireDistance, this.maxWireDistance)
                    )
            )
        if (G.BPC.limitWireReach && connectionsBreak) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'position', position, 'Change position')
            .onDone((newValue, oldValue) => {
                /*
                    History hands both values back as `| undefined` because undo
                    swaps them and a key can be absent before its first write.
                    `position` is a required field on the raw entity, so neither
                    can be missing here - and if one were, the grid would be
                    updated against the wrong tile and drift from the blueprint,
                    which is the case entityAt() exists to catch loudly.
                */
                if (newValue === undefined || oldValue === undefined) {
                    throw new Error('position changed to or from no position')
                }
                this.m_BP.entityPositionGrid.removeTileData(this, oldValue)
                this.m_BP.entityPositionGrid.setTileData(this, newValue)
                this.emit('position', newValue, oldValue)
            })
            .commit()
    }

    public get maxWireDistance(): number {
        return getMaxWireDistance(this.entityData)
    }

    public connectionsReach(position?: IPoint): boolean {
        return this.m_BP.wireConnections
            .getEntityConnections(this.entityNumber)
            .map(c =>
                c.cps[0].entityNumber === this.entityNumber
                    ? c.cps[1].entityNumber
                    : c.cps[0].entityNumber
            )
            .map(otherEntityNumer => this.m_BP.entities.get(otherEntityNumer))
            .filter(e => e !== undefined)
            .every(e =>
                U.pointInCircle(
                    e.position,
                    position ?? this.position,
                    Math.min(e.maxWireDistance, this.maxWireDistance)
                )
            )
    }

    public moveBy(offset: IPoint): void {
        this.position = util.sumprod(this.position, offset)
    }

    /** Entity direction */
    public get direction(): number {
        if (this.type === 'electric-pole') {
            return this.m_BP.wireConnections.getPowerPoleDirection(this.entityNumber)
        }
        return this.m_rawEntity.direction === undefined ? 0 : this.m_rawEntity.direction
    }
    public set direction(direction: number) {
        if (this.m_rawEntity.direction === direction) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'direction', direction, 'Change direction')
            .onDone(() => this.emit('direction'))
            .commit()
    }

    /** Rail layer (elevated) for rail signals on raised rails */
    public get railLayer(): string | undefined {
        return this.m_rawEntity.rail_layer
    }

    /** Direction Type (input|output) for underground belts */
    public get directionType(): DirectionType | undefined {
        return this.m_rawEntity.type
    }
    public set directionType(type: DirectionType | undefined) {
        if (this.m_rawEntity.type === type) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'type', type, 'Change direction type')
            .onDone(() => this.emit('directionType'))
            .commit()
    }

    /** Entity recipe */
    public get recipe(): string | undefined {
        return this.m_rawEntity.recipe
    }
    public set recipe(recipe: string | undefined) {
        if (this.m_rawEntity.recipe === recipe) return

        this.m_BP.history.startTransaction()

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'recipe', recipe, 'Change recipe')
            .onDone(r => this.emit('recipe', r))
            .commit()

        // Some modules on the entity may not be compatible with the new selected recipe, filter those out
        if (recipe !== undefined) {
            this.modules = this.modules.map(m => {
                if (!m) return
                const module = getModule(m)
                if (!recipeSupportsModule(recipe, module)) return
                return m
            })
        }

        this.m_BP.history.commitTransaction()
    }

    /** Recipes this entity can accept */
    public get acceptedRecipes(): string[] {
        const e = this.entityData
        if (!isCraftingMachine(e)) return []

        return Object.keys(FD.recipes)
            .map(k => FD.recipes[k])
            .filter(recipe => e.crafting_categories.includes(recipe.category || 'crafting'))
            .map(recipe => recipe.name)
    }

    /** Count of module slots */
    public get moduleSlots(): number {
        const e = this.entityData
        if (hasModuleFunctionality(e)) return e.module_slots || 0
        return 0
    }

    /** Modules this entity can accept */
    public get acceptedModules(): string[] {
        const e = this.entityData
        if (!hasModuleFunctionality(e)) return []

        return (
            FD.getModulesFor(this.name)
                // filter modules based on recipe
                .filter(module => !this.recipe || recipeSupportsModule(this.recipe, module))
                .map(module => module.name)
        )
    }

    /** Filters this entity can accept (only splitters, inserters and logistic chests) */
    public get acceptedFilters(): string[] {
        if (this.filterSlots === 0) return []

        return Object.keys(FD.items)
            .map(k => FD.items[k])
            .map(item => item.name)
    }

    /** List of all modules. Slots that are undefined don't have a populated module. */
    public get modules(): (string | undefined)[] {
        const items = this.m_rawEntity.items
        const out = Array.from<string | undefined>({ length: this.moduleSlots })
        if (!items) return out
        if (!Array.isArray(items)) {
            throw new Error('Old format for items!')
        }
        const inventory = getModuleInventoryIndex(this.entityData)
        for (const item of items) {
            if (item.items.in_inventory) {
                for (const inv of item.items.in_inventory) {
                    if (inv.inventory === inventory) {
                        out[inv.stack] = item.id.name
                    }
                }
            }
        }
        return out
    }
    /** The given list can be shorter than the one returned by the getter. */
    public set modules(_modules: (string | undefined)[]) {
        const modules = _modules || []
        if (this.modules.entries().every(([i, m]) => m === modules[i])) return

        let items = util.duplicate(this.m_rawEntity.items || [])
        if (!Array.isArray(items)) {
            throw new Error('Old format for items!')
        }
        const inventory = getModuleInventoryIndex(this.entityData)
        if (inventory === null) {
            // moduleSlots said this entity takes modules but there is no inventory to
            // put them in, so the two mappings in factorioData disagree
            throw new Error(`${this.name} has module slots but no module inventory`)
        }
        items = items.filter(item => {
            if (item.items.in_inventory) {
                item.items.in_inventory = item.items.in_inventory.filter(
                    inv => inv.inventory !== inventory
                )
                if (item.items.in_inventory.length === 0) {
                    delete item.items.in_inventory
                }
            }
            return Object.keys(item.items).length !== 0
        })

        for (const [i, module] of modules.entries()) {
            if (!module) continue

            let found_module_entry = false
            const inv_entry = { inventory, stack: i }
            for (const item of items) {
                if (item.id.name === module) {
                    found_module_entry = true

                    if (item.items.in_inventory) {
                        item.items.in_inventory.push(inv_entry)
                    } else {
                        item.items.in_inventory = [inv_entry]
                    }
                }
            }
            if (!found_module_entry) {
                items.push({
                    id: { name: module },
                    items: { in_inventory: [inv_entry] },
                })
            }
        }

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'items', items, 'Change modules')
            .onDone(() => this.emit('modules', this.modules))
            .commit()
    }

    /** Count of filter slots */
    public get filterSlots(): number {
        if (this.type === 'splitter') return 1
        const ed = this.entityData
        if (
            (isInserter(ed) || isLoader(ed) || isMiningDrill(ed)) &&
            ed.filter_count !== undefined
        ) {
            return ed.filter_count
        }
        if ((isLogisticContainer(ed) || isRoboport(ed)) && ed.max_logistic_slots !== undefined) {
            return ed.max_logistic_slots
        }
        if (this.name === 'buffer-chest' || this.name === 'requester-chest') {
            return this.logisticChestFilters.reduce(
                (max, filter) => Math.max(max, filter.index),
                30 // TODO: find a way to fix this properly
            )
        }
        return 0
    }

    /** List of all filter(s) for splitters, inserters and logistic chests */
    public get filters(): IFilter[] | undefined {
        switch (this.name) {
            case 'splitter':
            case 'fast-splitter':
            case 'express-splitter':
            case 'turbo-splitter': {
                return this.splitterFilter
            }
            case 'burner-inserter':
            case 'inserter':
            case 'long-handed-inserter':
            case 'fast-inserter':
            case 'bulk-inserter':
            case 'stack-inserter': {
                return this.inserterFilters
            }
            case 'storage-chest':
            case 'requester-chest':
            case 'buffer-chest':
                return this.logisticChestFilters
            case 'infinity-chest':
                return this.infinityChestFilters
            case 'infinity-pipe':
                return this.infinityPipeFilters
            default: {
                return undefined
            }
        }
    }
    /*
        Takes the wider slot shape while the getter above answers IFilter[].
        TypeScript only asks that the getter type be assignable to the setter
        type, and the filter below is what makes the difference safe.
    */
    public set filters(list: IFilterSlot[] | undefined) {
        // The predicate is the whole point of this filter, and saying so is what
        // lets the narrower IFilter[] reach the per-entity setters below.
        const FILTERS =
            list === undefined || list.length === 0
                ? undefined
                : list.filter((f): f is IFilter => !!f.name)
        switch (this.name) {
            case 'splitter':
            case 'fast-splitter':
            case 'express-splitter':
            case 'turbo-splitter': {
                this.splitterFilter = FILTERS
                return
            }
            case 'burner-inserter':
            case 'inserter':
            case 'long-handed-inserter':
            case 'fast-inserter':
            case 'bulk-inserter':
            case 'stack-inserter': {
                this.inserterFilters = FILTERS
                return
            }
            case 'storage-chest':
            case 'requester-chest':
            case 'buffer-chest': {
                this.logisticChestFilters = FILTERS
            }
        }
    }

    /** Splitter input priority */
    public get splitterInputPriority(): FilterPriority | undefined {
        return this.m_rawEntity.input_priority
    }
    public set splitterInputPriority(priority: FilterPriority | undefined) {
        if (this.m_rawEntity.input_priority === priority) return

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'input_priority',
                priority,
                'Change splitter input priority'
            )
            .onDone(() => this.emit('splitterInputPriority', this.splitterInputPriority))
            .commit()
    }

    /** Splitter output priority */
    public get splitterOutputPriority(): FilterPriority | undefined {
        return this.m_rawEntity.output_priority
    }
    public set splitterOutputPriority(priority: FilterPriority | undefined) {
        if (this.m_rawEntity.output_priority === priority) return

        this.m_BP.history.startTransaction()

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'output_priority',
                priority,
                'Change splitter output priority'
            )
            .onDone(() => this.emit('splitterOutputPriority', this.splitterOutputPriority))
            .commit()

        if (priority === undefined) {
            this.filters = undefined
        }

        this.m_BP.history.commitTransaction()
    }

    /** Splitter filter */
    private get splitterFilter(): IFilter[] {
        if (!this.m_rawEntity.filter) return []
        if (typeof this.m_rawEntity.filter === 'string') {
            throw new Error('pre 2.0 format!')
        }
        if (this.m_rawEntity.filter.name) {
            return [{ index: 1, name: this.m_rawEntity.filter.name }]
        }
        return []
    }
    private set splitterFilter(filters: IFilter[] | undefined) {
        const filter = filters?.[0]?.name
        if (this.m_rawEntity.filter === filter) return

        this.m_BP.history.startTransaction()

        // used to write { name: undefined } when clearing, which serialized as an
        // empty filter object rather than as no filter at all
        const f = filter === undefined ? undefined : { name: filter }

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filter', f, 'Change splitter filter')
            .onDone(() => this.emit('splitterFilter'))
            .onDone(() => this.emit('filters'))
            .commit()

        if (filter !== undefined) {
            if (this.splitterOutputPriority === undefined) {
                this.splitterOutputPriority = 'left'
            }
        }

        this.m_BP.history.commitTransaction()
    }

    public get filterMode(): FilterMode {
        return this.m_rawEntity.filter_mode === 'blacklist' ? 'blacklist' : 'whitelist'
    }

    public set filterMode(filterMode: FilterMode) {
        const mode = filterMode === 'blacklist' ? 'blacklist' : undefined

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filter_mode', mode, 'Change filter mode')
            .onDone(() => this.emit('filterMode', this.filterMode))
            .commit()
    }

    /** Inserter filter */
    private get inserterFilters(): IFilter[] | undefined {
        return this.m_rawEntity.filters
    }
    private set inserterFilters(filters: IFilter[] | undefined) {
        if (filters === undefined && this.m_rawEntity.filters === undefined) return
        if (util.areArraysEquivalent(filters, this.m_rawEntity.filters)) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filters', filters, 'Change inserter filter')
            .onDone(() => this.emit('inserterFilters'))
            .onDone(() => this.emit('filters'))
            .commit()
    }

    /** Logistic chest filters */
    private get logisticChestFilters(): IFilter[] {
        if (!this.m_rawEntity.request_filters) return []
        if (Array.isArray(this.m_rawEntity.request_filters)) {
            throw new Error('pre 2.0 format!')
        }
        const sections = this.m_rawEntity.request_filters.sections
        if (!sections || !sections[0] || !sections[0].filters) return []

        const out: IFilter[] = []
        for (const filter of sections[0].filters) {
            if (!filter.name) continue
            out.push({
                index: filter.index,
                name: filter.name,
                count: filter.count,
                // Carried rather than dropped since #88. Listed one by one on
                // purpose: a LogisticFilter also holds `type`,
                // `minimum_delivery_count` and `import_from`, which nothing
                // reads, and spreading the raw filter would put them into the
                // model as though something did.
                quality: filter.quality,
                comparator: filter.comparator,
                max_count: filter.max_count,
            })
        }
        return out
    }
    private set logisticChestFilters(filters: IFilter[] | undefined) {
        const current = this.m_rawEntity.request_filters
        if (Array.isArray(current)) {
            throw new Error('pre 2.0 format!')
        }

        /*
            The getter answers [] for a chest with no filters, so the incoming
            undefined - which is what `set filters` sends for an empty list -
            has to become one too before the comparison. areArraysEquivalent
            answers false for two undefineds rather than true.
        */
        const wanted = filters ?? []
        if (util.areArraysEquivalent(wanted, this.logisticChestFilters)) return

        /*
            This writes the whole request_filters object, so everything it does
            not own has to be carried across rather than rebuilt. Measured over
            the corpus, that is not hypothetical: 433 of these objects carry
            request_from_buffers (which has a setter of its own writing to the
            same field), 54 carry trash_not_requested (which has no reader at
            all, so nothing would notice it going), and 14 hold a second section
            - invisible to the model either way, since the getter reads section 0
            and stops. Only that section's filter list is this setter's to
            replace.
        */
        const next: LogisticSections = current === undefined ? {} : util.duplicate(current)
        const sections = next.sections ?? []
        // Every section in the corpus is numbered from 1, so that is what a
        // chest that had none gets. Note the pre-2.0 migration in Blueprint.ts
        // writes 0 instead; that path is pinned by its own tests, left alone.
        const first: LogisticSection = sections[0] ?? { index: 1 }
        const held = first.filters ?? []

        first.filters =
            wanted.length === 0
                ? undefined
                : wanted.map(f => {
                      /*
                          Two layers, and the order is the point.

                          `before` is the filter this slot already held, kept
                          when the slot still holds the same item. That is what
                          stops a caller writing a partial filter - the chest
                          editor rebuilding the whole list to change one slot,
                          say - from stripping fields it never meant to touch.

                          `f` goes on top, so anything the incoming filter
                          actually carries wins. Since #88 that includes quality
                          and comparator, which means preservation can no longer
                          make them unchangeable: a caller that knows the value
                          sets it, one that does not leaves it alone.

                          A LogisticFilter can also hold `type`,
                          `minimum_delivery_count` and `import_from`, none of
                          which IFilter models. Those survive only through
                          `before`, which is why it is a spread of the raw
                          filter rather than a rebuild.
                      */
                      const before = held.find(h => h.index === f.index && h.name === f.name)
                      return {
                          ...before,
                          ...f,
                          index: f.index,
                          name: f.name,
                          count: f.count ?? before?.count ?? 1,
                      }
                  })

        next.sections = [first, ...sections.slice(1)]

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'request_filters', next, 'Change chest filter')
            .onDone(() => this.emit('logisticChestFilters'))
            .onDone(() => this.emit('filters'))
            .commit()
    }

    private get infinityChestFilters(): IFilter[] | undefined {
        if (!this.m_rawEntity.infinity_settings) return []
        return this.m_rawEntity.infinity_settings.filters
    }

    private get infinityPipeFilters(): IFilter[] {
        const name = this.m_rawEntity.infinity_settings?.name
        if (name === undefined) return []
        return [{ name, index: 1 }]
    }

    /** Requester chest - request from buffer chest */
    public get requestFromBufferChest(): boolean {
        if (
            this.m_rawEntity.request_from_buffers ||
            Array.isArray(this.m_rawEntity.request_filters)
        ) {
            throw new Error('pre 2.0 format!')
        }
        return this.m_rawEntity.request_filters?.request_from_buffers ?? false
    }
    public set requestFromBufferChest(request: boolean) {
        if (this.requestFromBufferChest === request) return

        const current = this.m_rawEntity.request_filters
        if (Array.isArray(current)) {
            throw new Error('pre 2.0 format!')
        }
        /*
            The undefined case is handled before the copy rather than after it.
            `util.duplicate` is JSON.parse(JSON.stringify(x)), and on undefined
            that is JSON.parse("undefined"), which throws - so the `|| {}` this
            used to fall back on never ran. A chest with no request_filters at
            all is exactly what pasteSettings hands it: the filter write above
            creates nothing when the source has no filters, and this line is the
            next one (issue #64).
        */
        const obj: LogisticSections = current === undefined ? {} : util.duplicate(current)
        obj.request_from_buffers = request

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'request_filters',
                obj,
                'Change request from buffer chest'
            )
            .onDone(() => this.emit('requestFromBufferChest'))
            .commit()
    }

    public get inserterStackSize(): null | number {
        if (this.m_rawEntity.override_stack_size) return this.m_rawEntity.override_stack_size
        if (isInserter(this.entityData)) {
            if (this.entityData.bulk) {
                return 12
            } else {
                return 3
            }
        }
        return null
    }

    public get constantCombinatorFilters(): string[] {
        return (this.m_rawEntity.control_behavior?.sections?.sections || [])
            .flatMap(f => f.filters ?? [])
            .map(f => f?.name)
            .filter(name => name !== undefined)
    }

    public get combinatorConditions():
        | {
              first_signal?: ISignal
              second_signal?: ISignal
              output_signal?: ISignal
          }
        | undefined {
        if (this.type === 'decider-combinator') {
            const decider_conditions = this.m_rawEntity.control_behavior?.decider_conditions
            return {
                first_signal: decider_conditions?.conditions?.[0].first_signal,
                second_signal: decider_conditions?.conditions?.[0].second_signal,
                output_signal: decider_conditions?.outputs?.[0].signal,
            }
        }
        if (this.type === 'arithmetic-combinator') {
            const arithmetic_conditions = this.m_rawEntity.control_behavior?.arithmetic_conditions
            return {
                first_signal: arithmetic_conditions?.first_signal,
                second_signal: arithmetic_conditions?.second_signal,
                output_signal: arithmetic_conditions?.output_signal,
            }
        }
        if (
            this.type === 'selector-combinator' &&
            this.m_rawEntity.control_behavior?.index_signal
        ) {
            return {
                first_signal: this.m_rawEntity.control_behavior?.index_signal,
            }
        }
    }

    public get generateConnector(): boolean {
        return this.hasConnections || this.connectToLogisticNetwork
    }

    private get connectToLogisticNetwork(): boolean {
        return !!this.m_rawEntity.control_behavior?.connect_to_logistic_network
    }

    private get hasConnections(): boolean {
        return this.m_BP.wireConnections.getEntityConnections(this.entityNumber).length > 0
    }

    public get trainStopColor(): ColorWithAlpha | undefined {
        return this.m_rawEntity.color
    }

    /** Entity Train Stop Station name */
    public get station(): string | undefined {
        return this.m_rawEntity.station
    }

    public set station(station: string | undefined) {
        if (this.m_rawEntity.station === station) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'station', station, 'Change station name')
            .onDone(() => this.emit('station'))
            .commit()
    }

    /** Entity Train Stop Trains Limit */
    public get manualTrainsLimit(): number | undefined {
        return this.m_rawEntity.manual_trains_limit
    }

    public set manualTrainsLimit(limit: number | undefined) {
        if (this.m_rawEntity.manual_trains_limit === limit) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'manual_trains_limit', limit, 'Change trains limit')
            .onDone(() => this.emit('manualTrainsLimit'))
            .commit()
    }

    public get selectorCombinatorSelectMax(): boolean {
        if (this.type !== 'selector-combinator') return false
        if (this.m_rawEntity.control_behavior?.operation === 'select') {
            const select_max = this.m_rawEntity.control_behavior?.select_max
            return select_max === undefined ? true : select_max
        }
        return false
    }

    public get operator():
        | undefined
        | ComparatorString
        | ArithmeticOperation
        | SelectorCombinatorOperation {
        if (this.type === 'decider-combinator') {
            return (
                this.m_rawEntity.control_behavior?.decider_conditions?.conditions?.[0].comparator ||
                '<'
            )
        }
        if (this.type === 'arithmetic-combinator') {
            return this.m_rawEntity.control_behavior?.arithmetic_conditions?.operation || '*'
        }
        if (this.type === 'selector-combinator') {
            return this.m_rawEntity.control_behavior?.operation || 'select'
        }
        return undefined
    }

    private get possibleRotations(): number[] {
        return getPossibleRotations(
            this.entityData,
            this.assemblerHasFluidInputs || this.assemblerHasFluidOutputs
        )
    }

    private get canBeRotated(): boolean {
        return (
            this.possibleRotations.length !== 0 &&
            !this.m_BP.entityPositionGrid.sharesCell({
                x: this.position.x,
                y: this.position.y,
                w: this.size.x,
                h: this.size.y,
            })
        )
    }

    public getRotatedCopy(ccw = false): Entity {
        const position = ccw
            ? { x: this.m_rawEntity.position.y, y: -this.m_rawEntity.position.x }
            : { x: -this.m_rawEntity.position.y, y: this.m_rawEntity.position.x }
        const direction = this.constrainDirection((this.direction + (ccw ? 12 : 4)) % 16)
        const updatedRawEntity: IEntity = { ...this.m_rawEntity, position, direction }
        if (direction === 0) delete updatedRawEntity.direction

        return new Entity(updatedRawEntity, this.m_BP)
    }

    private constrainDirection(direction: number): number {
        const pr = this.possibleRotations
        const canRotate = pr.length !== 0

        if (canRotate) {
            if (!pr.includes(direction)) {
                if (direction === 8 && pr.includes(0)) {
                    return 0
                } else if (direction === 12 && pr.includes(4)) {
                    return 4
                } else {
                    return this.direction
                }
            }
        } else {
            return 0
        }
        return direction
    }

    private changePriority(priority?: FilterPriority): FilterPriority | undefined {
        if (priority === 'left') return 'right'
        else if (priority === 'right') return 'left'
        return priority
    }

    public getFlippedCopy(vertical: boolean): Entity {
        const non_flip_entities: EntityWithOwnerPrototype['type'][] = [
            'train-stop',
            'rail-chain-signal',
            'rail-signal',
        ]

        if (non_flip_entities.includes(this.type))
            throw new IllegalFlipError(`${this.name} cannot be flipped`)

        const axisDir = vertical ? 12 : 8
        const direction = this.constrainDirection((axisDir * 2 - this.direction) % 16)

        let input_priority = this.m_rawEntity.input_priority
        let output_priority = this.m_rawEntity.output_priority

        if (
            (vertical && (direction === 4 || direction === 8)) ||
            (!vertical && (direction === 0 || direction === 12))
        ) {
            input_priority = this.changePriority(input_priority)
            output_priority = this.changePriority(output_priority)
        }

        const position = vertical
            ? { x: this.m_rawEntity.position.x, y: -this.m_rawEntity.position.y }
            : { x: -this.m_rawEntity.position.x, y: this.m_rawEntity.position.y }
        const updatedRawEntity: IEntity = {
            ...this.m_rawEntity,
            direction,
            position,
            input_priority,
            output_priority,
        }
        if (direction === 0) delete updatedRawEntity.direction

        return new Entity(updatedRawEntity, this.m_BP)
    }

    private rotateDir(ccw: boolean): number {
        if (!this.canBeRotated) return this.direction
        const pr = this.possibleRotations
        return pr[
            (pr.indexOf(this.direction) +
                (this.size.x !== this.size.y || this.type === 'underground-belt' ? 2 : 1) *
                    (ccw ? 3 : 1)) %
                pr.length
        ]
    }

    public rotate(ccw = false, rotateOpposingUB = false): void {
        const newDir = this.rotateDir(ccw)

        if (newDir === this.direction) return

        this.m_BP.history.startTransaction('Rotate entity')

        if (this.type === 'underground-belt' || this.type === 'loader') {
            if (rotateOpposingUB) {
                const opposingEntityNumber = this.m_BP.entityPositionGrid.getOpposingEntity(
                    this.name,
                    this.direction,
                    this.position,
                    this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
                    isUndergroundBelt(this.entityData) ? this.entityData.max_distance : undefined
                )
                const otherEntity =
                    opposingEntityNumber === undefined
                        ? undefined
                        : this.m_BP.entities.get(opposingEntityNumber)
                if (otherEntity) {
                    otherEntity.rotate()
                }
            }

            this.directionType = this.directionType === 'input' ? 'output' : 'input'
        }

        this.direction = newDir

        this.m_BP.history.commitTransaction()
    }

    public canPasteSettings(sourceEntity: Entity): boolean {
        return sourceEntity !== this && sourceEntity.type === this.type
    }

    /** Paste relevant data from source entity */
    public pasteSettings(sourceEntity: Entity): void {
        if (!this.canPasteSettings(sourceEntity)) return

        this.m_BP.history.startTransaction('Paste settings to entity')

        // PASTE RECIPE
        let tRecipe = this.recipe
        const aR = this.acceptedRecipes
        if (aR.length > 0 && sourceEntity.acceptedRecipes) {
            tRecipe =
                sourceEntity.recipe !== undefined && aR.includes(sourceEntity.recipe)
                    ? sourceEntity.recipe
                    : undefined
            this.recipe = tRecipe
        }

        // PASTE DIRECTION (only for type assembling_machine)
        if (
            this.type === 'assembling-machine' &&
            this.name !== 'assembling-machine' &&
            tRecipe &&
            FD.recipes[tRecipe].category === 'crafting-with-fluid'
        ) {
            this.direction = sourceEntity.direction
        }

        // PASTE MODULES
        const aM = this.acceptedModules
        if (aM.length > 0 && sourceEntity.acceptedModules) {
            if (sourceEntity.modules && sourceEntity.modules.length > 0) {
                /*
                    map, not filter. `modules` is positional - one entry per
                    slot, undefined for an empty one - so dropping the entries
                    rather than blanking them slid every module behind a gap
                    forward, and a source holding two modules in its back slots
                    pasted them into the front ones (issue #100). A module the
                    target will not accept still goes, it just leaves its slot
                    empty instead of closing it.
                */
                this.modules = sourceEntity.modules
                    .map(m => (m !== undefined && aM.includes(m) ? m : undefined))
                    .slice(0, this.moduleSlots)
            } else {
                this.modules = []
            }
        }

        // PASTE SPLITTER SETTINGS (Has to be before filters as otherwise business logic will overwrite)
        if (this.type === 'splitter' && sourceEntity.type === 'splitter') {
            this.splitterInputPriority = sourceEntity.splitterInputPriority
            this.splitterOutputPriority = sourceEntity.splitterOutputPriority
        }

        // PASTE FILTERS
        const aF = this.acceptedFilters
        if (aF.length > 0 && sourceEntity.acceptedFilters) {
            if (sourceEntity.filters && sourceEntity.filters.length > 0) {
                this.filters = sourceEntity.filters
                    .filter(f => aF.includes(f.name))
                    .slice(0, this.filterSlots)
            } else {
                this.filters = []
            }
        }

        // PASTE REQUESTER CHEST SETTINGS
        if (this.name === 'requester-chest' && sourceEntity.name === 'requester-chest') {
            this.requestFromBufferChest = sourceEntity.requestFromBufferChest
        }

        this.m_BP.history.commitTransaction()

        /*
            TODO:

            assembling machines -> filter inserters:
                filters

            assembling machines -> requester chest:
                filters
                request amount formula: Math.min(ingredientAmount, Math.ceil((ingredientAmount * newCraftingSpeed) / recipe.energy_required))

            Locomotive:
                Schedule
                Color

            TrainStop:
                Color
                Name

            TrainStop<->Locomotive:
                Color

            ProgrammableSpeaker:
                Parameters
                AlertParameters

            RocketSilo:
                LaunchWhenRocketHasItems

            CargoWagon:
            ContainerEntity:
                Bar
                Filters

            CREATIVE ENTITIES:
                ElectricEnergyInterface:
                    ElectricBufferSize
                    PowerProduction
                    PowerUsage

                HeatInterface:
                    temperature
                    mode

                InfinityContainer:
                    Filters
                    RemoveUnfilteredItems

                InfinityPipe:
                    Filter

                Loader:
                    Filters
        */
    }

    public get displayPanelIcon(): ISignal | undefined {
        if (this.type !== 'display-panel') return undefined
        return this.m_rawEntity.icon || this.m_rawEntity.control_behavior?.parameters?.[0]?.icon
    }

    public get mayCraftWithFluid(): boolean {
        const e = this.entityData
        if (!isCraftingMachine(e)) return false
        return e.crafting_categories && e.crafting_categories.includes('crafting-with-fluid')
    }

    public get assemblerHasFluidInputs(): boolean {
        if (!this.recipe) return false
        const recipe = FD.recipes[this.recipe]
        if (!recipe) return false
        return !!recipeIngredients(recipe).find(ingredient => ingredient.type === 'fluid')
    }

    public get assemblerHasFluidOutputs(): boolean {
        if (!this.recipe) return false
        const recipe = FD.recipes[this.recipe]
        if (!recipe) return false
        return !!recipeResults(recipe).find(result => result.type === 'fluid')
    }

    public getWireConnectionPoint(
        color: string,
        side: number,
        direction = this.direction
    ): undefined | readonly [number, number] {
        const e = this.entityData

        // color is one of the WirePosition keys; the runtime value is a [x, y] tuple.
        const wireKey = color as keyof WirePosition
        const getCombinatorSide = () => (side === 1 ? 'input' : 'output')
        const getPowerSwitchSide = () =>
            color === 'copper' ? (side === 1 ? 'left' : 'right') : 'circuit'
        const wcp = getWireConnectionPoint(e, direction, getCombinatorSide, getPowerSwitchSide)
        if (wcp) {
            const pos = wcp.wire[wireKey]
            return pos && util.vectorToTuple(pos)
        }

        const isLoaderInputting = () => this.directionType === 'input'
        const getBeltConnectionIndex = () =>
            getBeltWireConnectionIndex(this.m_BP.entityPositionGrid, this.position, direction)
        const cc = getCircuitConnector(e, direction, isLoaderInputting, getBeltConnectionIndex)
        if (cc?.points) {
            const pos = cc.points.wire[wireKey]
            return pos && util.vectorToTuple(pos)
        }
    }

    private getWire_connection_box(
        color: string,
        side: number,
        direction = this.direction
    ): [[number, number], [number, number]] | undefined {
        const point = this.getWireConnectionPoint(color, side, direction)
        if (!point) return undefined

        const e = this.entityData
        const e_size = getEntitySize(e)
        const size_box: [[number, number], [number, number]] = [
            [-e_size.x / 2, -e_size.y / 2],
            [+e_size.x / 2, +e_size.y / 2],
        ]

        switch (e.type) {
            case 'arithmetic-combinator':
            case 'decider-combinator':
            case 'selector-combinator': {
                const e_resolved = e as CombinatorPrototype
                if (side === 1) {
                    return mapBoundingBox(e_resolved.input_connection_bounding_box)
                } else {
                    return mapBoundingBox(e_resolved.output_connection_bounding_box)
                }
            }
            case 'power-switch': {
                if (color === 'copper') {
                    if (side === 1) {
                        const box = util.duplicate(size_box)
                        box[1][0] = (box[0][0] + box[1][0]) / 2
                        return box
                    } else {
                        const box = util.duplicate(size_box)
                        box[0][0] = (box[0][0] + box[1][0]) / 2
                        return box
                    }
                }
            }
        }

        return size_box
    }

    public getWireConnectionBoundingBox(
        color: string,
        side: number,
        direction = this.direction
    ): IPoint[] | undefined {
        const box = this.getWire_connection_box(color, side, direction)
        if (box === undefined) return undefined
        let bbox: IPoint[] = box.map(util.Point)
        bbox = bbox.map(p => util.rotatePointBasedOnDir(p, direction))
        bbox = [
            { x: Math.min(...bbox.map(p => p.x)), y: Math.min(...bbox.map(p => p.y)) },
            { x: Math.max(...bbox.map(p => p.x)), y: Math.max(...bbox.map(p => p.y)) },
        ]
        return bbox
    }

    public serialize(_entNrWhitelist?: Set<number>): IEntity {
        return util.duplicate({
            ...this.m_rawEntity,
            // ...this.m_BP.wireConnections.serializeConnectionData(this.entityNumber, entNrWhitelist),
        })
    }
}
