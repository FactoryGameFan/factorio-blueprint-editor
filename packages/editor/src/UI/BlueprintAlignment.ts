import { Container, Text } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import G from '../common/globals'
import { Blueprint, BlueprintEvents } from '../core/Blueprint'
import { Checkbox } from './controls/Checkbox'
import { RadioButton } from './controls/RadioButton'
import { TextInput } from './controls/TextInput'
import { styles } from './style'

const ROW_HEIGHT = 32
const FIELD_WIDTH = 44

function parseGridValue(text: string): number {
    const n = parseInt(text, 10)
    return Number.isNaN(n) ? 0 : n
}

function makeLabel(text: string, x: number, y: number): Text {
    const t = new Text({ text, style: styles.dialog.label })
    t.position.set(x, y)
    return t
}

/**
 * `.disabled` (the real DOM `disabled` attribute underneath) already stops
 * typing, but doesn't dim anything - TextInput's own box config comments out
 * its `disabled` style, and `.alpha` only reaches the box graphic, not the
 * DOM text: `_updateDOMInput`'s `opacity` line is commented out too, citing
 * a pixi.js worldAlpha/DOM sync issue (see TextInput.ts). `setInputStyle`
 * goes straight to the DOM element's own CSS instead, so this dims both
 * halves the two other routes miss one of.
 */
function setFieldEnabled(input: TextInput, enabled: boolean): void {
    input.disabled = !enabled
    input.alpha = enabled ? 1 : 0.5
    input.setInputStyle('opacity', enabled ? '1' : '0.5')
}

/**
 * The blueprint's own grid-snapping settings - `snap-to-grid`,
 * `absolute-snapping` and `position-relative-to-grid` in the blueprint
 * string, which the editor has always round-tripped on import/export without
 * ever showing or letting anyone change them. Mirrors the corresponding
 * section of the game's own blueprint editor: a grid size, and a choice
 * between snapping to the world's absolute grid or one offset by a position.
 *
 * `absoluteSnapping`/`positionRelativeToGrid` are only meaningful while
 * `snapToGrid` is set, and `positionRelativeToGrid` only while
 * `absoluteSnapping` is false - both stay stored either way (so flipping a
 * choice back doesn't lose what was there), but their inputs disable to say
 * so rather than silently accepting edits the game would ignore.
 */
export class BlueprintAlignment extends Container {
    private readonly m_Blueprint: Blueprint
    private readonly m_SnapCheckbox: Checkbox
    private readonly m_WidthInput: TextInput
    private readonly m_HeightInput: TextInput
    private readonly m_AbsoluteRadio: RadioButton
    private readonly m_RelativeRadio: RadioButton
    private readonly m_XInput: TextInput
    private readonly m_YInput: TextInput

    public static readonly HEIGHT = ROW_HEIGHT * 5

    public constructor(blueprint: Blueprint) {
        super()

        this.m_Blueprint = blueprint

        const size = blueprint.snapToGrid ?? { x: 1, y: 1 }
        const position = blueprint.positionRelativeToGrid ?? { x: 0, y: 0 }

        this.m_SnapCheckbox = new Checkbox(blueprint.snapToGrid !== undefined, 'Snap to grid')
        this.m_SnapCheckbox.position.set(0, 0)
        this.addChild(this.m_SnapCheckbox)

        this.addChild(makeLabel('Grid size', 0, ROW_HEIGHT + 8))
        this.addChild(makeLabel('Width:', 96, ROW_HEIGHT + 8))
        this.m_WidthInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${size.x}`, 4, true)
        this.m_WidthInput.position.set(140, ROW_HEIGHT + 4)
        this.addChild(this.m_WidthInput)

        this.addChild(makeLabel('Height:', 196, ROW_HEIGHT + 8))
        this.m_HeightInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${size.y}`, 4, true)
        this.m_HeightInput.position.set(244, ROW_HEIGHT + 4)
        this.addChild(this.m_HeightInput)

        // One X/Y pair on the "Grid position" row itself - Absolute/Relative
        // below are only the choice of whether it applies, not a value each.
        this.addChild(makeLabel('Grid position', 0, ROW_HEIGHT * 2 + 8))

