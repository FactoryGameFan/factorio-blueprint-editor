// import pixi modules first (they will register themselves as extensions)
import 'pixi.js/app'
import 'pixi.js/events'
import 'pixi.js/filters'
import 'pixi.js/sprite-tiling'
import 'pixi.js/text'
import 'pixi.js/graphics'
import 'pixi.js/basis'

import { Application, TextureSource, setBasisTranscoderPath, Assets } from 'pixi.js'
import basisTranscoderJS from './basis/transcoder.1.16.4.js?url'
import basisTranscoderWASM from './basis/transcoder.1.16.4.wasm?url'
import { loadData } from './core/factorioData'
import G, { Logger } from './common/globals'
import { Entity } from './core/Entity'
import { Blueprint, oilOutpostSettings, IOilOutpostSettings } from './core/Blueprint'
import { BlueprintContainer, EditorMode, GridPattern } from './containers/BlueprintContainer'
import { PaintTileContainer } from './containers/PaintTileContainer'
import { UIContainer } from './UI/UIContainer'
import { Dialog } from './UI/controls/Dialog'
import { ActionRegistry, MouseButton } from './actions'
import { IPoint } from './types'

export class Editor {
    public async init(canvas: HTMLCanvasElement, logger?: Logger): Promise<void> {
        setBasisTranscoderPath({ jsUrl: basisTranscoderJS, wasmUrl: basisTranscoderWASM })

        TextureSource.defaultOptions.scaleMode = 'linear'
        TextureSource.defaultOptions.addressMode = 'repeat'

        if (logger) {
            G.logger = logger
        }

        const app = new Application()

        await Promise.all([
            fetch('/data/data.json')
                .then(res => res.text())
                .then(modules => loadData(modules)),
            app.init({
                canvas,
                preference: 'webgpu',
                resolution: window.devicePixelRatio,
                autoDensity: true,
                skipExtensionImports: true,
                roundPixels: true,
                bezierSmoothness: 0.75,
                hello: true,
            }),
            Assets.init(),
        ])

        G.app = app

        G.app.renderer.resize(window.innerWidth, window.innerHeight)
        window.addEventListener(
            'resize',
            () => G.app.renderer.resize(window.innerWidth, window.innerHeight),
            false
        )

        this.initActions()

        G.bp = new Blueprint()
        G.BPC = new BlueprintContainer(G.bp)
        G.app.stage.addChild(G.BPC)

        G.UI = new UIContainer()
        G.app.stage.addChild(G.UI)
        G.UI.showDebuggingLayer = G.debug
    }

    public get moveSpeed(): number {
        return G.BPC.moveSpeed
    }
    public set moveSpeed(speed: number) {
        G.BPC.moveSpeed = speed
    }

    public get gridColor(): number {
        return G.BPC.gridColor
    }
    public set gridColor(color: number) {
        G.BPC.gridColor = color
    }

    public get gridPattern(): GridPattern {
        return G.BPC.gridPattern
    }
    public set gridPattern(pattern: GridPattern) {
        G.BPC.gridPattern = pattern
    }

    /** One entry per slot, undefined where the slot is empty. */
    public get quickbarItems(): (string | undefined)[] {
        return G.UI.quickbarPanel.serialize()
    }
    public set quickbarItems(items: (string | undefined)[]) {
        G.UI.quickbarPanel.generateSlots(items)
    }

    public get limitWireReach(): boolean {
        return G.BPC.limitWireReach
    }
    public set limitWireReach(limit: boolean) {
        G.BPC.limitWireReach = limit
    }

    public get oilOutpostSettings(): IOilOutpostSettings {
        return oilOutpostSettings
    }
    public set oilOutpostSettings(settings: IOilOutpostSettings) {
        for (const key in oilOutpostSettings) {
            if (settings[key]) {
                oilOutpostSettings[key] = settings[key]
            }
        }
    }

