import { Container, Text } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import G from '../common/globals'
import { Blueprint, BlueprintEvents } from '../core/Blueprint'
import { Checkbox } from './controls/Checkbox'
import { RadioButton } from './controls/RadioButton'
import { TextInput } from './controls/TextInput'
import { styles } from './style'

// Exported for tests/blueprint-grid-position.spec.ts, which has no test hook
// reaching a control this deep inside a dialog and so clicks it by
// computed screen position instead (the same shape tests/chest-editor.spec.ts
// uses for ChestEditor's filter grid) - importing the real constants means a
// layout change here cannot silently desync the coordinates that spec clicks,
// the way a second, hand-copied set of numbers could.
export const ROW_HEIGHT = 32
export const FIELD_WIDTH = 44
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
export const COL2_X = CONTENT_RIGHT - FIELD_WIDTH
export const COL1_X = COL2_X - FIELD_WIDTH - 62

function parseGridValue(text: string): number {
    const n = parseInt(text, 10)
    return Number.isNaN(n) ? 0 : n
}

/**
 * Same as `parseGridValue`, floored at 1 - for Grid size specifically, never
 * for a position/offset, where 0 is a legitimate value. An empty or
 * non-numeric box parses to 0 through `parseGridValue`, and writing that
 * straight through produced an unrecoverable `snap-to-grid: {"x":0,"y":4}` -
 * zero-width grid, which the game will not accept back. 1 is what the field
 * itself falls back to display-wise (`size.x ?? 1`), so this is the same
 * floor made load-bearing rather than cosmetic.
 */
