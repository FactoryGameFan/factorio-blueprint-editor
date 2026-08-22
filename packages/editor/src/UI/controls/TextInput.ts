import { Renderer, Container, DestroyOptions, Graphics, Matrix } from 'pixi.js'
import { FunctionKeys } from 'utility-types'
import { colors, styles } from '../style'

/*
    The three states a box can be drawn for. This used to carry `| string`,
    which absorbed all three literals and left the type meaning `string` - so
    `boxGenerator(w, h, 'DEFULT')` compiled (issue #81). Checked against what
    actually reaches it before narrowing: every `_setState` call passes one of
    these three, and `_buildBoxCache` builds exactly these three.
*/
type State = 'FOCUSED' | 'DISABLED' | 'DEFAULT'

type BoxGenerator = (w: number, h: number, state: State) => Container

type Style = {
    fill?: number
    rounded?: number
    stroke?: {
        width?: number
        color?: number
        alpha?: number
    }
}

/*
    `default` is the only one a caller must supply; the other two fall back to
    it. That was already the behaviour - `DefaultBoxGenerator` filled them in -
    and the sole caller in this file does pass `default` and `focused` with
    `disabled` commented out, so a type demanding all three would reject it.
*/
type Styles = { default: Style } & Partial<Record<Lowercase<State>, Style>>

type Options = {
    renderer: Renderer
    multiline?: boolean
    box?: Styles | BoxGenerator
    input?: InputStyles
}

type InputStyles = Partial<
    Omit<CSSStyleDeclaration, 'length' | 'parentRule' | FunctionKeys<CSSStyleDeclaration>>
>

type IRect = {
    top: number
    left: number
    width: number
    height: number
}

type PreviousData = {
    state: State
    canvas_bounds: IRect
    input_bounds: IRect
    world_transform: Matrix
    local_visible: boolean
    // world_alpha: number
    // world_visible: boolean
}

// The class below is a modified version of Mwni's pixi-text-input under the MIT License
// https://github.com/Mwni/pixi-text-input/blob/8e3f913ac9b497506474205028e5d783e3aab71c/src/PIXI.TextInput.js

// Doesn't support changes in alpha nor visibility due to: https://github.com/pixijs/pixijs/issues/11030

class OriginalTextInput extends Container {
    private _input_style: InputStyles
    private _placeholder: string
    // Absent when no `box` option was given, which _renderInternal already
    // returns early on - the declaration was the only thing claiming otherwise.
    private _box_generator: BoxGenerator | undefined
    // Partial because it starts empty and is filled by _buildBoxCache; the
    // reads below say what to do when a state is missing rather than assuming.
    private _box_cache: Partial<Record<State, Container>>
    private _previous: Partial<PreviousData>
    private _dom_added: boolean
    private _dom_visible: boolean
    private readonly _dom_input: HTMLInputElement | HTMLTextAreaElement
    private _selection: number[]
    private _restrict_value: string
    // Absent until a caller sets `restrict`; the read in _onInputInput is already
    // written as a truthiness guard, which is what said so before the type did.
    private _restrict_regex: RegExp | undefined
    private _disabled: boolean
    // Absent until a caller sets `maxLength`. There is no honest default: 0 would
    // mean "no characters allowed" rather than "no limit".
    private _max_length: number | undefined
    private _multiline: boolean
    private _renderer: Renderer
    // Both are unset until the first render, and both are read through an
    // `if (!...)` guard that predates this - see _renderInternal.
    private _canvas_bounds: IRect | undefined
    private _box: Container | undefined
    public state: State = 'DEFAULT'

