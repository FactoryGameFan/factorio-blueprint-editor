import {
    TilingSprite,
    Rectangle,
    Container,
    Graphics,
    RenderTexture,
    EventBoundary,
    FederatedPointerEvent,
    Ticker,
    isMobile,
} from 'pixi.js'
import FD from '../core/factorioData'
import G from '../common/globals'
import { Tile } from '../core/Tile'
import { Entity } from '../core/Entity'
import { Blueprint } from '../core/Blueprint'
import { IConnection } from '../core/WireConnections'
import { stepZoom, WheelAccumulator } from '../core/zoomLevels'
import { IPoint } from '../types'
import { Dialog } from '../UI/controls/Dialog'
import { Viewport } from './Viewport'
import { EntitySprite } from './EntitySprite'
import { WiresContainer } from './WiresContainer'
import { UnderlayContainer } from './UnderlayContainer'
import { EntityContainer } from './EntityContainer'
import { OverlayContainer } from './OverlayContainer'
import { PaintEntityContainer } from './PaintEntityContainer'
import { TileContainer } from './TileContainer'
import { PaintTileContainer } from './PaintTileContainer'
import { PaintWireContainer } from './PaintWireContainer'
import { Axis, IllegalFlipError, PaintContainer } from './PaintContainer'
import { PaintBlueprintContainer } from './PaintBlueprintContainer'
import { GridData } from './GridData'
import { WiresPanel } from '../UI/WiresPanel'

export enum GridPattern {
    CHECKER = 'checker',
    GRID = 'grid',
}

type MoveDirections = {
    up: boolean
    left: boolean
    down: boolean
    right: boolean
}

export enum EditorMode {
    /** Default */
    NONE,
    /** Active when an entity is being hovered */
    EDIT,
    /** Active when "painting" */
    PAINT,
    /** Active when panning */
    PAN,
    /** Active when selecting multiple entities for copy/stamp */
    COPY,
    /** Active when selecting multiple entities for deletion */
    DELETE,
}

export class BlueprintContainer extends Container {
    private static _moveSpeed = 10
    private static _gridColor = 0x303030
    private static _gridPattern = GridPattern.GRID
    private static _limitWireReach = true

    /** Nr of cunks */
    private readonly chunks = 32
    /** Chunk offset - from 0,0 - Measured in tiles */
    private readonly chunkOffset = 16
    private readonly size: IPoint = {
        x: this.chunks * 32 * 32,
        y: this.chunks * 32 * 32,
    }
    private readonly anchor: IPoint = {
        x: 0.5,
        y: 0.5,
    }
    private readonly viewport: Viewport = new Viewport(
        this.size,
        {
            x: G.app.screen.width,
            y: G.app.screen.height,
        },
        this.anchor
    )

    private _mode: EditorMode = EditorMode.NONE
    public readonly bp: Blueprint
    public readonly gridData: GridData

    // Children
    private grid: TilingSprite
    private readonly chunkGrid: TilingSprite
    private readonly tileSprites: Container<EntitySprite>
    private readonly tilePaintSlot: Container<PaintTileContainer>
    public readonly underlayContainer: UnderlayContainer
    private readonly entitySprites: Container<EntitySprite>
    public readonly wiresContainer: WiresContainer
    public readonly overlayContainer: OverlayContainer
    private readonly entityPaintSlot: Container<PaintEntityContainer | PaintBlueprintContainer>
    private readonly wirePaintSlot: Container<PaintWireContainer>

    /*
        Both are genuinely absent most of the time - `hoverContainer` only while
        the pointer is over an entity, `paintContainer` only while something is
        being placed - and both are assigned undefined to clear them. Editor.ts
        and OverlayContainer already read them with `?.` and `!== undefined`,
        which is the shape agreeing with itself.

        Everything else reads them having first checked `mode`, and a mode of
        EDIT or PAINT is exactly the statement that the matching one exists.
        TypeScript cannot connect an enum to a field's definedness, so the
        invariant gets a named reader below rather than 35 local guards for a
        case none of them can actually reach.
    */
    public hoverContainer: EntityContainer | undefined
    public paintContainer: PaintContainer | undefined

    /**
     * The hovered entity's container, which EDIT mode guarantees.
     *
     * Throws rather than hand back an undefined that would be dereferenced one
     * line later with nothing but "of undefined" to say - the same signal
     * `PositionGrid.entityAt()` and `EntityContainer.containerOf()` give when
     * their own invariant has drifted. Reading it outside EDIT is a bug in the
     * caller, not a state to handle.
     */
    public get hovered(): EntityContainer {
        if (this.hoverContainer === undefined) {
            throw new Error('hoverContainer read while nothing is hovered')
        }
        return this.hoverContainer
    }

