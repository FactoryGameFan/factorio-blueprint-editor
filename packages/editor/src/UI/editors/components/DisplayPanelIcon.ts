import { FederatedPointerEvent } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import G from '../../../common/globals'
import { Entity, EntityEvents } from '../../../core/Entity'
import { ISignal } from '../../../types'
import { Slot } from '../../controls/Slot'
import F from '../../controls/functions'

/** Icon Slot for a Display Panel Entity */
export class DisplayPanelIcon extends Slot<undefined> {
    /** Blueprint Editor Entity reference */
    private readonly m_Entity: Entity

    public constructor(entity: Entity) {
        super(undefined)

        this.m_Entity = entity
        this.updateContent(this.m_Entity.displayPanelIcon)
        this.on('pointerdown', this.onSlotPointerDown)

        this.onEntityChange('displayPanelIcon', icon => this.updateContent(icon))
    }

    private onEntityChange<T extends EventEmitter.EventNames<EntityEvents>>(
        event: T,
        fn: EventEmitter.EventListener<EntityEvents, T>
    ): void {
        this.m_Entity.on(event, fn)
        this.once('destroyed', () => this.m_Entity.off(event, fn))
    }

    /** Update Content Icon */
    private updateContent(icon: ISignal | undefined): void {
        if (icon === undefined || icon.name === undefined) {
            if (this.content !== undefined) {
                this.content = undefined
            }
        } else {
            this.content = F.CreateIcon(icon.name)
        }
        this.emit('changed')
    }

    /** Event handler for click on slot */
    private readonly onSlotPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.createInventory(
                'Select Icon',
                this.m_Entity.acceptedDisplayPanelIcons,
                name => {
                    this.m_Entity.displayPanelIcon = {
                        name,
                        type: this.m_Entity.displayPanelIconType(name),
                    }
                },
                false
            )
        } else if (e.button === 2) {
            this.m_Entity.displayPanelIcon = undefined
        }
    }
}
