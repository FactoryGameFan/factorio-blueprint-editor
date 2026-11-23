import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js'
import { wheelDeltaPx } from '../../core/zoomLevels'

/** Width of the strip a thumb drag or a page click is taken from. The drawn thumb is slimmer. */
export const SCROLL_TRACK_W = 12

/** Width of the drawn thumb, centred in the track. */
const THUMB_W = 4

/** The shortest a thumb gets, so a very long list still leaves something to grab. */
const MIN_THUMB_H = 24

const THUMB_COLOR = { color: 0xc8c8c8, alpha: 0.6 }
const THUMB_COLOR_ACTIVE = { color: 0xffffff, alpha: 0.85 }
const TRACK_COLOR = { color: 0xc8c8c8, alpha: 0.12 }

interface Box {
    x: number
    y: number
    width: number
    height: number
}

/** What a spec needs to drive a scroll area; see `UIContainer.topDialogScroll`. Client coordinates. */
export interface ScrollAreaState {
    /** How far the content has moved up, in px. */
    scroll: number
    /** The most `scroll` can be. 0 when the content fits. */
    maxScroll: number
    viewport: Box
    /** The strip clicks page from and the thumb slides in. */
    track: Box
    /** Undefined while nothing scrolls and no thumb is shown. */
    thumb: Box | undefined
}

export interface ScrollAreaOptions {
    /** Width of the clipped viewport. */
    width: number
    /** Height of the clipped viewport. */
    height: number
    /**
     * Left edge of the track, from the viewport's own left edge. It sits
     * beside the content, never over it, so a click on the track cannot land
     * on a row.
     */
    trackX: number
}

/**
 * A clipped viewport with a scrollbar, for the dialogs that list more than
 * they can show (issue #643). Put the rows in `content` and say how tall they
 * are with `contentHeight`.
 *
 *  - The wheel scrolls by the pixels it reports, whatever `deltaMode` says,
 *    from anywhere over the viewport or the scrollbar. Rounding every event up
 *    to a whole row sent a browser that splits one notch into many small
 *    events racing down the list.
 *  - The thumb drags.
 *  - A click on the track above or below the thumb pages by one viewport.
 *
 * The thumb and the track stop their own pointer events, so none of this can
 * reach a row, or close the dialog the area sits in.
 */
export class ScrollArea extends Container {
    /** Put the scrolling rows here. Moves up by `scroll`. */
    public readonly content = new Container()

    private readonly m_Viewport = new Container()
    private readonly m_Track: Graphics
    private readonly m_Thumb: Graphics
    private readonly m_Width: number
    private readonly m_Height: number
    private readonly m_TrackX: number
    private m_ContentHeight = 0
    private m_Scroll = 0
    private m_ThumbH = 0

    /** Where in the thumb a drag took hold, so it does not jump to put its top under the pointer. */
    private m_GrabOffset: number | undefined

    private readonly m_OnWheel = (e: WheelEvent): void => {
        if (this.maxScroll <= 0) return
        e.preventDefault()
        e.stopPropagation()
        this.scroll += wheelDeltaPx(e.deltaY, e.deltaMode)
    }

    public constructor({ width, height, trackX }: ScrollAreaOptions) {
        super()
        this.m_Width = width
        this.m_Height = height
        this.m_TrackX = trackX
        this.eventMode = 'static'

        this.m_Viewport.addChild(this.content)
        this.m_Viewport.eventMode = 'static'
        this.m_Viewport.hitArea = new Rectangle(0, 0, width, height)
        this.addChild(this.m_Viewport)

        const mask = new Graphics().rect(0, 0, width, height).fill(0xffffff)
        this.addChild(mask)
        this.m_Viewport.mask = mask

        this.m_Track = new Graphics()
        this.m_Track.position.set(trackX, 0)
        this.m_Track.hitArea = new Rectangle(0, 0, SCROLL_TRACK_W, height)
        this.m_Track.rect((SCROLL_TRACK_W - THUMB_W) / 2, 0, THUMB_W, height).fill(TRACK_COLOR)
        this.m_Track.eventMode = 'static'
        this.m_Track.visible = false
        this.m_Track.on('pointerdown', this.onTrackDown)
        this.addChild(this.m_Track)

        this.m_Thumb = new Graphics()
        this.m_Thumb.eventMode = 'static'
        this.m_Thumb.cursor = 'pointer'
        this.m_Thumb.visible = false
        this.m_Thumb.on('pointerdown', this.onThumbDown)
        this.m_Thumb.on('pointerup', this.endDrag)
        this.m_Thumb.on('pointerupoutside', this.endDrag)
        this.addChild(this.m_Thumb)

        this.addEventListener('wheel', this.m_OnWheel)
    }