        this.addChild(makeLabel('X:', 196, ROW_HEIGHT * 2 + 8))
        this.m_XInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.x}`, 5, true)
        this.m_XInput.position.set(220, ROW_HEIGHT * 2 + 4)
        // Non-negative via `numericOnly` above isn't right for an offset - a
        // blueprint's grid position can sit either side of the grid it snaps
        // to - so this widens the restriction to an optional leading minus.
        this.m_XInput.restrict = /^-?\d*$/
        this.addChild(this.m_XInput)

        this.addChild(makeLabel('Y:', 280, ROW_HEIGHT * 2 + 8))
        this.m_YInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.y}`, 5, true)
        this.m_YInput.position.set(304, ROW_HEIGHT * 2 + 4)
        this.m_YInput.restrict = /^-?\d*$/
        this.addChild(this.m_YInput)

        this.m_AbsoluteRadio = new RadioButton(blueprint.absoluteSnapping, 'Absolute')
        this.m_AbsoluteRadio.position.set(0, ROW_HEIGHT * 3)
        this.addChild(this.m_AbsoluteRadio)

        // Permanently disabled, unlike every other input here - absolute mode
        // has no configurable offset (it snaps to the world's own grid, not
        // one positioned by these), so there is nothing for these to read or
        // write. Shown anyway, greyed out, to match the game's own dialog
        // rather than leaving this row looking unfinished next to
        // "Grid position"'s active X/Y above.
        this.addChild(makeLabel('X:', 196, ROW_HEIGHT * 3 + 8))
        const absoluteXInput = new TextInput(G.app.renderer, FIELD_WIDTH, '0', 5, true)
        absoluteXInput.position.set(220, ROW_HEIGHT * 3 + 4)
        setFieldEnabled(absoluteXInput, false)
        this.addChild(absoluteXInput)

        this.addChild(makeLabel('Y:', 280, ROW_HEIGHT * 3 + 8))
        const absoluteYInput = new TextInput(G.app.renderer, FIELD_WIDTH, '0', 5, true)
        absoluteYInput.position.set(304, ROW_HEIGHT * 3 + 4)
        setFieldEnabled(absoluteYInput, false)
        this.addChild(absoluteYInput)

        this.m_RelativeRadio = new RadioButton(!blueprint.absoluteSnapping, 'Relative')
        this.m_RelativeRadio.position.set(0, ROW_HEIGHT * 4)
        this.addChild(this.m_RelativeRadio)

        this.refreshEnabled()

        this.m_SnapCheckbox.on('changed', () => {
            if (this.m_SnapCheckbox.checked) {
                this.m_Blueprint.snapToGrid = {
                    x: parseGridValue(this.m_WidthInput.text),
                    y: parseGridValue(this.m_HeightInput.text),
                }
                // The game's own default the moment snapping turns on -
                // confirmed by decoding a freshly-enabled-and-exported
                // blueprint string, which always carries `absolute-snapping:
                // true` rather than omitting it.
                this.m_Blueprint.absoluteSnapping = true
            } else {
                this.m_Blueprint.snapToGrid = undefined
            }
            this.refreshFromBlueprint()
        })

        this.m_WidthInput.on('changed', () => this.commitSize())
        this.m_HeightInput.on('changed', () => this.commitSize())

        // RadioButton only ever sets itself checked (see RadioButton.ts), so
        // unlike Checkbox there is no accidental "toggle off" to worry about
        // - but `refreshFromBlueprint` still has to run explicitly, since the
        // no-longer-selected radio needs *someone* to uncheck it, and
        // `absoluteSnapping`'s setter no-ops (and never emits) on a redundant
        // click of the one already selected.
        this.m_AbsoluteRadio.on('changed', () => {
            this.m_Blueprint.absoluteSnapping = true
            this.refreshFromBlueprint()
        })
        this.m_RelativeRadio.on('changed', () => {
            this.m_Blueprint.absoluteSnapping = false
            this.refreshFromBlueprint()
        })

        this.m_XInput.on('changed', () => this.commitPosition())
        this.m_YInput.on('changed', () => this.commitPosition())

        this.onBlueprintChange('snapToGrid', () => this.refreshFromBlueprint())
        this.onBlueprintChange('absoluteSnapping', () => this.refreshFromBlueprint())
        this.onBlueprintChange('positionRelativeToGrid', () => this.refreshFromBlueprint())
    }

    private commitSize(): void {
        if (this.m_Blueprint.snapToGrid === undefined) return
        this.m_Blueprint.snapToGrid = {
            x: parseGridValue(this.m_WidthInput.text),
            y: parseGridValue(this.m_HeightInput.text),
        }
    }

    private commitPosition(): void {
        this.m_Blueprint.positionRelativeToGrid = {
            x: parseGridValue(this.m_XInput.text),
            y: parseGridValue(this.m_YInput.text),
        }
    }

    private refreshFromBlueprint(): void {
        const size = this.m_Blueprint.snapToGrid
        this.m_SnapCheckbox.checked = size !== undefined
        this.m_WidthInput.text = `${size?.x ?? 1}`
        this.m_HeightInput.text = `${size?.y ?? 1}`

        this.m_AbsoluteRadio.checked = this.m_Blueprint.absoluteSnapping
        this.m_RelativeRadio.checked = !this.m_Blueprint.absoluteSnapping

        const position = this.m_Blueprint.positionRelativeToGrid ?? { x: 0, y: 0 }
        this.m_XInput.text = `${position.x}`
        this.m_YInput.text = `${position.y}`

        this.refreshEnabled()
    }

    private refreshEnabled(): void {
        const gridEnabled = this.m_Blueprint.snapToGrid !== undefined
        setFieldEnabled(this.m_WidthInput, gridEnabled)
        setFieldEnabled(this.m_HeightInput, gridEnabled)

        this.m_AbsoluteRadio.eventMode = gridEnabled ? 'static' : 'none'
        this.m_AbsoluteRadio.alpha = gridEnabled ? 1 : 0.5
        this.m_RelativeRadio.eventMode = gridEnabled ? 'static' : 'none'
        this.m_RelativeRadio.alpha = gridEnabled ? 1 : 0.5

        const positionEnabled = gridEnabled && !this.m_Blueprint.absoluteSnapping
        setFieldEnabled(this.m_XInput, positionEnabled)
        setFieldEnabled(this.m_YInput, positionEnabled)
    }

    private onBlueprintChange<T extends EventEmitter.EventNames<BlueprintEvents>>(
        event: T,
        fn: EventEmitter.EventListener<BlueprintEvents, T>
    ): void {
        this.m_Blueprint.on(event, fn)
        this.once('destroyed', () => this.m_Blueprint.off(event, fn))
    }
}