    public constructor(options: Options) {
        super()
        this._input_style = {
            position: 'absolute',
            background: 'none',
            border: 'none',
            outline: 'none',
            transformOrigin: '0 0',
            lineHeight: '1',
            ...options.input,
        }

        if (options.box)
            this._box_generator =
                typeof options.box === 'function' ? options.box : DefaultBoxGenerator(options.box)
        else this._box_generator = undefined

        this._multiline = !!options.multiline

        this._box_cache = {}
        this._previous = {}
        this._dom_added = false
        this._dom_visible = true
        this._placeholder = ''
        this._selection = [0, 0]
        this._restrict_value = ''
        this._disabled = false
        this._dom_input = this._createDOMInput()
        this._setState('DEFAULT')
        this._addListeners()

        this._renderer = options.renderer
        this.onRender = () => {
            this._renderInternal()
        }
    }

    // GETTERS & SETTERS

    public get placeholder(): string {
        return this._placeholder
    }

    public set placeholder(text: string) {
        this._placeholder = text
        this._dom_input.placeholder = text
    }

    public get disabled(): boolean {
        return this._disabled
    }

    public set disabled(disabled: boolean) {
        this._disabled = disabled
        this._dom_input.disabled = disabled
        this._setState(disabled ? 'DISABLED' : 'DEFAULT')
    }

    public get maxLength(): number | undefined {
        return this._max_length
    }

    public set maxLength(length: number) {
        this._max_length = length
        this._dom_input.setAttribute('maxlength', `${length}`)
    }

    public get restrict(): RegExp | undefined {
        return this._restrict_regex
    }

    public set restrict(regex: RegExp | string) {
        if (regex instanceof RegExp) {
            let _regex = regex.toString().slice(1, -1)

            if (_regex.charAt(0) !== '^') _regex = `^${_regex}`

            if (_regex.charAt(_regex.length - 1) !== '$') _regex += '$'

            this._restrict_regex = new RegExp(_regex)
        } else {
            this._restrict_regex = new RegExp(`^[${regex}]*$`)
        }
    }

    public get text(): string {
        return this._dom_input.value
    }

    public set text(text: string) {
        this._dom_input.value = text
        /*
            `_restrict_value` used to be written only inside
            `_applyRestriction`, on a real keystroke - a programmatic
            assignment (every constructor, and every commit-then-redisplay
            in the dialogs above this) fires no `input` event, so it left
            `_restrict_value` at its constructor default of `''` regardless
            of what `.text` had just been set to. The first *rejected*
            keystroke afterwards then rolled the field back to that stale
            `''` rather than to what was actually showing (#243 review) -
            reachable the moment anything committed on blur and let a bad
            character reach `_applyRestriction` before the field had ever
            legitimately changed by typing.
        */
        this._restrict_value = text
    }

    public get htmlInput(): HTMLInputElement | HTMLTextAreaElement {
        return this._dom_input
    }

    public get domVisible(): boolean {
        return this._dom_visible
    }

    /**
     * Whether the element may show at all, independent of `visible`. False is
     * how a dialog that is no longer the topmost one hides its fields: the
     * element sits on document.body over the canvas, so no pixi dialog drawn
     * above it can occlude it - it shows through, and goes on taking the
     * clicks aimed at whatever covers it.
     */
    public set domVisible(visible: boolean) {
        if (this._dom_visible === visible) return
        this._dom_visible = visible
        // _needsUpdate watches the transform and the canvas rect only, so no
        // update is otherwise pending - a field that never moves again would
        // keep the old visibility forever.
        this._setDOMInputVisible(this.visible && visible)
    }

    public focus(): void {
        this._dom_input.focus()
    }

    public blur(): void {
        this._dom_input.blur()
    }

    public select(): void {
        this.focus()
        this._dom_input.select()
    }

    public setInputStyle<K extends keyof InputStyles>(key: K, value: InputStyles[K]): void {
        this._input_style[key] = value
        // InputStyles is a Partial, so undefined is a value it can carry, and it
        // means "no such style". The empty string is how CSSOM says that -
        // assigning undefined would stringify to "undefined" and be dropped as
        // an invalid value, leaving whatever was there before.
        this._dom_input.style[key] = value ?? ''

        if (this._renderer) this._update()
    }