    /**
     * The interaction mode the canvas is in, by name - NONE, EDIT, PAINT, PAN,
     * COPY or DELETE. Exposed for tests/editor-mode-input.spec.ts, which is the
     * first spec to drive real pointer and keyboard input (issue #44); the name
     * rather than the enum member so a test does not have to import it.
     */
    public get mode(): string {
        return EditorMode[G.BPC.mode]
    }

    /**
     * Where an entity currently sits in screen coordinates, or undefined if no
     * blueprint is loaded or it holds no such entity.
     *
     * The counterpart to `mode` for issue #44: asserting that hovering an entity
     * enters EDIT first needs a way to put the pointer on one, and the editor
     * only ever mapped screen -> world. Kept here rather than in the spec so the
     * tile -> world pixel convention stays inside the package that owns it.
     *
     * The point returned is the entity's centre, which is always inside one of
     * the tiles it occupies - so it hits the same position grid cell the hover
     * lookup reads, for a 1x1 entity on a half-tile centre as much as for an
     * even-sized one.
     *
     * These are client coordinates, the same space GridData reads pointer
     * events in, so a test can pass them straight to a synthetic pointer move
     * without correcting for the canvas offset.
     */
    public entityScreenPosition(entityNumber: number): IPoint | undefined {
        const entity = G.bp?.entities.get(entityNumber)
        if (entity === undefined) return undefined
        const [x, y] = G.BPC.toScreen(entity.position.x * 32, entity.position.y * 32)
        return { x, y }
    }

    /**
     * Where the entity sits in the **model**, in tiles.
     *
     * Not the same coordinates the blueprint was written with: loading
     * re-centres, so an entity encoded at (1, 1) is somewhere else by the time
     * it is in `G.bp`. A spec that needs to compute a position relative to a
     * loaded entity - rail signal snapping offsets, say - has to ask rather than
     * assume, and finding that out from a failing assertion costs a run.
     */
    public entityPosition(entityNumber: number): IPoint | undefined {
        return G.bp?.entities.get(entityNumber)?.position
    }

    /**
     * Whether the blueprint is drawn where the viewport says it is.
     *
     * See `BlueprintContainer.viewportRenderedInSync` - it is false only between
     * a viewport change and the next frame, and a mistake in
     * `Viewport.getTransform` can make it false permanently while every
     * coordinate the editor reports stays perfectly self-consistent (issue
     * #144).
     */
    /**
     * One step of the measured zoom ladder, for the `zoomIn`/`zoomOut` keybinds.
     *
     * The wheel does not come through here - it moves continuously along the
     * same curve, since quantising every trackpad event to a whole rung is what
     * made scrolling feel chunky (#206). This is the stepped route, and it is
     * the only one that lands on the values the game itself stops on. The game
     * has exactly these two controls, `zoom-in` and `zoom-out`.
     */
    public zoomStep(zoomIn: boolean): void {
        G.BPC.zoom(zoomIn)
    }

    /**
     * The viewport's current continuous scale, which is the zoom level.
     *
     * The editor draws 32 px per tile at scale 1, and so does Factorio at zoom
     * 1 - measured, not assumed (#206). Exposed because the zoom ladder is
     * otherwise invisible from outside: `zoom()` changes nothing a spec can
     * read, since entity positions move with the view rather than against it.
     */
    public get viewportScale(): number {
        return G.BPC.getViewportScale()
    }

    public get viewportRenderedInSync(): boolean {
        return G.BPC.viewportRenderedInSync
    }

    /**
     * Which entity the canvas currently considers hovered, or undefined when
     * none is - which is every mode but EDIT.
     *
     * `mode` alone cannot tell a test that the hover moved from one entity to
     * the next, since both ends of that move report EDIT (issue #44).
     */
    public get hoveredEntityNumber(): number | undefined {
        return G.BPC.hoverContainer?.entity.entityNumber
    }

