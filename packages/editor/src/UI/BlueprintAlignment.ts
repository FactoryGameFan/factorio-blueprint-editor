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
// The minimum a field label's text sits from its own input - each label
// right-aligns to its own input at this gap (see makeFieldLabel), rather
// than a fixed left-hand start position that left "X:"/"Y:" stranded far
// from their box while "Width:"/"Height:" sat close to theirs.
const LABEL_GAP = 3
// The two value columns' input boxes, right-aligned the way the game's own
// dialog has them - CONTENT_RIGHT matches Name/Description's own width
// (`BlueprintInfoEditor`'s TextInputs are 336 wide), so this lines up with
// their right edge rather than running past the dialog, which is what
// fixed x-coordinates copied from a mock-up had done (issue reported: both
// "not flush right" for Grid size and "runs off the dialog" for Grid
// position/Absolute - the same bug, since both rooted in guessed
// coordinates rather than the dialog's real content width).
const CONTENT_RIGHT = 336
const COL2_X = CONTENT_RIGHT - FIELD_WIDTH
const COL1_X = COL2_X - FIELD_WIDTH - 62

function parseGridValue(text: string): number {
    const n = parseInt(text, 10)
    return Number.isNaN(n) ? 0 : n
}

function makeLabel(text: string, x: number, y: number): Text {
    const t = new Text({ text, style: styles.dialog.label })
    t.position.set(x, y)
    return t
}

/** A field label right-aligned `LABEL_GAP` before `inputX`, regardless of
 * how wide the label text itself measures out to - so "X:"/"Y:" sit just
 * as close to their input as "Width:"/"Height:" do to theirs. */
function makeFieldLabel(text: string, inputX: number, y: number): Text {
    const t = new Text({ text, style: styles.dialog.label })
    t.position.set(inputX - LABEL_GAP - t.width, y)
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
 * `snapToGrid` is set - their inputs disable together with Grid size's while
 * it's off, rather than silently accepting edits the game would ignore.
 * `positionRelativeToGrid` stays editable regardless of Absolute vs
 * Relative, though: only `Blueprint.serialize` cares which is chosen, so
 * switching between them and back doesn't lose whatever was typed there.
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
    private readonly m_AbsoluteXInput: TextInput
    private readonly m_AbsoluteYInput: TextInput

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
        this.addChild(makeFieldLabel('Width:', COL1_X, ROW_HEIGHT + 8))
        this.m_WidthInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${size.x}`, 4, true)
        this.m_WidthInput.position.set(COL1_X, ROW_HEIGHT + 4)
        this.addChild(this.m_WidthInput)

        this.addChild(makeFieldLabel('Height:', COL2_X, ROW_HEIGHT + 8))
        this.m_HeightInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${size.y}`, 4, true)
        this.m_HeightInput.position.set(COL2_X, ROW_HEIGHT + 4)
        this.addChild(this.m_HeightInput)

        // One X/Y pair on the "Grid position" row itself - Absolute/Relative
        // below are only the choice of whether it applies, not a value each.
        this.addChild(makeLabel('Grid position', 0, ROW_HEIGHT * 2 + 8))

        this.addChild(makeFieldLabel('X:', COL1_X, ROW_HEIGHT * 2 + 8))
        this.m_XInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.x}`, 5, true)
        this.m_XInput.position.set(COL1_X, ROW_HEIGHT * 2 + 4)
        // Non-negative via `numericOnly` above isn't right for an offset - a
        // blueprint's grid position can sit either side of the grid it snaps
        // to - so this widens the restriction to an optional leading minus.
        this.m_XInput.restrict = /^-?\d*$/
        this.addChild(this.m_XInput)

        this.addChild(makeFieldLabel('Y:', COL2_X, ROW_HEIGHT * 2 + 8))
        this.m_YInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.y}`, 5, true)
        this.m_YInput.position.set(COL2_X, ROW_HEIGHT * 2 + 4)
        this.m_YInput.restrict = /^-?\d*$/
        this.addChild(this.m_YInput)

        // The +8 matches every field label's own y (see makeFieldLabel calls
        // below) - RadioButton draws its label at its own local y=0, so
        // without this the "Absolute" text sat 8px above the X:/Y: label
        // sharing its row, not level with it.
        this.m_AbsoluteRadio = new RadioButton(blueprint.absoluteSnapping, 'Absolute')
        this.m_AbsoluteRadio.position.set(0, ROW_HEIGHT * 3 + 8)
        this.addChild(this.m_AbsoluteRadio)

        // No `Blueprint` field backs these, unlike every other input here -
        // absolute mode has no configurable offset (it snaps to the world's
        // own grid, not one positioned by these) - but the game's own dialog
        // still shows the row with its own X/Y, enabled exactly while
        // Absolute is the active choice, so this matches that rather than
        // leaving the row permanently greyed out next to "Grid position"'s
        // genuinely-live X/Y above.
        this.addChild(makeFieldLabel('X:', COL1_X, ROW_HEIGHT * 3 + 8))
        this.m_AbsoluteXInput = new TextInput(G.app.renderer, FIELD_WIDTH, '0', 5, true)
        this.m_AbsoluteXInput.position.set(COL1_X, ROW_HEIGHT * 3 + 4)
        this.addChild(this.m_AbsoluteXInput)

        this.addChild(makeFieldLabel('Y:', COL2_X, ROW_HEIGHT * 3 + 8))
        this.m_AbsoluteYInput = new TextInput(G.app.renderer, FIELD_WIDTH, '0', 5, true)
        this.m_AbsoluteYInput.position.set(COL2_X, ROW_HEIGHT * 3 + 4)
        this.addChild(this.m_AbsoluteYInput)

        // Same +8 as Absolute above, for the same reason - kept even though
        // this row has no field label of its own, so both radios sit at the
        // same relative height within their row rather than only one of them
        // being nudged into alignment.
        this.m_RelativeRadio = new RadioButton(!blueprint.absoluteSnapping, 'Relative')
        this.m_RelativeRadio.position.set(0, ROW_HEIGHT * 4 + 8)
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

        // Editable whenever the grid itself is, regardless of Absolute vs
        // Relative - only *serialization* cares which one is chosen (see
        // Blueprint.serialize), so switching to Absolute and back to
        // Relative doesn't lose whatever was typed here in between.
        setFieldEnabled(this.m_XInput, gridEnabled)
        setFieldEnabled(this.m_YInput, gridEnabled)

        // The opposite of Grid position's X/Y: these have no data behind
        // them (see the comment where they're built), so they track the
        // choice exactly rather than surviving across it - enabled only
        // while grid is on *and* Absolute is the one selected.
        const absoluteEnabled = gridEnabled && this.m_Blueprint.absoluteSnapping
        setFieldEnabled(this.m_AbsoluteXInput, absoluteEnabled)
        setFieldEnabled(this.m_AbsoluteYInput, absoluteEnabled)
    }

    private onBlueprintChange<T extends EventEmitter.EventNames<BlueprintEvents>>(
        event: T,
        fn: EventEmitter.EventListener<BlueprintEvents, T>
    ): void {
        this.m_Blueprint.on(event, fn)
        this.once('destroyed', () => this.m_Blueprint.off(event, fn))
    }
}