    public override destroy(options?: DestroyOptions): void {
        this._destroyBoxCache()
        super.destroy(options)
    }

    // SETUP

    /*
        Returns the element rather than assigning `this._dom_input` itself, which
        is what it used to do. TypeScript's definite-assignment analysis reads the
        constructor body only and does not follow calls out of it, so a field
        assigned in here reads as never assigned at all.
    */
    private _createDOMInput(): HTMLInputElement | HTMLTextAreaElement {
        let input: HTMLInputElement | HTMLTextAreaElement
        if (this._multiline) {
            const textarea = document.createElement('textarea')
            textarea.style.resize = 'none'
            input = textarea
        } else {
            const text = document.createElement('input')
            text.type = 'text'
            input = text
        }

        for (const [key, value] of Object.entries(this._input_style)) {
            input.style[key as keyof InputStyles] = value ?? ''
        }

        return input
    }

    private _addListeners(): void {
        this.on('added', this._onAdded.bind(this))
        this.on('removed', this._onRemoved.bind(this))
        this._dom_input.addEventListener('keydown', this._onInputKeyDown.bind(this))
        this._dom_input.addEventListener('input', this._onInputInput.bind(this))
        this._dom_input.addEventListener('keyup', this._onInputKeyUp.bind(this))
        this._dom_input.addEventListener('focus', this._onFocused.bind(this))
        this._dom_input.addEventListener('blur', this._onBlurred.bind(this))
    }

    private _onInputKeyDown(): void {
        /*
            The DOM types these `number | null`, null being what an input whose
            type does not support selection answers. _createDOMInput only ever
            makes a textarea or a text input, both of which do, so the null arm
            is unreachable here - 0 rather than a throw because the only
            consumer is a setSelectionRange call restoring a restricted value.
        */
        this._selection = [this._dom_input.selectionStart ?? 0, this._dom_input.selectionEnd ?? 0]

        // this.emit('keydown', e.keyCode)
    }

    private _onInputInput(): void {
        if (this._restrict_regex !== undefined) this._applyRestriction(this._restrict_regex)

        this.emit('changed')
    }

    private _onInputKeyUp(): void {
        // this.emit('keyup', e.keyCode)
    }

    private _onFocused(): void {
        this._setState('FOCUSED')
        // this.emit('focus')
    }

    private _onBlurred(): void {
        this._setState('DEFAULT')
        this.emit('blur')
    }

    private _onAdded(): void {
        document.body.appendChild(this._dom_input)
        this._dom_input.style.display = 'none'
        this._dom_added = true
    }

    private _onRemoved(): void {
        document.body.removeChild(this._dom_input)
        this._dom_added = false
    }

    private _setState(state: State): void {
        this.state = state
        this._updateBox()
    }

    // RENDER & UPDATE

    private _renderInternal(): void {
        this._canvas_bounds = this._getCanvasBounds()
        if (this._needsUpdate()) this._update()
    }

    private _update(): void {
        this._updateDOMInput()
        this._updateBox()
    }

    private _updateBox(): void {
        if (!this._box_generator) return

        if (this._needsNewBoxCache()) this._buildBoxCache(this._box_generator)

        if (this.state === this._previous.state && this._box === this._box_cache[this.state]) return

        /*
            _buildBoxCache fills all three states, so a miss means it has not
            run - and this is reached from onRender with no try/catch above it,
            so drawing no box is the answer rather than throwing and taking the
            frame with it.
        */
        const box = this._box_cache[this.state]
        if (box === undefined) return

        if (this._box) this.removeChild(this._box)

        this._box = box
        this.addChildAt(box, 0)
        this._previous.state = this.state
    }