    /**
     * Whether the paint container is currently drawn, or undefined when there
     * is no paint container at all.
     *
     * The two are worth telling apart: the container is hidden rather than
     * destroyed whenever the pointer leaves the canvas, and `mode` reports
     * PAINT either way (issue #53).
     */
    /** How many tile sprites the canvas is drawing. See tests/tiles.spec.ts. */
    public get tileSpriteCount(): number {
        return G.BPC.tileSpriteCount
    }

    public get paintContainerVisible(): boolean | undefined {
        return G.BPC.paintContainer?.visible
    }

    /**
     * Where the paint container sits, in tiles, and which way it faces.
     *
     * The only way a spec can see rail signal snapping (issue #133 item 2).
     * Nothing else exposes it: `paintContainerVisible` says the container is
     * drawn and `editorMode` says PAINT, but the whole of snapping is *which*
     * position and direction it settled on, and both are otherwise invisible
     * until the entity is placed - by which time a wrong snap and a missed
     * click look identical.
     *
     * Direction is undefined for a paint container that has none, which is
     * every blueprint paste.
     */
    public get paintContainerState():
        | { x: number; y: number; direction: number | undefined }
        | undefined {
        const pc = G.BPC.paintContainer
        if (pc === undefined) return undefined
        return {
            x: pc.x / 32,
            y: pc.y / 32,
            direction: (pc as unknown as { direction?: number }).direction,
        }
    }

    /**
     * Whether the copy cursor box is drawn on the settings-copy source.
     *
     * The one visible consequence of `Entity.canPasteSettings`, and so the only
     * way a spec can tell a pair the editor refuses from one it accepts and
     * writes nothing for. See tests/paste-cross-type-settings.spec.ts.
     */
    public get copyCursorBoxVisible(): boolean {
        return G.BPC.overlayContainer.copyCursorBoxVisible
    }

    /** How many dialogs are open. See tests/chest-editor.spec.ts. */
    public get openDialogCount(): number {
        return G.UI.openDialogCount
    }

    /**
     * Where the topmost open dialog sits in client coordinates, so a spec can
     * click a control drawn inside it. Throws when nothing is open.
     */
    public get topDialogBounds(): { x: number; y: number; width: number; height: number } {
        return G.UI.topDialogBounds
    }

    /**
     * Opens BlueprintInfoEditor, the same as clicking its persistent
     * top-left button - which sits at a fixed screen position a spec could
     * click directly, but this avoids hardcoding that position in a second
     * place. See tests/blueprint-grid-position.spec.ts.
     */
    public openBlueprintInfoEditor(): void {
        G.UI.toggleBlueprintInfoEditor(G.bp)
    }

    public get debug(): boolean {
        return G.debug
    }
    public set debug(debug: boolean) {
        G.debug = debug
        G.UI.showDebuggingLayer = debug
        if (G.bp) {
            G.bp.history.logging = debug
        }
    }

    public getPicture(): Promise<Blob> {
        return G.BPC.getPicture()
    }

    public haveBlueprint(): boolean {
        return !G.bp.isEmpty()
    }

    public async appendBlueprint(bp: Blueprint): Promise<void> {
        const result = bp.entities.valuesArray().map(e => new Entity(e.rawEntity, G.BPC.bp))

        G.BPC.spawnPaintContainer(result, 0)
    }

    public async loadBlueprint(bp: Blueprint): Promise<void> {
        const last = G.BPC
        let i: number
        try {
            i = G.app.stage.getChildIndex(last)
        } catch {
            i = G.app.stage.children.length
        }

        G.bp = bp

        G.BPC = new BlueprintContainer(bp)
        G.BPC.initBP()
        Dialog.closeAll()
        G.app.stage.addChildAt(G.BPC, i)
        if (last.parent) {
            last.destroy()
        }
    }