    /** The container being placed, which PAINT mode guarantees. @see hovered */
    public get painting(): PaintContainer {
        if (this.paintContainer === undefined) {
            throw new Error('paintContainer read while not in PAINT mode')
        }
        return this.paintContainer
    }

    /*
        The entity a settings copy was taken from, absent until one is taken.
        `pasteEntitySettings` below already tests it for truthiness and
        OverlayContainer already tests it for `!== undefined`, so every reader
        was written for the undefined the declaration denied.
    */
    private _entityForCopyData: Entity | undefined
    private copyModeEntities: Entity[] = []
    private deleteModeEntities: Entity[] = []
    /*
        Registered on gridData while COPY/DELETE mode is held and removed on the
        way out, so they exist only for that span. Cleared on exit as well as
        removed, which the listener alone did not do - each closure captures the
        drag's start position and its entity list, and held one of each alive
        until the next drag replaced it.
    */
    private copyModeUpdateFn: ((endX: number, endY: number) => void) | undefined
    private deleteModeUpdateFn: ((endX: number, endY: number) => void) | undefined
    private copySettingsActive = false

    // PIXI properties
    public readonly eventMode = 'static'
    public readonly interactiveChildren = false
    public readonly hitArea = new Rectangle(
        -this.size.x * this.anchor.x,
        -this.size.y * this.anchor.y,
        this.size.x,
        this.size.y
    )
    panStart: () => boolean
    panEnd: () => void
    moveStart: (dir: keyof MoveDirections) => boolean
    moveEnd: (dir: keyof MoveDirections) => void
    buildStart: () => boolean
    buildEnd: () => void
    openEditor: () => boolean
    mineStart: () => boolean
    mineEnd: () => void
    pasteEntitySettingsStart: () => boolean
    pasteEntitySettingsEnd: () => void
    pasteEntitySettingsModifiersStart: () => boolean
    pasteEntitySettingsModifiersEnd: () => void