    private _updateDOMInput(): void {
        if (!this._canvas_bounds) return

        this._dom_input.style.top = `${this._canvas_bounds.top || 0}px`
        this._dom_input.style.left = `${this._canvas_bounds.left || 0}px`
        this._dom_input.style.transform = this._pixiMatrixToCSS(
            this._getDOMRelativeWorldTransform()
        )
        // this._dom_input.style.opacity = `${this.worldAlpha}`
        this._setDOMInputVisible(this.visible && /* this.worldVisible && */ this._dom_visible)

        this._previous.canvas_bounds = this._canvas_bounds
        this._previous.world_transform = this.worldTransform.clone()
        this._previous.local_visible = this.visible
        // this._previous.world_alpha = this.worldAlpha
        // this._previous.world_visible = this.worldVisible
    }

    private _applyRestriction(regex: RegExp): void {
        if (regex.test(this.text)) {
            this._restrict_value = this.text
        } else {
            this.text = this._restrict_value
            this._dom_input.setSelectionRange(this._selection[0], this._selection[1])
        }
    }

    // STATE COMPAIRSON (FOR PERFORMANCE BENEFITS)

    private _needsUpdate(): boolean {
        return (
            !this._comparePixiMatrices(this.worldTransform, this._previous.world_transform) ||
            !this._compareClientRects(this._canvas_bounds, this._previous.canvas_bounds) ||
            this.visible !== this._previous.local_visible
            // || this.worldAlpha !== this._previous.world_alpha ||
            // this.worldVisible !== this._previous.world_visible
        )
    }

    private _needsNewBoxCache(): boolean {
        const input_bounds = this._getDOMInputBounds()
        return (
            !this._previous.input_bounds ||
            input_bounds.width !== this._previous.input_bounds.width ||
            input_bounds.height !== this._previous.input_bounds.height
        )
    }

    // CACHING OF INPUT BOX GRAPHICS

    /*
        Takes the generator rather than reading the field, so the one caller's
        `if (!this._box_generator) return` is what makes this callable at all.
        The alternative was a second check here that could never fire.
    */
    private _buildBoxCache(box_generator: BoxGenerator): void {
        this._destroyBoxCache()

        const states: State[] = ['DEFAULT', 'FOCUSED', 'DISABLED']
        const input_bounds = this._getDOMInputBounds()

        for (const state of states) {
            this._box_cache[state] = box_generator(input_bounds.width, input_bounds.height, state)
        }

        this._previous.input_bounds = input_bounds
    }

    private _destroyBoxCache(): void {
        if (this._box) {
            this.removeChild(this._box)
            this._box = undefined
        }

        for (const obj of Object.values(this._box_cache)) {
            obj.destroy()
        }
        this._box_cache = {}
    }

    // HELPER FUNCTIONS

    private _setDOMInputVisible(visible: boolean): void {
        this._dom_input.style.display = visible ? 'block' : 'none'
    }

    private _getCanvasBounds(): IRect {
        const rect = this._renderer.canvas.getBoundingClientRect()
        const bounds = { top: rect.y, left: rect.x, width: rect.width, height: rect.height }
        bounds.left += window.scrollX
        bounds.top += window.scrollY
        return bounds
    }

    private _getDOMInputBounds(): IRect {
        let remove_after = false

        if (!this._dom_added) {
            document.body.appendChild(this._dom_input)
            remove_after = true
        }

        const org_transform = this._dom_input.style.transform
        const org_display = this._dom_input.style.display
        this._dom_input.style.transform = ''
        this._dom_input.style.display = 'block'
        const bounds = this._dom_input.getBoundingClientRect()
        this._dom_input.style.transform = org_transform
        this._dom_input.style.display = org_display

        if (remove_after) document.body.removeChild(this._dom_input)

        return bounds
    }

    private _getDOMRelativeWorldTransform(): Matrix {
        const canvas_bounds = this._renderer.canvas.getBoundingClientRect()
        const matrix = this.worldTransform.clone()

        matrix.scale(this._renderer.resolution, this._renderer.resolution)
        matrix.scale(
            canvas_bounds.width / this._renderer.width,
            canvas_bounds.height / this._renderer.height
        )
        return matrix
    }