function parseGridSize(text: string): number {
    return Math.max(1, parseGridValue(text))
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
 * section of the game's own blueprint editor, including a control the game
 * has that carries no field of its own in the blueprint string - see "Grid
 * position" below, and `Blueprint.gridPositionOffsetStore`'s own doc comment
 * for the export-time mechanism backing it.
 *
 * Every text field here commits on `'blur'`, not `'changed'` - `'changed'`
 * fires on every keystroke (the DOM `'input'` event), and every commit here
 * re-renders from the blueprint afterwards (`refreshFromBlueprint`), which
 * overwrites the DOM input's own in-progress text with whatever that
 * keystroke alone parsed to. For Grid position specifically that meant the
 * field wiping itself back to its last committed value after the first
 * character typed; for Absolute X/Y it meant a leading '-' parsing to 0 and
 * being immediately echoed back, so a negative value could never be typed at
 * all - same mechanism, two different symptoms. Blur waits for the edit to
 * actually finish before either effect can happen.
 *
 * `absoluteSnapping`/`positionRelativeToGrid` are only meaningful while
 * `snapToGrid` is set - their inputs disable together with Grid size's while
 * it's off, rather than silently accepting edits the game would ignore.
 * Absolute's X/Y additionally disable whenever Relative is chosen instead:
 * measured against the game (issue #226), Absolute is the mode that
 * actually carries a position through export - `Blueprint.serialize` drops
 * it under Relative regardless of what's typed here, so the field disables
 * there rather than silently discarding it.
 */
export class BlueprintAlignment extends Container {
    private readonly m_Blueprint: Blueprint
    private readonly m_SnapCheckbox: Checkbox
    private readonly m_WidthInput: TextInput
    private readonly m_HeightInput: TextInput
    private readonly m_GridPosXInput: TextInput
    private readonly m_GridPosYInput: TextInput
    private readonly m_AbsoluteRadio: RadioButton
    private readonly m_RelativeRadio: RadioButton
    private readonly m_XInput: TextInput
    private readonly m_YInput: TextInput
    /**
     * Set on the first keystroke in either Absolute field since the last
     * commit or refresh, cleared after `commitPosition` runs. Blur fires
     * whenever focus leaves the field, typed-in-or-not - tabbing through
     * Absolute X/Y without touching either still blurs the second one, and
     * `commitPosition` unguarded would write `positionRelativeToGrid`
     * regardless, turning "never set" into an explicit `{0, 0}`. Those two
     * are not the same value to `Blueprint.serialize()` - see the "grid
     * position at origin is carried as it arrived" case in
     * tests/blueprint-snapping.spec.ts - so a commit with nothing typed is
     * not a harmless no-op the way it is for Width/Height/Grid position,
     * where the parsed value is always written idempotently either way.
     */
    private m_PositionDirty = false

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

        /*
            "Grid position" is not backed by any field of its own in the
            blueprint string, and it is not directly settable through the
            game's scripting API either - see `gridPositionOffsetStore`'s own
            doc comment for how that was confirmed and how it differs from
            Absolute X/Y beside it. Round-tripping a real export through the
            game showed it behaves like a *target*, the same as Width/Height
            or Absolute X/Y: typing a value moves the blueprint's content so
            `Blueprint.getGridPositionDisplay()` reads back exactly what was
            typed, and the field keeps showing that value afterwards rather
            than resetting - `commitGridPosition` below solves for whatever
            `gridPositionOffset` reproduces the typed target.
        */
        this.addChild(makeLabel('Grid position', 0, ROW_HEIGHT * 2 + 8))

        const gridPosition = blueprint.getGridPositionDisplay()

        this.addChild(makeFieldLabel('X:', COL1_X, ROW_HEIGHT * 2 + 8))
        this.m_GridPosXInput = new TextInput(
            G.app.renderer,
            FIELD_WIDTH,
            `${gridPosition.x}`,
            5,
            true
        )
        this.m_GridPosXInput.position.set(COL1_X, ROW_HEIGHT * 2 + 4)
        this.m_GridPosXInput.restrict = /^-?\d*$/
        this.addChild(this.m_GridPosXInput)

        this.addChild(makeFieldLabel('Y:', COL2_X, ROW_HEIGHT * 2 + 8))
        this.m_GridPosYInput = new TextInput(
            G.app.renderer,
            FIELD_WIDTH,
            `${gridPosition.y}`,
            5,
            true
        )
        this.m_GridPosYInput.position.set(COL2_X, ROW_HEIGHT * 2 + 4)
        this.m_GridPosYInput.restrict = /^-?\d*$/
        this.addChild(this.m_GridPosYInput)

        // The +8 matches every field label's own y (see makeFieldLabel calls
        // above) - RadioButton draws its label at its own local y=0, so
        // without this the "Absolute" text sat 8px above the X:/Y: label
        // sharing its row, not level with it.
        this.m_AbsoluteRadio = new RadioButton(blueprint.absoluteSnapping, 'Absolute')
        this.m_AbsoluteRadio.position.set(0, ROW_HEIGHT * 3 + 8)
        this.addChild(this.m_AbsoluteRadio)

        // Absolute's own X/Y, on its own row rather than shared with "Grid
        // position" above - this pair IS `positionRelativeToGrid`, the one
        // that actually round-trips through the blueprint string.
        this.addChild(makeFieldLabel('X:', COL1_X, ROW_HEIGHT * 3 + 8))
        this.m_XInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.x}`, 5, true)
        this.m_XInput.position.set(COL1_X, ROW_HEIGHT * 3 + 4)
        // Non-negative via `numericOnly` above isn't right for an offset - a
        // blueprint's grid position can sit either side of the grid it snaps
        // to - so this widens the restriction to an optional leading minus.
        this.m_XInput.restrict = /^-?\d*$/
        this.addChild(this.m_XInput)

        this.addChild(makeFieldLabel('Y:', COL2_X, ROW_HEIGHT * 3 + 8))
        this.m_YInput = new TextInput(G.app.renderer, FIELD_WIDTH, `${position.y}`, 5, true)
        this.m_YInput.position.set(COL2_X, ROW_HEIGHT * 3 + 4)
        this.m_YInput.restrict = /^-?\d*$/
        this.addChild(this.m_YInput)

        // Same +8 as Absolute above, for the same reason - kept even though
        // this row has no field label or X/Y of its own, so both radios sit
        // at the same relative height within their row.
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

        this.m_WidthInput.on('blur', () => this.commitSize())
        this.m_HeightInput.on('blur', () => this.commitSize())

        this.m_GridPosXInput.on('blur', () => this.commitGridPosition())
        this.m_GridPosYInput.on('blur', () => this.commitGridPosition())

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

        this.m_XInput.on('changed', () => {
            this.m_PositionDirty = true
        })
        this.m_YInput.on('changed', () => {
            this.m_PositionDirty = true
        })
        this.m_XInput.on('blur', () => this.commitPosition())
        this.m_YInput.on('blur', () => this.commitPosition())

        this.onBlueprintChange('snapToGrid', () => this.refreshFromBlueprint())
        this.onBlueprintChange('absoluteSnapping', () => this.refreshFromBlueprint())
        this.onBlueprintChange('positionRelativeToGrid', () => this.refreshFromBlueprint())
        this.onBlueprintChange('gridPositionOffset', () => this.refreshFromBlueprint())
    }

    private commitSize(): void {
        if (this.m_Blueprint.snapToGrid === undefined) return
        this.m_Blueprint.snapToGrid = {
            x: parseGridSize(this.m_WidthInput.text),
            y: parseGridSize(this.m_HeightInput.text),
        }
        // parseGridSize may have floored an empty/zero box back to 1 without
        // changing the blueprint (already 1) - refreshFromBlueprint only
        // fires from the blueprint's own change event, so a redundant write
        // needs its own correction here or the box would be left showing
        // the invalid text the user actually typed.
        this.m_WidthInput.text = `${this.m_Blueprint.snapToGrid.x}`
        this.m_HeightInput.text = `${this.m_Blueprint.snapToGrid.y}`
    }

    /**
     * "Grid position"'s own commit. The typed text is a *target* for what
     * `Blueprint.getGridPositionDisplay()` should read back, not a delta -
     * see that method's doc comment for the formula and the field's own
     * comment above for how that was confirmed against the game. Solves for
     * the `gridPositionOffset` that reproduces it: displayed = target means
     * `offset` has to move by exactly `current - target` from whatever it is
     * now, since increasing `offset` by 1 decreases the floored display by 1
     * (the same relationship `serialize()` and `getGridPositionDisplay()`
     * both encode). Untouched-field commits are naturally idempotent from
     * this - target equals current, delta is 0, `gridPositionOffset`'s own
     * `pointsEqual` guard turns the write into a no-op - so unlike Absolute
     * X/Y this needs no separate dirty flag.
     */
    private commitGridPosition(): void {
        const target = {
            x: parseGridValue(this.m_GridPosXInput.text),
            y: parseGridValue(this.m_GridPosYInput.text),
        }
        const current = this.m_Blueprint.getGridPositionDisplay()
        const delta = { x: current.x - target.x, y: current.y - target.y }
        const offset = this.m_Blueprint.gridPositionOffset
        this.m_Blueprint.gridPositionOffset = { x: offset.x + delta.x, y: offset.y + delta.y }
    }

    private commitPosition(): void {
        if (!this.m_PositionDirty) return
        this.m_PositionDirty = false
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

        const gridPosition = this.m_Blueprint.getGridPositionDisplay()
        this.m_GridPosXInput.text = `${gridPosition.x}`
        this.m_GridPosYInput.text = `${gridPosition.y}`

        const position = this.m_Blueprint.positionRelativeToGrid ?? { x: 0, y: 0 }
        this.m_XInput.text = `${position.x}`
        this.m_YInput.text = `${position.y}`

        this.refreshEnabled()
    }

    private refreshEnabled(): void {
        const gridEnabled = this.m_Blueprint.snapToGrid !== undefined
        setFieldEnabled(this.m_WidthInput, gridEnabled)
        setFieldEnabled(this.m_HeightInput, gridEnabled)

        // Gated the same as Grid size, not by Absolute/Relative - measured
        // against the game, Grid position moves entities regardless of
        // which snapping mode is chosen.
        setFieldEnabled(this.m_GridPosXInput, gridEnabled)
        setFieldEnabled(this.m_GridPosYInput, gridEnabled)

        this.m_AbsoluteRadio.eventMode = gridEnabled ? 'static' : 'none'
        this.m_AbsoluteRadio.alpha = gridEnabled ? 1 : 0.5
        this.m_RelativeRadio.eventMode = gridEnabled ? 'static' : 'none'
        this.m_RelativeRadio.alpha = gridEnabled ? 1 : 0.5

        // Editable only while the grid is on *and* Absolute is the chosen
        // mode - measured against the game (issue #226), Relative never
        // carries a position through export, so leaving this enabled there
        // would let someone type a value that silently never reaches the
        // exported string. The value itself still survives switching to
        // Relative and back, since disabling doesn't clear `m_XInput.text`.
        const positionEnabled = gridEnabled && this.m_Blueprint.absoluteSnapping
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
