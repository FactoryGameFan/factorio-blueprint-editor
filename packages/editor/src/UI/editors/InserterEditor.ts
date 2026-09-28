import { Entity } from '../../core/Entity'
import { Switch } from '../controls/Switch'
import { Enable } from '../controls/Enable'
import { Checkbox } from '../controls/Checkbox'
import { Slider } from '../controls/Slider'
import { TextInput } from '../controls/TextInput'
import { Editor } from './Editor'
import G from '../../common/globals'

/** Inserter Editor */
export class InserterEditor extends Editor {
    public constructor(entity: Entity) {
        // Taller than the preview needs when the stack size rows sit below the
        // filters, so the box under them keeps the dialog's 12px bottom margin.
        super(446, entity.filterSlots > 0 ? 177 : 171, entity)

        if (this.m_Entity.filterSlots > 0) {
            const filterMode = this.m_Entity.filterMode

            const filterModeWhitelist = new Enable(filterMode === 'whitelist', 'Whitelist')
            filterModeWhitelist.position.set(140, 45)
            this.addChild(filterModeWhitelist)

            const filterModeSwitch = new Switch(['whitelist', 'blacklist'], filterMode)
            filterModeSwitch.position.set(210, 45)
            this.addChild(filterModeSwitch)

            const filterModeBlacklist = new Enable(filterMode === 'blacklist', 'Blacklist')
            filterModeBlacklist.position.set(260, 45)
            this.addChild(filterModeBlacklist)

            // Add Filters
            this.addLabel(140, 56 + 25, `Filter${this.m_Entity.filterSlots === 1 ? '' : 's'}:`)
            this.addFilters(208, 70)

            // Events
            filterModeWhitelist.on('changed', () => {
                this.m_Entity.filterMode = filterModeWhitelist.active ? 'whitelist' : 'blacklist'
            })

            filterModeSwitch.on('changed', () => {
                // this switch is never in its tri-state; 'whitelist' is what the
                // entity itself falls back to
                this.m_Entity.filterMode = filterModeSwitch.value ?? 'whitelist'
            })

            filterModeBlacklist.on('changed', () => {
                this.m_Entity.filterMode = filterModeBlacklist.active ? 'blacklist' : 'whitelist'
            })

            this.onEntityChange('filterMode', filterMode => {
                filterModeSwitch.value = filterMode
                filterModeWhitelist.active = filterMode === 'whitelist'
                filterModeBlacklist.active = filterMode === 'blacklist'
            })
        }

        this.addStackSize(this.m_Entity.filterSlots > 0 ? 116 : 45)
    }

    /*
        The hand size override (#339): a checkbox for whether the inserter has
        one, and a slider and box for its value. Unticked, the field is deleted
        rather than written, so the export is the same as for an inserter that
        never had one; the two controls then show what the info panel assumes.

        The top of the range is the largest hand research can give this
        inserter, raised to whatever the blueprint already carries - the corpus
        has a fast inserter set to 12, three times what research can give it,
        and opening the dialog must not be what clamps it.
    */
    private addStackSize(y: number): void {
        /*
            Raised again whenever the entity changes, and never lowered while
            the dialog is open. An undo can bring back a value above the range
            the dialog opened with - lower the fast inserter's 12 to 3, reopen,
            undo - and the box, the slider and what the box accepts have to
            cover what the entity holds, the same as when the dialog opened on
            it. Lowering it again would shrink the slider under a drag.
        */
        const rangeFor = (): number =>
            Math.max(
                this.m_Entity.inserterStackSizeLimit ?? 1,
                this.m_Entity.inserterStackSizeOverride ?? 0
            )
        let max = rangeFor()
        // No clamp needed: an override is never above `max`, and the fallback
        // `inserterStackSize` shows without one (3, or 12 for bulk) never
        // exceeds `inserterStackSizeLimit`.
        const shown = (): number => this.m_Entity.inserterStackSize ?? max

        const checkbox = new Checkbox(
            this.m_Entity.inserterStackSizeOverride !== undefined,
            'Override stack size'
        )
        checkbox.position.set(140, y)
        this.addChild(checkbox)

        const slider = new Slider(shown(), max)
        slider.position.set(140, y + 30)
        this.addChild(slider)

        const textbox = new TextInput(G.app.renderer, 40, `${shown()}`, 3, true)
        textbox.position.set(320, y + 27)
        this.addChild(textbox)

        // Set while this dialog writes its own controls, so the slider's
        // 'changed' from that write is not taken for the user moving it.
        let syncing = false

        checkbox.on('changed', () => {
            this.m_Entity.inserterStackSizeOverride = checkbox.checked ? slider.value : undefined
        })
        slider.on('changed', () => {
            if (syncing) return
            textbox.text = `${slider.value}`
            this.m_Entity.inserterStackSizeOverride = slider.value
        })
        textbox.on('changed', () => {
            // An empty box is the user part way through typing, not a value.
            if (textbox.text === '') return
            const size = Math.min(max, Math.max(1, +textbox.text))
            if (`${size}` !== textbox.text) textbox.text = `${size}`
            this.m_Entity.inserterStackSizeOverride = size
        })

        this.onEntityChange('inserterStackSize', () => {
            max = Math.max(max, rangeFor())
            syncing = true
            slider.max = max
            checkbox.checked = this.m_Entity.inserterStackSizeOverride !== undefined
            slider.value = shown()
            textbox.text = `${shown()}`
            syncing = false
        })
    }
}