    private _pixiMatrixToCSS(m: Matrix): string {
        return `matrix(${[m.a, m.b, m.c, m.d, m.tx, m.ty].join(',')})`
    }

    /*
        Only the second parameter is widened. m1 is always `this.worldTransform`,
        which pixi guarantees; m2 comes out of `_previous`, which is a Partial and
        is empty until the first render. Saying `| undefined` on both would push
        a check onto a caller that cannot pass one.
    */
    private _comparePixiMatrices(m1: Matrix, m2: Matrix | undefined): boolean {
        if (!m1 || !m2) return false
        return (
            m1.a === m2.a &&
            m1.b === m2.b &&
            m1.c === m2.c &&
            m1.d === m2.d &&
            m1.tx === m2.tx &&
            m1.ty === m2.ty
        )
    }

    // Both widened here, unlike _comparePixiMatrices: r1 is `_canvas_bounds`,
    // which is unset until the first _renderInternal.
    private _compareClientRects(r1: IRect | undefined, r2: IRect | undefined): boolean {
        if (!r1 || !r2) return false
        return (
            r1.left === r2.left &&
            r1.top === r2.top &&
            r1.width === r2.width &&
            r1.height === r2.height
        )
    }
}

function DefaultBoxGenerator(styles: Styles): BoxGenerator {
    return (w, h, state) => {
        /*
            Falls back to `default` at read time. This used to be done by
            assigning the missing entries onto `styles` up front, which mutated
            the object the caller passed in; the fallback says the same thing
            without reaching back into someone else's literal.
        */
        const style = styles[state.toLowerCase() as Lowercase<State>] ?? styles.default
        const box = new Graphics()

        if (style.rounded) box.roundRect(0, 0, w, h, style.rounded)
        else box.rect(0, 0, w, h)

        if (style.fill) box.fill(style.fill)

        if (style.stroke)
            box.stroke({
                width: style.stroke.width || 1,
                color: style.stroke.color || 0,
                alpha: style.stroke.alpha || 1,
            })

        return box
    }
}

export class TextInput extends OriginalTextInput {
    public constructor(
        renderer: Renderer,
        width: number,
        text: string,
        maxLength: number,
        numericOnly = false,
        // Backs a <textarea> instead of an <input> - BlueprintInfoEditor's
        // description field is the first caller to need one, since a
        // description is the one piece of text in the app that is genuinely
        // multi-line rather than a single value that happens to be long.
        multiline = false,
        height?: number
    ) {
        super({
            renderer,
            multiline,
            input: {
                fontFamily: styles.controls.textbox.fontFamily,
                fontWeight: styles.controls.textbox.fontWeight,
                /*
                    The `px` is the fix for issue #60. `styles.controls.textbox`
                    is shaped like a pixi TextStyle, where `fontSize` is a
                    number and wants to stay one, so the unit belongs here at
                    the CSS end rather than in style.ts - which is what the
                    `width` line below has always done. Without it the element
                    was asked for `font-size: 14`, which has no unit, is
                    invalid, and was dropped by the CSSOM, leaving every text
                    box in the editor at the browser default instead of 14px.
                */
                fontSize: `${styles.controls.textbox.fontSize}px`,
                width: `${width}px`,
                ...(height !== undefined ? { height: `${height}px` } : {}),
                color: `black`,
            },
            box: {
                default: {
                    fill: colors.controls.textbox.background.color,
                    rounded: 1,
                    stroke: { color: 0xcbcee0, width: 1 },
                },
                focused: {
                    fill: colors.controls.textbox.active.color,
                    rounded: 1,
                    stroke: { color: 0xabafc6, width: 1 },
                },
                // disabled: { fill: 0xdbdbdb, rounded: 1 },
            },
        })
        if (numericOnly) {
            this.restrict = '0123456789'
        }
        this.maxLength = maxLength
        this.text = text
    }
}