    /** Height of everything in `content`. Setting it re-clamps the scroll and redraws the thumb. */
    public get contentHeight(): number {
        return this.m_ContentHeight
    }

    public set contentHeight(height: number) {
        this.m_ContentHeight = height
        this.scroll = this.m_Scroll
    }

    public get maxScroll(): number {
        return Math.max(0, this.m_ContentHeight - this.m_Height)
    }

    /** How far the content has moved up, in px. Clamped to [0, maxScroll] when set. */
    public get scroll(): number {
        return this.m_Scroll
    }

    public set scroll(value: number) {
        this.m_Scroll = Math.min(this.maxScroll, Math.max(0, value))
        // Whole pixels, so text does not blur at the half-pixel offsets a small wheel event leaves.
        this.content.y = -Math.round(this.m_Scroll)
        this.refreshThumb()
    }

    public get state(): ScrollAreaState {
        const box = (target: Container, w: number, h: number): Box => {
            const at = target.toGlobal({ x: 0, y: 0 })
            return { x: at.x, y: at.y, width: w, height: h }
        }
        return {
            scroll: this.m_Scroll,
            maxScroll: this.maxScroll,
            viewport: box(this.m_Viewport, this.m_Width, this.m_Height),
            track: box(this.m_Track, SCROLL_TRACK_W, this.m_Height),
            thumb: this.m_Thumb.visible
                ? box(this.m_Thumb, SCROLL_TRACK_W, this.m_ThumbH)
                : undefined,
        }
    }

    /** Takes the listeners off. Safe to call twice. */
    public dispose(): void {
        this.removeEventListener('wheel', this.m_OnWheel)
        this.m_Track.removeAllListeners()
        this.m_Thumb.removeAllListeners()
        this.m_GrabOffset = undefined
    }

    public override destroy(...args: Parameters<Container['destroy']>): void {
        this.dispose()
        super.destroy(...args)
    }

    private refreshThumb(): void {
        const max = this.maxScroll
        const scrolls = max > 0
        this.m_Track.visible = scrolls
        this.m_Thumb.visible = scrolls
        if (!scrolls) return

        const thumbH = Math.max(MIN_THUMB_H, (this.m_Height * this.m_Height) / this.m_ContentHeight)
        this.m_ThumbH = thumbH
        this.m_Thumb.clear()
        this.m_Thumb
            .rect((SCROLL_TRACK_W - THUMB_W) / 2, 0, THUMB_W, thumbH)
            .fill(this.m_GrabOffset === undefined ? THUMB_COLOR : THUMB_COLOR_ACTIVE)
        // The whole track's width is the grab target, not just the slim drawn bar.
        this.m_Thumb.hitArea = new Rectangle(0, 0, SCROLL_TRACK_W, thumbH)
        this.m_Thumb.position.set(this.m_TrackX, (this.m_Scroll / max) * (this.m_Height - thumbH))
    }

    private readonly onThumbDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button !== 0) return
        this.m_GrabOffset = this.toLocal(e.global).y - this.m_Thumb.y
        // Listening only for the length of a drag, as the map pan does.
        this.m_Thumb.on('globalpointermove', this.onThumbMove)
        this.refreshThumb()
    }

    private readonly onThumbMove = (e: FederatedPointerEvent): void => {
        if (this.m_GrabOffset === undefined) return
        // A release the page never saw (outside the window, or under a dialog
        // that took the pointer) leaves the drag open, and every later move
        // would drag the thumb with no button held.
        if ((e.buttons & 1) === 0) {
            this.endDrag()
            return
        }
        const travel = this.m_Height - this.m_ThumbH
        if (travel <= 0) return
        const thumbY = this.toLocal(e.global).y - this.m_GrabOffset
        this.scroll = (thumbY / travel) * this.maxScroll
    }

    private readonly endDrag = (): void => {
        this.m_Thumb.off('globalpointermove', this.onThumbMove)
        if (this.m_GrabOffset === undefined) return
        this.m_GrabOffset = undefined
        this.refreshThumb()
    }

    private readonly onTrackDown = (e: FederatedPointerEvent): void => {
        e.stopPropagation()
        if (e.button !== 0) return
        const y = this.toLocal(e.global).y
        if (y < this.m_Thumb.y) this.scroll -= this.m_Height
        else if (y > this.m_Thumb.y + this.m_ThumbH) this.scroll += this.m_Height
    }
}