    private initActions(): void {
        G.actions = new ActionRegistry({
            // NONE -> PAN
            pan: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.panStart(),
                    onRelease: () => G.BPC.panEnd(),
                },
            },
            // PAINT
            build: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.buildStart(),
                    onRelease: () => G.BPC.buildEnd(),
                },
            },
            // PAINT | EDIT
            mine: {
                trigger: {
                    button: MouseButton.Right,
                },
                callbacks: {
                    onPress: () => G.BPC.mineStart(),
                    onRelease: () => G.BPC.mineEnd(),
                },
            },
            // EDIT
            openEntityGUI: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.openEditor(),
                },
            },
            // EDIT
            copyEntitySettings: {
                trigger: {
                    button: MouseButton.Right,
                },
                modifiers: {
                    shift: true,
                },
                callbacks: {
                    onPress: () => G.BPC.copyEntitySettings(),
                },
            },
            // EDIT
            pasteEntitySettings: {
                trigger: {
                    button: MouseButton.Left,
                },
                modifiers: {
                    shift: true,
                },
                callbacks: {
                    onPress: () => G.BPC.pasteEntitySettingsStart(),
                    onRelease: () => G.BPC.pasteEntitySettingsEnd(),
                },
                modifierCallbacks: {
                    onPress: () => G.BPC.pasteEntitySettingsModifiersStart(),
                    onRelease: () => G.BPC.pasteEntitySettingsModifiersEnd(),
                },
            },
            // any -> COPY
            copySelection: {
                trigger: {
                    button: MouseButton.Left,
                },
                modifiers: {
                    control: true,
                },
                callbacks: {
                    onPress: () => G.BPC.enterCopyMode(),
                    onRelease: () => G.BPC.exitCopyMode(),
                },
            },
            // any -> DELETE
            deleteSelection: {
                trigger: {
                    button: MouseButton.Right,
                },
                modifiers: {
                    control: true,
                },
                callbacks: {
                    onPress: () => G.BPC.enterDeleteMode(),
                    onRelease: () => G.BPC.exitDeleteMode(),
                },
            },

            moveUp: {
                trigger: {
                    code: 'KeyW',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('up'),
                    onRelease: () => G.BPC.moveEnd('up'),
                },
            },
            moveLeft: {
                trigger: {
                    code: 'KeyA',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('left'),
                    onRelease: () => G.BPC.moveEnd('left'),
                },
            },
            moveDown: {
                trigger: {
                    code: 'KeyS',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('down'),
                    onRelease: () => G.BPC.moveEnd('down'),
                },
            },
            moveRight: {
                trigger: {
                    code: 'KeyD',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('right'),
                    onRelease: () => G.BPC.moveEnd('right'),
                },
            },
            showInfo: {
                trigger: {
                    code: 'AltLeft',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.overlayContainer.toggleEntityInfoVisibility()
                        return true
                    },
                },
            },
            closeWindow: {
                trigger: {
                    code: 'Escape',
                },
                callbacks: {
                    onPress: () => {
                        Dialog.closeLast()
                        return true
                    },
                },
            },
            inventory: {
                trigger: {
                    code: 'KeyE',
                },
                callbacks: {
                    onPress: () => {
                        // If there is a dialog open, assume user wants to close it
                        if (Dialog.anyOpen()) {
                            Dialog.closeLast()
                        } else {
                            G.UI.createInventory(
                                'Inventory',
                                undefined,
                                G.BPC.spawnPaintContainer.bind(G.BPC)
                            )
                        }
                        return true
                    },
                },
            },
            focus: {
                trigger: {
                    code: 'KeyF',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.centerViewport()
                        return true
                    },
                },
            },
            rotate: {
                trigger: {
                    code: 'KeyR',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.rotate(false)
                        return true
                    },
                },
            },
            reverseRotate: {
                trigger: {
                    code: 'KeyR',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.rotate(true)
                        return true
                    },
                },
            },
            flipHorizontal: {
                trigger: {
                    code: 'KeyF',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.flip(false)
                        return true
                    },
                },
            },
            flipVertical: {
                trigger: {
                    code: 'KeyG',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.flip(true)
                        return true
                    },
                },
            },
            pipette: {
                trigger: {
                    code: 'KeyQ',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.pipette()
                        return true
                    },
                },
            },
            increaseTileBuildingArea: {
                trigger: {
                    code: 'BracketRight',
                },
                callbacks: {
                    onPress: () => {
                        if (G.BPC.paintContainer instanceof PaintTileContainer) {
                            G.BPC.paintContainer.increaseSize()
                        }
                        return true
                    },
                },
            },
            decreaseTileBuildingArea: {
                trigger: {
                    code: 'BracketLeft',
                },
                callbacks: {
                    onPress: () => {
                        if (G.BPC.paintContainer instanceof PaintTileContainer) {
                            G.BPC.paintContainer.decreaseSize()
                        }
                        return true
                    },
                },
            },
            undo: {
                trigger: {
                    code: 'KeyZ',
                },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        G.bp.history.undo()
                        return true
                    },
                },
            },
            redo: {
                trigger: {
                    code: 'KeyY',
                },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        G.bp.history.redo()
                        return true
                    },
                },
            },
            moveEntityUp: {
                trigger: {
                    code: 'ArrowUp',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 0, y: -1 })
                        return true
                    },
                },
            },
            moveEntityLeft: {
                trigger: {
                    code: 'ArrowLeft',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: -1, y: 0 })
                        return true
                    },
                },
            },
            moveEntityDown: {
                trigger: {
                    code: 'ArrowDown',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 0, y: 1 })
                        return true
                    },
                },
            },
            moveEntityRight: {
                trigger: {
                    code: 'ArrowRight',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 1, y: 0 })
                        return true
                    },
                },
            },
            quickbar1: {
                trigger: { code: 'Digit1' },
                callbacks: { onPress: () => bindKeyToSlot(0) },
            },
            quickbar2: {
                trigger: { code: 'Digit2' },
                callbacks: { onPress: () => bindKeyToSlot(1) },
            },
            quickbar3: {
                trigger: { code: 'Digit3' },
                callbacks: { onPress: () => bindKeyToSlot(2) },
            },
            quickbar4: {
                trigger: { code: 'Digit4' },
                callbacks: { onPress: () => bindKeyToSlot(3) },
            },
            quickbar5: {
                trigger: { code: 'Digit5' },
                callbacks: { onPress: () => bindKeyToSlot(4) },
            },
            quickbar6: {
                trigger: { code: 'Digit1' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(5) },
            },
            quickbar7: {
                trigger: { code: 'Digit2' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(6) },
            },
            quickbar8: {
                trigger: { code: 'Digit3' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(7) },
            },
            quickbar9: {
                trigger: { code: 'Digit4' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(8) },
            },
            quickbar10: {
                trigger: { code: 'Digit5' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(9) },
            },
            changeActiveQuickbar: {
                trigger: { code: 'KeyX' },
                callbacks: {
                    onPress: () => {
                        G.UI.quickbarPanel.changeActiveQuickbar()
                        return true
                    },
                },
            },
        })

        const bindKeyToSlot = (slot: number): boolean => {
            G.UI.quickbarPanel.bindKeyToSlot(slot)
            return true
        }

        const pointerup = (e: PointerEvent): void => {
            G.actions.releaseButton(e)
        }

        window.addEventListener('pointerup', pointerup)

        const keydown = (e: KeyboardEvent): void => {
            if (e.repeat) return
            if (e.target instanceof HTMLInputElement) return
            if (e.target instanceof HTMLTextAreaElement) return
            G.actions.pressKey(e)
        }

        const keyup = (e: KeyboardEvent): void => {
            if (e.target instanceof HTMLInputElement) return
            if (e.target instanceof HTMLTextAreaElement) return
            G.actions.releaseKey(e)
        }

        const releaseAll = (): void => {
            G.actions.releaseAll()
        }

        window.addEventListener('keydown', keydown)
        window.addEventListener('keyup', keyup)
        window.addEventListener('blur', releaseAll)
    }
}
