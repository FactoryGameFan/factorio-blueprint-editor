import { Text, Container, FederatedPointerEvent } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import FD from '../../../core/factorioData'
import G from '../../../common/globals'
import F from '../../controls/functions'
import { Slot } from '../../controls/Slot'
import { Entity, EntityEvents, IFilterSlot } from '../../../core/Entity'

/** Module Slots for Entity */
export class Filters extends Container<Slot<number>> {
    /* Blueprint Splitters
    ########################
    entity_number: 1
    filter: "assembling-machine-2"
    input_priority: "right"
    name: "express-splitter"
    output_priority: "left"
    position: { x: -0.5, y: 0 }
    // Filter Slots: 1
    // Filter Count: N/A
    */

    /* Blueprint Filter Inserters
    ########################
    entity_number: 1
    filters: Array(2)
        0: {index: 1, name: "long-handed-inserter"}
        1: {index: 2, name: "inserter"}
    name: "filter-inserter"
    override_stack_size: 3
    position: {x: -1, y: 0}
    // Filter Slots: 5
    // Filter Count: N/A >> Does not need to be written
    ########################
    entity_number: 2
    filters: Array(1)
        0: {index: 1, name: "express-transport-belt"}
    length: 1
    name: "stack-filter-inserter"
    override_stack_size: 10
    position: {x: 0, y: 0}
    // Filter Slots: 1
    // Filter Count: N/A >> Does not need to be written
    */

    /* Blueprint Logist Chests
    ########################
    entity_number: 2
    name: "storage-chest"
    position: {x: 0, y: 0}
    request_filters: Array(1)
        0: {index: 1, name: "assembling-machine-2", count: 0}
    // Filter Slots: 1
    // Filter Count: N/A >> Needs to be written as 0
    ########################
    entity_number: 4
    name: "requester-chest"
    position: {x: 0, y: 2}
    request_filters: Array(1)
        0: {index: 1, name: "storage-chest", count: 50}
    request_from_buffers: true
    // Filter Slots: 12
    // Filter Count: Stack Size
    ########################
    entity_number: 5
    name: "buffer-chest"
    position: {x: 0, y: 1}
    request_filters: Array(2)
        0: {index: 1, name: "assembling-machine-2", count: 50}
        1: {index: 2, name: "assembling-machine-3", count: 10}
    // Filter Slots: 12
    // Filter Count: Stack Size
    */

    /** Blueprint Editor Entity reference */
    private readonly m_Entity: Entity

    /** Field to indicate whether counts shall be shown (Used for 2 chests) */
    private readonly m_Amount: boolean

    /** Field to hold data for module visualization */
    /*
        One entry per slot, so an empty slot is present with no name - which is
        what makes this IFilterSlot[] rather than IFilter[]. Entity's setter is
        built for exactly this and strips the nameless entries on the way in.
    */
    private m_Filters: IFilterSlot[] = []

    /**
     * Slots to a row. Six is what every filter dialog used to draw, and is still
     * what the inserter one wants - its five slots fit a single row. The logistic
     * chests pass the game's own `logistic_slots_per_row` instead, since their
     * grid is large enough for the width to matter (issue #93).
     */
    private readonly m_Columns: number

    /**
     * Slots drawn, fixed when they are created.
     *
     * `Entity.filterSlots` is not constant for a logistic chest - it is a floor
     * raised to whatever the chest is holding, so clearing a filter above the
     * floor lowers it. The slots themselves are only ever built once, in the
     * constructor, so re-reading it would leave `m_Filters` shorter than the
     * children `m_UpdateSlots` walks and throw on the first one past the end.
     * A chest arriving with a request at index 45 and having it cleared did
     * exactly that (issue #93).
     */
    private readonly m_SlotCount: number

    public constructor(entity: Entity, amount = false, columns = 6) {
        super()

        // Store entity data reference for later usage
        this.m_Entity = entity
        this.m_Amount = amount
        this.m_Columns = columns
        this.m_SlotCount = entity.filterSlots

        // Get filters from entity
        this.m_UpdateFilters()

        // Create slots for entity
        for (let slotIndex = 0; slotIndex < this.m_Filters.length; slotIndex++) {
            const slot = new Slot<number>(slotIndex)
            slot.position.set(
                Math.floor((slotIndex % this.m_Columns) * 38),
                Math.floor(slotIndex / this.m_Columns) * 38
            )
            slot.on('pointerdown', this.onSlotPointerDown, this)
            this.addChild(slot)
        }
        this.m_UpdateSlots()

        // Listen to filter changes on entity
        this.onEntityChange('filters', () => {
            this.m_UpdateFilters()
            this.m_UpdateSlots()
        })
    }

    private onEntityChange<T extends EventEmitter.EventNames<EntityEvents>>(
        event: T,
        fn: EventEmitter.EventListener<EntityEvents, T>
    ): void {
        this.m_Entity.on(event, fn)
        this.once('destroyed', () => this.m_Entity.off(event, fn))
    }