    public constructor(bp: Blueprint) {
        super()

        this.enableRenderGroup()

        this.bp = bp
        this.gridData = new GridData(this)

        this.grid = this.generateGrid()
        this.chunkGrid = this.generateChunkGrid(this.chunkOffset)
        this.tileSprites = new Container()
        this.tilePaintSlot = new Container()
        this.underlayContainer = new UnderlayContainer()
        this.entitySprites = new Container()
        this.wiresContainer = new WiresContainer(this.bp)
        this.overlayContainer = new OverlayContainer(this)
        this.entityPaintSlot = new Container()
        this.wirePaintSlot = new Container()

        this.tileSprites.enableRenderGroup()
        this.entitySprites.enableRenderGroup()

        this.addChild(
            this.grid,
            this.chunkGrid,
            this.tileSprites,
            this.tilePaintSlot,
            this.underlayContainer,
            this.entitySprites,
            this.wiresContainer,
            this.overlayContainer,
            this.entityPaintSlot,
            this.wirePaintSlot
        )

        const update = () => {
            if (this.viewport.update()) {
                this.gridData.recalculate()
                const t = this.viewport.getTransform()
                this.position.set(t.tx, t.ty)
                this.scale.set(t.a, t.d)
            }
        }
        G.app.ticker.add(update)
        this.on('destroyed', () => {
            G.app.ticker.remove(update)
        })

        this.on('pointerover', () => {
            if (this.mode === EditorMode.PAINT) {
                this.painting.show()
            }
            this.updateHoverContainer()
        })
        this.on('pointerout', () => {
            if (this.mode === EditorMode.PAINT) {
                this.painting.hide()
            }
            this.updateHoverContainer()
        })

        const onUpdate32 = (): void => {
            // Instead of decreasing the global interactionFrequency, call the over and out entity events here
            this.updateHoverContainer()
        }

        this.gridData.on('update32', onUpdate32)

        this.on('destroyed', () => {
            this.gridData.off('update32', onUpdate32)
            this.gridData.destroy()
        })

        {
            const onResize = (): void => {
                this.viewport.setSize(G.app.screen.width, G.app.screen.height)
            }

            window.addEventListener('resize', onResize, false)
            this.on('destroyed', () => {
                window.removeEventListener('resize', onResize, false)
            })
        }

        const panModule = {
            _onPan: (e: FederatedPointerEvent): void => {
                this.viewport.translateBy(e.movement.x, e.movement.y)
            },
            panStart: (): boolean => {
                if (this.mode === EditorMode.NONE) {
                    this.cursor = 'move'
                    this.setMode(EditorMode.PAN)
                    this.on('globalpointermove', panModule._onPan)
                    return true
                }
                return false
            },
            panEnd: (): void => {
                if (this.mode === EditorMode.PAN) {
                    this.off('globalpointermove', panModule._onPan)
                    this.setMode(EditorMode.NONE)
                    // pixi's setCursor does `mode || (mode = 'default')`, so this is
                    // the same reset-to-default the `null` here used to mean.
                    this.cursor = undefined
                }
            },
        }
        this.panStart = panModule.panStart
        this.panEnd = panModule.panEnd

        const moveTracker = {
            directions: {
                up: false,
                left: false,
                down: false,
                right: false,
            },
            start: (dir: keyof MoveDirections): boolean => {
                moveTracker.directions[dir] = true
                return true
            },
            end: (dir: keyof MoveDirections): void => {
                moveTracker.directions[dir] = false
            },
        }
        this.moveStart = moveTracker.start
        this.moveEnd = moveTracker.end

        {
            const panCb = (ticker: Ticker): void => {
                if (this.mode !== EditorMode.PAN) {
                    const WSXOR = moveTracker.directions.up !== moveTracker.directions.down
                    const ADXOR = moveTracker.directions.left !== moveTracker.directions.right
                    if (WSXOR || ADXOR) {
                        const mult = ticker.elapsedMS / 16.66
                        const finalSpeed = (this.moveSpeed / (WSXOR && ADXOR ? 1.4142 : 1)) * mult
                        this.viewport.translateBy(
                            (ADXOR ? (moveTracker.directions.left ? 1 : -1) : 0) * finalSpeed,
                            (WSXOR ? (moveTracker.directions.up ? 1 : -1) : 0) * finalSpeed
                        )
                    }
                }
            }

            G.app.ticker.add(panCb)
            this.on('destroyed', () => {
                G.app.ticker.remove(panCb)
            })
        }

        // Tri-state: undefined until the first drag decides whether to lock an axis.
        let constraint: boolean | undefined
        const build = (_x: number, _y: number, dx: number, dy: number): void => {
            if (constraint === undefined) {
                const cX = Math.abs(Math.sign(dx))
                const cY = Math.abs(Math.sign(dy))
                if (cX !== cY) {
                    constraint = true
                    if (cX === 1) {
                        this.painting.setPosConstraint(Axis.X)
                    } else {
                        this.painting.setPosConstraint(Axis.Y)
                    }
                }
            }
            this.painting.placeEntityContainer()
        }

        let draggingCreateMode = false
        this.buildStart = (): boolean => {
            if (this.mode !== EditorMode.PAINT) return false

            draggingCreateMode = true

            this.painting.placeEntityContainer()

            this.gridData.on('update32', build)

            return true
        }
        this.buildEnd = (): void => {
            if (!draggingCreateMode) return

            draggingCreateMode = false

            constraint = undefined
            this.painting.setPosConstraint(undefined)

            this.gridData.off('update32', build)
        }

        this.openEditor = (): boolean => {
            if (this.mode === EditorMode.EDIT) {
                if (G.debug) {
                    console.log(this.hovered.entity.serialize())
                }

                Dialog.closeAll()
                G.UI.createEditor(this.hovered.entity)
                return true
            }
            return false
        }

        let remove = false
        this.mineStart = (): boolean => {
            remove = true
            this.gridData.on('update32', mine)
            mine()
            return true
        }
        const mine = (): void => {
            if (remove) {
                if (this.mode === EditorMode.EDIT) {
                    this.bp.removeEntity(this.hovered.entity)
                }
                if (this.mode === EditorMode.PAINT) {
                    this.painting.removeContainerUnder()
                }
            }
        }
        this.mineEnd = (): void => {
            remove = false
            this.gridData.off('update32', mine)
        }

        this.pasteEntitySettingsStart = (): boolean => {
            const isValid = this.pasteEntitySettings()
            if (isValid) this.gridData.on('update32', this.pasteEntitySettings)
            return isValid
        }
        this.pasteEntitySettingsEnd = (): void => {
            this.gridData.off('update32', this.pasteEntitySettings)
        }
        this.pasteEntitySettingsModifiersStart = (): boolean => {
            this.copySettingsActive = true
            this.updateCopyCursorBox()
            return true
        }
        this.pasteEntitySettingsModifiersEnd = (): void => {
            this.copySettingsActive = false
            this.updateCopyCursorBox()
        }

        /*
            One accumulator for the life of the container, because the whole
            point of it is the remainder it carries between events (#206
            defect 2). The handler used to read only `Math.sign(e.deltaY)`, so a
            trackpad emitting a burst of small pixel deltas and a mouse emitting
            one notch produced the same fixed jump - the likeliest single cause
            of the original complaint that scrolling does not feel like the game.
        */
        const wheel = new WheelAccumulator()
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault()
            e.stopPropagation()

            const rungs = wheel.feed(e.deltaY, e.deltaMode)
            for (let i = 0; i < Math.abs(rungs); i++) this.zoom(rungs > 0)
        }

