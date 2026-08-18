import { FederatedPointerEvent } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import G from '../common/globals'
import { acceptedSignalIcons } from '../core/factorioData'
import { Blueprint, BlueprintEvents } from '../core/Blueprint'
import { Dialog } from './controls/Dialog'
import { Slot } from './controls/Slot'
import { TextInput } from './controls/TextInput'
import F from './controls/functions'
import { BlueprintAlignment } from './BlueprintAlignment'

const ICON_INDICES = [1, 2, 3, 4] as const

/** One of a blueprint's four icon slots. Left click opens the picker, right click clears it. */
class BlueprintIconSlot extends Slot<undefined> {
    private readonly m_Blueprint: Blueprint
    private readonly m_Index: 1 | 2 | 3 | 4

    public constructor(blueprint: Blueprint, index: 1 | 2 | 3 | 4) {
        super(undefined)

        this.m_Blueprint = blueprint
        this.m_Index = index
        this.updateContent()
        this.on('pointerdown', this.onSlotPointerDown)

        this.m_Blueprint.on('icon', this.onIconChange)
        this.once('destroyed', () => this.m_Blueprint.off('icon', this.onIconChange))
    }

    private readonly onIconChange = (index: 1 | 2 | 3 | 4): void => {
        if (index === this.m_Index) this.updateContent()
    }

    private updateContent(): void {
        const name = this.m_Blueprint.getIcon(this.m_Index)
        if (name === undefined) {
            if (this.content !== undefined) this.content = undefined
        } else {
            try {
                this.content = F.CreateIcon(name)
            } catch (error) {
                /*
                    `CreateIcon` only resolves item/fluid/recipe/signal/
                    inventory-group names - nothing in `FD` covers the
                    `space-location` icons (planet names: vulcanus, fulgora,
                    gleba...) Space Age blueprints and books carry, since the
                    exporter emits no such collection at all. Uncaught, this
                    took the whole dialog constructor down with it (five
                    corpus files hit it). A blank slot costs one icon; the
                    warning names which one.
                */
                G.logger({
                    text: `Could not build the "${name}" blueprint icon: ${String(error)}`,
                    type: 'warning',
                })
                if (this.content !== undefined) this.content = undefined
            }
        }
        this.emit('changed')
    }

    private readonly onSlotPointerDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button === 0) {
            G.UI.createInventory(
                'Select Icon',
                acceptedSignalIcons(),
                name => {
                    this.m_Blueprint.setIcon(this.m_Index, name)
                },
                false
            )
        } else if (e.button === 2) {
            this.m_Blueprint.setIcon(this.m_Index, undefined)
        }
    }
}

// Exported for tests/blueprint-grid-position.spec.ts, which computes screen
// positions for BlueprintAlignment's own controls and has no other way to
// find where that section starts within the dialog.
export const ALIGNMENT_X = 12
export const ALIGNMENT_Y = 278

/**
 * Editor for the blueprint's own name, icons, description, and grid
 * alignment - as opposed to every other Dialog in `editors/`, which edits
 * one placed entity. Opened via the corner button (see
 * UIContainer.toggleBlueprintInfoEditor), not through `editors/factory.ts`,
 * so it extends Dialog directly rather than Editor, which requires an
 * Entity for its preview thumbnail.
 *
 * `Editor.loadBlueprint` calls `Dialog.closeAll()` before swapping `G.bp`, so
 * this never needs to guard against outliving the blueprint it was opened for.
 */
export class BlueprintInfoEditor extends Dialog {
    private readonly m_Blueprint: Blueprint

    public constructor(blueprint: Blueprint) {
        super(360, ALIGNMENT_Y + BlueprintAlignment.HEIGHT + 12, 'Blueprint Info')

        this.m_Blueprint = blueprint

        this.addLabel(12, 46, 'Name:')
        const nameInput = new TextInput(G.app.renderer, 336, blueprint.name, 200)
        nameInput.position.set(12, 65)
        this.addChild(nameInput)

        nameInput.on('changed', () => {
            this.m_Blueprint.name = nameInput.text
        })
        this.onBlueprintChange('name', () => {
            nameInput.text = this.m_Blueprint.name
        })

        this.addLabel(12, 100, 'Icons:')
        for (const [i, index] of ICON_INDICES.entries()) {
            const slot = new BlueprintIconSlot(blueprint, index)
            slot.position.set(12 + i * 44, 119)
            this.addChild(slot)
        }

        this.addLabel(12, 169, 'Description:')
        const descriptionInput = new TextInput(
            G.app.renderer,
            336,
            blueprint.description || '',
            500,
            false,
            true,
            70
        )
        descriptionInput.position.set(12, 188)
        this.addChild(descriptionInput)

        descriptionInput.on('changed', () => {
            this.m_Blueprint.description = descriptionInput.text || undefined
        })
        this.onBlueprintChange('description', () => {
            descriptionInput.text = this.m_Blueprint.description || ''
        })

        const alignment = new BlueprintAlignment(blueprint)
        alignment.position.set(ALIGNMENT_X, ALIGNMENT_Y)
        this.addChild(alignment)
    }

    private onBlueprintChange<T extends EventEmitter.EventNames<BlueprintEvents>>(
        event: T,
        fn: EventEmitter.EventListener<BlueprintEvents, T>
    ): void {
        this.m_Blueprint.on(event, fn)
        this.once('destroyed', () => this.m_Blueprint.off(event, fn))
    }
}