    /**
     * Update filter count
     * @param index - Index of filter
     * @param count - New count
     */
    public updateFilter(index: number, count: number): void {
        if (this.m_Filters[index].count === count) return
        this.m_Filters[index].count = count
        this.m_Entity.filters = this.m_Filters
        this.m_UpdateSlots()
    }

    /**
     * Return filter count of specific filter
     * @param index Index of filter
     */
    public getFilterCount(index: number): number | undefined {
        // Undefined for a filter with no stack count, which a logistic section
        // filter is free to be - ChestEditor reads that as "hide the count
        // controls" and has always had the check for it.
        return this.m_Filters[index].count
    }

    /** Update local filters array */
    private m_UpdateFilters(): void {
        /*
            Never below the slots on screen, and never below what the entity is
            holding either - a write while the dialog is open can push a filter
            past the grid, and an entry with nowhere to draw is better than one
            the array does not have at all.
        */
        /*
            The `if (slots > 0)` this replaces left m_Filters unassigned entirely
            for an entity with no filter slots, and the constructor reads
            `this.m_Filters.length` on the next line - so that case threw on
            undefined rather than drawing an empty grid. Building the array
            unconditionally answers it: `Array.from({ length: 0 })` is `[]`, both
            loops below then do nothing, and the constructor's own loop does not
            run either. Identical for every slots > 0, which is every entity that
            reaches this dialog today.
        */
        const slots = Math.max(this.m_SlotCount, this.m_Entity.filterSlots)
        this.m_Filters = Array.from<IFilterSlot>({ length: slots })
        const filters = this.m_Entity.filters
        if (filters !== undefined) {
            for (const item of filters) {
                this.m_Filters[item.index - 1] = {
                    index: item.index,
                    name: item.name,
                    count: item.count,
                }
            }
        }
        for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
            this.m_Filters[slotIndex] =
                this.m_Filters[slotIndex] === undefined
                    ? { index: slotIndex + 1, name: undefined }
                    : this.m_Filters[slotIndex]
        }
    }

    /** Update slot icons */
    private m_UpdateSlots(): void {
        for (const slot of this.children) {
            const slotIndex = slot.data
            const slotFilter = this.m_Filters[slotIndex]

            if (slotFilter.name === undefined) {
                if (slot.content !== undefined) {
                    slot.content = undefined
                }
            } else {
                /*
                    Read into a local: TypeScript drops a narrowing of
                    `slotFilter.name` inside the callbacks below, since it
                    cannot prove the property does not change in between.
                */
                const name = slotFilter.name
                if (slot.content === undefined || slot.iconName !== name || this.m_Amount) {
                    if (this.m_Amount) {
                        if (slot.content !== undefined) {
                            const text = slot.children[1] as Text
                            /*
                                `?? 1` matches what was actually drawn, not a
                                guess: the icon below is built by
                                CreateIconWithAmount, whose `amount` defaults to
                                1, so a filter with no count rendered as "1".
                                Comparing against "undefined" would have made
                                every such slot look stale and rebuild forever.
                            */
                            if (text.text !== (slotFilter.count ?? 1).toString()) {
                                slot.content = undefined
                            }
                        }
                        /*
                            `CreateIconWithAmount` fills a container rather than
                            answering one, so the container is built here and
                            handed back from the callback. A throw part way
                            through leaves a half-filled container behind, which
                            is why `SafeIcon`'s empty one is used instead of the
                            local.
                        */
                        slot.content = F.SafeIcon(name, () => {
                            const container = new Container()
                            F.CreateIconWithAmount(container, -16, -16, name, slotFilter.count)
                            return container
                        })
                    } else {
                        slot.content = F.SafeIcon(name, () => F.CreateIcon(name))
                    }
                    slot.iconName = name
                }
            }
        }

        this.emit('changed')
    }

    /** Slot pointer down event handler */
    private readonly onSlotPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        const slot = e.target as Slot<number>
        const index = slot.data
        if (e.button === 0) {
            if (!this.m_Amount || this.m_Filters[index].name === undefined) {
                this.emit('selection-started')
                const inv = G.UI.createInventory(
                    'Select Filter',
                    this.m_Entity.acceptedFilters,
                    name => {
                        this.m_Filters[index].name = name
                        if (this.m_Amount) {
                            this.m_Filters[index].count = FD.items[name].stack_size
                        }
                        this.m_Entity.filters = this.m_Filters

                        if (this.m_Amount) {
                            this.emit('selected', index, this.m_Filters[index].count)
                        }
                    }
                )
                inv.on('close', () => this.emit('selection-ended'))
            } else {
                if (this.m_Amount) {
                    this.emit('selected', index, this.m_Filters[index].count)
                }
            }
        } else if (e.button === 2) {
            this.m_Filters[index].name = undefined
            this.m_Entity.filters = this.m_Filters
            if (this.m_Amount) {
                this.emit('selected', -1, 0)
            }
        }
    }
}