        this.addEventListener('wheel', onWheel, { passive: false })
        this.on('destroyed', () => {
            this.removeEventListener('wheel', onWheel)
        })

        if (isMobile.any) {
            const prevTouches: Map<number, { x: number; y: number }> = new Map()
            let lastPinchDist = 0
            let lastPinchCenter = { x: 0, y: 0 }

            const onTouchStart = (e: TouchEvent): void => {
                e.preventDefault()
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i]
                    prevTouches.set(t.identifier, { x: t.clientX, y: t.clientY })
                }
                if (prevTouches.size === 2) {
                    const pts = [...prevTouches.values()]
                    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
                    lastPinchCenter = {
                        x: (pts[0].x + pts[1].x) / 2,
                        y: (pts[0].y + pts[1].y) / 2,
                    }
                }
            }

            const onTouchMove = (e: TouchEvent): void => {
                e.preventDefault()

                if (prevTouches.size === 1 && e.touches.length === 1) {
                    // Single finger pan
                    const t = e.touches[0]
                    const prev = prevTouches.get(t.identifier)
                    if (prev) {
                        this.viewport.translateBy(t.clientX - prev.x, t.clientY - prev.y)
                    }
                    prevTouches.set(t.identifier, { x: t.clientX, y: t.clientY })
                } else if (e.touches.length === 2) {
                    // Pinch to zoom + two-finger pan
                    const t0 = e.touches[0]
                    const t1 = e.touches[1]
                    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
                    const center = {
                        x: (t0.clientX + t1.clientX) / 2,
                        y: (t0.clientY + t1.clientY) / 2,
                    }

                    if (lastPinchDist > 0) {
                        const scaleDelta = (dist - lastPinchDist) / lastPinchDist
                        this.viewport.setScaleCenter(center.x, center.y)
                        this.viewport.zoomBy(scaleDelta)
                        this.viewport.translateBy(
                            center.x - lastPinchCenter.x,
                            center.y - lastPinchCenter.y
                        )
                    }

                    lastPinchDist = dist
                    lastPinchCenter = center
                    prevTouches.set(t0.identifier, { x: t0.clientX, y: t0.clientY })
                    prevTouches.set(t1.identifier, { x: t1.clientX, y: t1.clientY })
                }
            }

            const onTouchEnd = (e: TouchEvent): void => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    prevTouches.delete(e.changedTouches[i].identifier)
                }
                lastPinchDist = 0
            }

            const canvas = G.app.canvas
            canvas.addEventListener('touchstart', onTouchStart, { passive: false })
            canvas.addEventListener('touchmove', onTouchMove, { passive: false })
            canvas.addEventListener('touchend', onTouchEnd)
            canvas.addEventListener('touchcancel', onTouchEnd)
            this.on('destroyed', () => {
                canvas.removeEventListener('touchstart', onTouchStart)
                canvas.removeEventListener('touchmove', onTouchMove)
                canvas.removeEventListener('touchend', onTouchEnd)
                canvas.removeEventListener('touchcancel', onTouchEnd)
            })
        }

        // pointerdown delivers a Pixi FederatedPointerEvent; pressButton wants
        // the underlying DOM PointerEvent. Bind the handler once so that the
        // destroy-time removeEventListener actually matches (a fresh .bind()
        // would create a new function that never removes the added listener).
        const onPointerDown = (e: FederatedPointerEvent): void =>
            G.actions.pressButton(e.nativeEvent as PointerEvent)
        this.addEventListener('pointerdown', onPointerDown)
        this.on('destroyed', () => {
            this.removeEventListener('pointerdown', onPointerDown)
            G.actions.releaseAll()
        })
    }

    public get entityForCopyData(): Entity | undefined {
        return this._entityForCopyData
    }

    public copyEntitySettings(): boolean {
        if (this.mode === EditorMode.EDIT) {
            // Store reference to source entity
            this._entityForCopyData = this.hovered.entity
            this.updateCopyCursorBox()
            return true
        }
        return false
    }

    /*
        Arrow property: registered on gridData for the duration of a paste drag
        and removed again, so it needs one identity across the on/off pair.
    */
    public readonly pasteEntitySettings = (): boolean => {
        if (this._entityForCopyData && this.mode === EditorMode.EDIT) {
            // Hand over reference of source entity to target entity for pasting data
            this.hovered.entity.pasteSettings(this._entityForCopyData)
            return true
        }
        return false
    }

    public getViewportScale(): number {
        return this.viewport.getCurrentScale()
    }

    /**
     * Whether what is drawn matches the viewport that decides where things are.
     *
     * These two can only ever disagree for the moment between a viewport change
     * and the next render frame, because `update()` writes this container's
     * position and scale and does so **only when it was dirty**. That gate is
     * the reason `Viewport.getTransform` rebuilds the matrix without clearing
     * the flag (issue #144): clearing it there answers a fresh transform to the
     * caller and then skips this write, so the model is centred and the pixels
     * are not.
     *
     * Exists because nothing else can see that. `toScreen` and `toWorld` both
     * read the transform, so they would agree with each other and with every
     * hover while the blueprint was drawn somewhere else entirely - only a
     * screenshot would show it. Used by
     * `tests/viewport-transform-freshness.spec.ts`.
     */
    public get viewportRenderedInSync(): boolean {
        const t = this.viewport.getTransform()
        return this.x === t.tx && this.y === t.ty && this.scale.x === t.a && this.scale.y === t.d
    }

    /** screen to world */
    public toWorld(x: number, y: number): [number, number] {
        const t = this.viewport.getTransform()
        return [(x - t.tx) / t.a, (y - t.ty) / t.d]
    }

    /**
     * world to screen, the exact inverse of toWorld.
     *
     * Only tests use this so far - it is what lets a spec put the pointer on a
     * chosen entity, which every EDIT mode transition needs (issue #44). The
     * pair is kept adjacent deliberately: a change to the viewport transform
     * that updates one and not the other is a silent break, since nothing in
     * the app itself round-trips them.
     */
    public toScreen(x: number, y: number): [number, number] {
        const t = this.viewport.getTransform()
        return [x * t.a + t.tx, y * t.d + t.ty]
    }

    public get mode(): EditorMode {
        return this._mode
    }

    private setMode(mode: EditorMode): void {
        this._mode = mode
        this.emit('mode', mode)
    }

    public rotate(ccw: boolean): void {
        if (this.mode === EditorMode.EDIT) {
            this.hovered.entity.rotate(ccw, true)
        } else if (this.mode === EditorMode.PAINT) {
            if (this.painting.canFlipOrRotateByCopying()) {
                const copies = this.painting.rotatedEntities(ccw)
                this.painting.destroy()
                this.spawnPaintContainer(copies, 0)
            } else {
                this.painting.rotate(ccw)
            }
        }
    }

    public flip(vertical: boolean): void {
        if (this.mode === EditorMode.PAINT && this.painting.canFlipOrRotateByCopying()) {
            try {
                const copies = this.painting.flippedEntities(vertical)
                this.painting.destroy()
                this.spawnPaintContainer(copies, 0)
            } catch (e) {
                if (e instanceof IllegalFlipError) {
                    G.logger({ text: e.message, type: 'warning' })
                } else {
                    throw e
                }
            }
        }
    }

    public pipette(): void {
        if (this.mode === EditorMode.EDIT) {
            const entity = this.hovered.entity
            const itemName = Entity.getItemName(entity.name)
            if (itemName !== undefined) {
                const direction =
                    entity.directionType === 'output'
                        ? (entity.direction + 8) % 16
                        : entity.direction
                this.spawnPaintContainer(itemName, direction)
            }
        } else if (this.mode === EditorMode.PAINT) {
            this.painting.destroy()
        }
        this.exitCopyMode(true)
        this.exitDeleteMode(true)
    }

    public moveEntity(offset: IPoint) {
        if (this.mode === EditorMode.EDIT) {
            this.hovered.entity.moveBy(offset)
        }
    }

    public enterCopyMode(): boolean {
        if (this.mode === EditorMode.COPY) return false
        if (this.mode === EditorMode.PAINT) this.painting.destroy()

        this.updateHoverContainer(true)
        this.setMode(EditorMode.COPY)

        this.overlayContainer.showSelectionArea(0x00d400)

        const startPos = { x: this.gridData.x32, y: this.gridData.y32 }
        this.copyModeUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x) + 1
            const H = Math.abs(endY - startPos.y) + 1

            for (const e of this.copyModeEntities) {
                EntityContainer.containerOf(e.entityNumber).cursorBox = undefined
            }

            this.copyModeEntities = this.bp.entityPositionGrid.getEntitiesInArea({
                x: X + W / 2,
                y: Y + H / 2,
                w: W,
                h: H,
            })

            for (const e of this.copyModeEntities) {
                EntityContainer.containerOf(e.entityNumber).cursorBox = 'copy'
            }
        }
        this.copyModeUpdateFn(startPos.x, startPos.y)
        this.gridData.on('update32', this.copyModeUpdateFn, this)

        return true
    }

    public exitCopyMode(cancel = false): void {
        if (this.mode !== EditorMode.COPY) return

        this.overlayContainer.hideSelectionArea()
        if (this.copyModeUpdateFn !== undefined) {
            this.gridData.off('update32', this.copyModeUpdateFn, this)
            this.copyModeUpdateFn = undefined
        }

        this.setMode(EditorMode.NONE)
        this.updateHoverContainer()

        if (!cancel && this.copyModeEntities.length !== 0) {
            this.spawnPaintContainer(this.copyModeEntities)
        }
        for (const e of this.copyModeEntities) {
            EntityContainer.containerOf(e.entityNumber).cursorBox = undefined
        }
        this.copyModeEntities = []
    }

    public enterDeleteMode(): boolean {
        if (this.mode === EditorMode.DELETE) return false
        if (this.mode === EditorMode.PAINT) this.painting.destroy()

        this.updateHoverContainer(true)
        this.setMode(EditorMode.DELETE)

        this.overlayContainer.showSelectionArea(0xff3200)

        const startPos = { x: this.gridData.x32, y: this.gridData.y32 }
        this.deleteModeUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x) + 1
            const H = Math.abs(endY - startPos.y) + 1

            for (const e of this.deleteModeEntities) {
                EntityContainer.containerOf(e.entityNumber).cursorBox = undefined
            }

            this.deleteModeEntities = this.bp.entityPositionGrid.getEntitiesInArea({
                x: X + W / 2,
                y: Y + H / 2,
                w: W,
                h: H,
            })

            for (const e of this.deleteModeEntities) {
                EntityContainer.containerOf(e.entityNumber).cursorBox = 'not_allowed'
            }
        }
        this.deleteModeUpdateFn(startPos.x, startPos.y)
        this.gridData.on('update32', this.deleteModeUpdateFn, this)

        return true
    }

    public exitDeleteMode(cancel = false): void {
        if (this.mode !== EditorMode.DELETE) return

        this.overlayContainer.hideSelectionArea()
        if (this.deleteModeUpdateFn !== undefined) {
            this.gridData.off('update32', this.deleteModeUpdateFn, this)
            this.deleteModeUpdateFn = undefined
        }

        this.setMode(EditorMode.NONE)
        this.updateHoverContainer()

        if (cancel) {
            for (const e of this.deleteModeEntities) {
                EntityContainer.containerOf(e.entityNumber).cursorBox = undefined
            }
        } else {
            this.bp.removeEntities(this.deleteModeEntities)
        }

        this.deleteModeEntities = []
    }

    /**
     * One notch of the measured zoom ladder (#206).
     *
     * The old flat `zoomFactor = 0.1` fed `zoomBy`, whose effective multiplier
     * is `1 + delta` - so zooming in was x1.1 and out x0.9, and those are not
     * inverses: one notch each way left the view 1% further out than it started,
     * with nothing to snap back to.
     *
     * The next scale is read **before** the scale centre is moved, so the rung
     * is computed from the scale actually in effect.
     */
    public zoom(zoomIn = true): void {
        const next = stepZoom(this.viewport.getCurrentScale(), zoomIn ? 1 : -1)
        this.viewport.setScaleCenter(this.gridData.x, this.gridData.y)
        this.viewport.setCurrentScale(next)
    }

    private get isPointerInside(): boolean {
        const boundary = new EventBoundary(G.app.stage)
        const container = boundary.hitTest(this.gridData.x, this.gridData.y)
        return container === this
    }

    private updateHoverContainer(forceRemove = false): void {
        const removeHoverContainer = (): void => {
            this.hovered.pointerOutEventHandler()
            this.hoverContainer = undefined
            this.setMode(EditorMode.NONE)
            this.cursor = 'inherit'
            this.updateCopyCursorBox()
        }

        if (forceRemove || !this.isPointerInside) {
            if (this.hoverContainer) {
                removeHoverContainer()
            }
            return
        }

        if (!this.bp) return

        const entity = this.bp.entityPositionGrid.getEntityAtPosition({
            x: this.gridData.x32,
            y: this.gridData.y32,
        })
        const eC = entity ? EntityContainer.mappings.get(entity.entityNumber) : undefined

        if (eC && this.hoverContainer === eC) return

        if (this.mode === EditorMode.EDIT) {
            removeHoverContainer()
        }

        if (eC && this.mode === EditorMode.NONE) {
            this.hoverContainer = eC
            this.setMode(EditorMode.EDIT)
            this.cursor = 'pointer'
            eC.pointerOverEventHandler()
            this.updateCopyCursorBox()
        }
    }

    private updateCopyCursorBox(): void {
        this.overlayContainer.updateCopyCursorBox(!this.copySettingsActive)
    }

    public get moveSpeed(): number {
        return BlueprintContainer._moveSpeed
    }

    public set moveSpeed(speed: number) {
        BlueprintContainer._moveSpeed = speed
    }

    public get gridColor(): number {
        return BlueprintContainer._gridColor
    }

    public set gridColor(color: number) {
        BlueprintContainer._gridColor = color
        this.grid.tint = color
    }

    public get gridPattern(): GridPattern {
        return BlueprintContainer._gridPattern
    }

    public set gridPattern(pattern: GridPattern) {
        BlueprintContainer._gridPattern = pattern

        const index = this.getChildIndex(this.grid)
        const old = this.grid
        this.grid = this.generateGrid()
        this.addChildAt(this.grid, index)
        old.destroy()
    }

    public get limitWireReach(): boolean {
        return BlueprintContainer._limitWireReach
    }

    public set limitWireReach(limit: boolean) {
        BlueprintContainer._limitWireReach = limit
    }

    private generateGrid(pattern = this.gridPattern): TilingSprite {
        const gridGraphics =
            pattern === 'checker'
                ? new Graphics()
                      .rect(0, 0, 32, 32)
                      .rect(32, 32, 32, 32)
                      .fill(0x808080)
                      .rect(0, 32, 32, 32)
                      .rect(32, 0, 32, 32)
                      .fill(0xffffff)
                : new Graphics().rect(0, 0, 32, 32).fill(0x808080).rect(1, 1, 31, 31).fill(0xffffff)

        const renderTexture = RenderTexture.create({
            width: gridGraphics.width,
            height: gridGraphics.height,
            autoGenerateMipmaps: true,
        })

        G.app.renderer.render({ container: gridGraphics, target: renderTexture })
        renderTexture.source.updateMipmaps()

        const grid = new TilingSprite({
            texture: renderTexture,
            width: this.size.x,
            height: this.size.y,
        })
        grid.anchor.set(this.anchor.x, this.anchor.y)

        grid.tint = this.gridColor

        return grid
    }

    private generateChunkGrid(chunkOffset: number): TilingSprite {
        const W = 32 * 32
        const H = 32 * 32
        const gridGraphics = new Graphics()
            .moveTo(0, 0)
            .lineTo(W, 0)
            .lineTo(W, H)
            .lineTo(0, H)
            .lineTo(0, 0)
            .stroke({ width: 2, color: 0x000000 })

        const renderTexture = RenderTexture.create({
            width: W,
            height: H,
            autoGenerateMipmaps: true,
        })

        G.app.renderer.render({ container: gridGraphics, target: renderTexture })
        renderTexture.source.updateMipmaps()

        // Add one more chunk to the size because of the offset
        const grid = new TilingSprite({
            texture: renderTexture,
            width: this.size.x + W,
            height: this.size.y + H,
        })
        // Offset chunk grid
        grid.position.set(chunkOffset * 32, chunkOffset * 32)
        grid.anchor.set(this.anchor.x, this.anchor.y)

        return grid
    }

    public initBP(): void {
        // Render Bp
        for (const [, e] of this.bp.entities) {
            new EntityContainer(e, false)
        }
        for (const [, t] of this.bp.tiles) {
            new TileContainer(t)
        }

        const onCreateEntity = (entity: Entity): void => {
            new EntityContainer(entity)
            this.updateHoverContainer()
        }
        const onRemoveEntity = (): void => {
            this.updateHoverContainer()
        }
        const onCreateTile = (tile: Tile): TileContainer => new TileContainer(tile)

        this.bp.on('create-entity', onCreateEntity)
        this.bp.on('remove-entity', onRemoveEntity)
        this.bp.on('create-tile', onCreateTile)

        const onConnectionCreated = (hash: string, connection: IConnection): void => {
            this.wiresContainer.connect(hash, connection)
        }
        const onConnectionRemoved = (hash: string, connection: IConnection): void => {
            this.wiresContainer.disconnect(hash, connection)
        }
        this.bp.wireConnections.on('create', onConnectionCreated)
        this.bp.wireConnections.on('remove', onConnectionRemoved)
        this.bp.wireConnections.forEach((connection, hash) =>
            this.wiresContainer.add(hash, connection)
        )

        this.on('destroyed', () => {
            this.bp.off('create-entity', onCreateEntity)
            this.bp.off('remove-entity', onRemoveEntity)
            this.bp.off('create-tile', onCreateTile)

            this.bp.wireConnections.off('create', onConnectionCreated)
            this.bp.wireConnections.off('remove', onConnectionRemoved)
        })

        this.sortEntities()
        this.centerViewport()
    }

    public destroy(): void {
        super.destroy({ children: true })
    }

    public addEntitySprites(entitySprites: EntitySprite[], sort = true): void {
        if (entitySprites.length === 0) return
        this.entitySprites.addChild(...entitySprites)
        if (sort) {
            this.sortEntities()
        }
    }

    /**
     * How many tile sprites are currently drawn. One per tile of the loaded
     * blueprint, unless a tile had nothing to draw with - see
     * TileContainer.generateSprite.
     */
    public get tileSpriteCount(): number {
        return this.tileSprites.children.length
    }

    public addTileSprites(tileSprites: EntitySprite[]): void {
        if (tileSprites.length === 0) return
        this.tileSprites.addChild(...tileSprites)
    }

    private sortEntities(): void {
        this.entitySprites.children.sort(EntitySprite.compareFn)
    }

    public transparentEntities(bool = true): void {
        const alpha = bool ? 0.5 : 1
        this.entitySprites.alpha = alpha
        this.wiresContainer.alpha = alpha
        this.overlayContainer.alpha = alpha
    }

    public centerViewport(): void {
        const bounds = this.bp.isEmpty()
            ? new Rectangle(-16 * 32, -16 * 32, 32 * 32, 32 * 32)
            : this.getBlueprintBounds()

        this.viewport.centerViewPort(
            {
                x: bounds.width,
                y: bounds.height,
            },
            {
                x: (this.size.x - bounds.width) / 2 - bounds.x,
                y: (this.size.y - bounds.height) / 2 - bounds.y,
            }
        )
    }

    public getBlueprintBounds(): Rectangle {
        const rect = this.entitySprites
            .getLocalBounds()
            .rectangle.enlarge(this.tileSprites.getLocalBounds().rectangle)

        const X = Math.floor(rect.x / 32) * 32
        const Y = Math.floor(rect.y / 32) * 32
        const W = Math.ceil((rect.width + rect.x - X) / 32) * 32
        const H = Math.ceil((rect.height + rect.y - Y) / 32) * 32
        rect.x = X
        rect.y = Y
        rect.width = W
        rect.height = H

        return rect
    }

    /**
     * Rejects rather than resolving to nothing, on all three ways this can fail to
     * produce an image. The bare `return` this used to do on an empty blueprint
     * handed back `undefined` instead of a promise, so the caller's `.then` threw
     * before its `.catch` was attached - and the only caller already refuses to ask
     * for a picture of an empty blueprint, so that path was unreachable anyway.
     */
    public async getPicture(): Promise<Blob> {
        if (this.bp.isEmpty()) throw new Error('Cannot take a picture of an empty blueprint')

        const frame = this.getBlueprintBounds()
        const texture = G.app.renderer.generateTexture({
            target: this,
            frame,
            resolution: 1,
            textureSourceOptions: {
                scaleMode: 'linear',
            },
        })

        const canvas = G.app.renderer.extract.canvas(texture)
        // Held as a local because narrowing a property does not survive into the
        // closure below.
        const toBlob = canvas.toBlob?.bind(canvas)
        if (toBlob === undefined) {
            texture.destroy(true)
            throw new Error('Canvas cannot produce a blob')
        }

        return new Promise((resolve, reject) => {
            toBlob(blob => {
                texture.destroy(true)
                if (blob === null) {
                    reject(new Error('Canvas failed to produce a blob'))
                } else {
                    resolve(blob)
                }
            })
        })
    }

    public spawnPaintContainer(itemNameOrEntities: string | Entity[], direction = 0): void {
        if (this.mode === EditorMode.PAINT) {
            this.painting.destroy()
        }

        this.updateHoverContainer(true)
        this.setMode(EditorMode.PAINT)
        this.cursor = 'pointer'

        try {
            if (typeof itemNameOrEntities === 'string') {
                const itemData = FD.items[itemNameOrEntities]
                if (!itemData) throw new Error(`Item data not found: ${itemNameOrEntities}`)

                const wireResult =
                    WiresPanel.Wires.includes(itemNameOrEntities) && itemNameOrEntities
                const tileResult = itemData.place_as_tile && itemData.place_as_tile.result
                const placeResult = itemData.place_result || tileResult || wireResult

                if (!placeResult) throw new Error(`No place result for item: ${itemNameOrEntities}`)

                if (wireResult) {
                    this.paintContainer = this.wirePaintSlot.addChild(
                        new PaintWireContainer(this, placeResult)
                    )
                } else if (tileResult) {
                    this.paintContainer = this.tilePaintSlot.addChild(
                        new PaintTileContainer(this, placeResult)
                    )
                } else {
                    this.paintContainer = this.entityPaintSlot.addChild(
                        new PaintEntityContainer(this, placeResult, direction)
                    )
                }
            } else {
                this.paintContainer = this.entityPaintSlot.addChild(
                    new PaintBlueprintContainer(this, itemNameOrEntities)
                )
            }
        } catch (e) {
            console.error('Failed to create paint container:', e)
            this.setMode(EditorMode.NONE)
            this.cursor = 'inherit'
            return
        }

        if (!this.isPointerInside) {
            this.painting.hide()
        }

        this.painting.on('destroyed', () => {
            this.paintContainer = undefined
            this.setMode(EditorMode.NONE)
            this.updateHoverContainer()
            this.cursor = 'inherit'
        })
    }
}
