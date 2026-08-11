import { Matrix } from 'pixi.js'
import { IPoint } from '../types'
import { clampZoom, ZOOM_MAX } from '../core/zoomLevels'

export class Viewport {
    private size: IPoint
    private viewPortSize: IPoint
    private anchor: IPoint
    private dirty = true
    private positionX = 0
    private positionY = 0
    private scaleX = 1
    private scaleY = 1
    private scaleCenterX = 0
    private scaleCenterY = 0
    private origTransform = new Matrix()
    private transform = new Matrix()

    /*
        The zoom ceiling used to arrive as a constructor argument, which
        `BlueprintContainer` passed as a literal 3. It now comes from
        `zoomLevels.ts`, where the same 3 is recorded as the game's measured
        limit (#206) - a bound written down in two places is one that has to be
        kept in sync, and the copy nothing tests is the one that loses.
    */
    public constructor(size: IPoint, viewPortSize: IPoint, anchor: IPoint) {
        this.size = size
        this.viewPortSize = viewPortSize
        this.anchor = anchor
    }

    private _updateMatrix(): void {
        // Accumulate zoom transformations.
        // origTransform is an intermediate accumulative matrix used for tracking the current zoom target.
        this.origTransform.append(new Matrix(1, 0, 0, 1, this.scaleCenterX, this.scaleCenterY))
        this.origTransform.append(new Matrix(this.scaleX, 0, 0, this.scaleY, 0, 0))
        this.origTransform.append(new Matrix(1, 0, 0, 1, -this.scaleCenterX, -this.scaleCenterY))

        // We reset Scale because origTransform is accumulative and has "captured" the information.
        this.scaleX = 1
        this.scaleY = 1

        // Tack on translation. Note: we don't append it, but concat it into a separate matrix.
        // We want to leave origTransform solely responsible for zooming.
        // "transform" is the final matrix.
        this.transform = this.origTransform.clone()

        // UpperLeft Corner constraints
        const minX = this.size.x * this.transform.a * this.anchor.x - this.transform.tx
        const minY = this.size.y * this.transform.a * this.anchor.y - this.transform.ty
        // LowerRight Corner constraints
        const maxX =
            -(this.size.x * (1 - this.anchor.x) * this.transform.a - this.viewPortSize.x) -
            this.transform.tx
        const maxY =
            -(this.size.y * (1 - this.anchor.y) * this.transform.a - this.viewPortSize.y) -
            this.transform.ty

        // Check if viewport area is bigger than the container
        if (maxX - minX > 0 || maxY - minY > 0) {
            this.origTransform = new Matrix()

            this.scaleCenterX = this.size.x / 2
            this.scaleCenterY = this.size.y / 2

            const maxZoom =
                Math.max(
                    this.viewPortSize.x / (this.size.x * this.transform.a),
                    this.viewPortSize.y / (this.size.y * this.transform.a)
                ) * this.transform.a
            this.scaleX = maxZoom
            this.scaleY = maxZoom

            this._updateMatrix()

            return
        }

        if (this.positionX > minX) {
            this.positionX = minX
        }
        if (this.positionY > minY) {
            this.positionY = minY
        }
        if (this.positionX < maxX) {
            this.positionX = maxX
        }
        if (this.positionY < maxY) {
            this.positionY = maxY
        }

        this.transform.translate(this.positionX, this.positionY)
    }

    public centerViewPort(focusObjectSize: IPoint, offset: IPoint): void {
        this.origTransform = new Matrix()

        this.positionX = -this.size.x / 2 + this.viewPortSize.x / 2 + offset.x
        this.positionY = -this.size.y / 2 + this.viewPortSize.y / 2 + offset.y

        this.scaleCenterX = this.size.x / 2 + -offset.x
        this.scaleCenterY = this.size.y / 2 + -offset.y

        /*
            Capped at the ceiling but deliberately **not** at the floor: a
            blueprint wider than `ZOOM_MIN` allows still has to fit exactly, and
            30 of the 367 corpus blueprints are wide enough to need it. Keeping
            the fit exact is why the continuous scale stays the source of truth
            rather than a ladder index (#206).
        */
        const zoom = Math.min(
            this.viewPortSize.x / focusObjectSize.x,
            this.viewPortSize.y / focusObjectSize.y,
            ZOOM_MAX
        )
        this.scaleX = zoom
        this.scaleY = zoom

        this.dirty = true
    }

    /** @returns true if it was dirty */
    public update(): boolean {
        if (this.dirty) {
            this._updateMatrix()
            this.dirty = false
            return true
        }
        return false
    }

    /**
     * The current transform, rebuilt first if a change is still pending.
     *
     * Every mutator here sets `dirty` and leaves the matrix alone, so between a
     * `centerViewPort`/`zoomBy`/`setPosition` and the next render frame this
     * used to answer the matrix from *before* that change (issue #144).
     * Rendering never noticed, because the only place the container's own
     * position and scale are written is inside `update()`'s branch - but
     * `BlueprintContainer.toScreen` reads this, and that is how every spec finds
     * an entity to point at. Measured, an entity of a just-loaded blueprint
     * reported (-80, -16), off the canvas, until a frame ran.
     *
     * Deliberately does **not** clear `dirty`. `update()`'s return value gates
     * `gridData.recalculate()` and the container's position/scale write, so
     * clearing it here would skip that work and turn a stale read into a stale
     * *render*. `_updateMatrix` resets `scaleX`/`scaleY` to 1 as it goes, which
     * makes a second call append an identity and land on the same matrix, so the
     * ticker recomputing it is free rather than wrong.
     */
    public getTransform(): Matrix {
        if (this.dirty) this._updateMatrix()
        return this.transform
    }

    public setSize(x: number, y: number): void {
        this.viewPortSize.x = x
        this.viewPortSize.y = y
        this.dirty = true
    }

    public setPosition(posX: number, posY: number): void {
        this.positionX = posX
        this.positionY = posY
        this.dirty = true
    }

    /**
     * Continuous zoom by a proportional delta, for **mobile pinch only** - it
     * derives `scaleDelta` from finger distance, which cannot be expressed in
     * rungs. The wheel goes through `stepZoom` and `setCurrentScale` instead.
     *
     * Two fixes over what this used to be (#206 defect 3). The guard tested the
     * ceiling *before* applying, so from 2.99 a tick still landed at 3.289 -
     * soft by a whole step. And there was no floor anywhere: because the step is
     * multiplicative it approached 0 asymptotically rather than going negative,
     * degrading into an unusable speck instead of failing outright.
     *
     * The second parameter is gone with them. It allowed a non-uniform zoom that
     * no caller ever asked for and that a single clamped scale cannot express -
     * `getCurrentScale` only ever reports the x axis, so the two could disagree
     * with nothing able to see it.
     */
    public zoomBy(delta: number): void {
        /* Rebuild first, or `origTransform.a` is the scale from before a pending change. */
        if (this.dirty) this._updateMatrix()
        const current = this.origTransform.a
        this.scaleX = clampZoom(current * (1 + delta)) / current
        this.scaleY = this.scaleX
        this.dirty = true
    }

    public translateBy(deltaX: number, deltaY: number): void {
        this.positionX += deltaX
        this.positionY += deltaY
        this.dirty = true
    }

    public setCurrentScale(newScale: number): void {
        if (this.dirty) {
            this._updateMatrix()
        }

        // We use dimensional analysis to set the scale. Remember we can't
        // just set the scale absolutely because origTransform is an accumulating matrix.
        // We have to take its current value and compute a new value based
        // on the passed in value.

        const scaleFactor = newScale / this.origTransform.a

        this.scaleX = scaleFactor
        this.scaleY = scaleFactor

        this.dirty = true
    }

    /**
     * Rebuilds a pending change first, for the same reason `getTransform` does
     * (#144): every mutator here sets `dirty` and leaves the matrix alone, so
     * without this a read between a change and the next render frame answers the
     * scale from *before* it. That mattered little while the caller only
     * displayed the number; it matters now that `zoom()` computes the next rung
     * from it, since a stale reading steps from the wrong rung.
     */
    public getCurrentScale(): number {
        if (this.dirty) this._updateMatrix()
        return this.origTransform.a
    }

    public setScaleCenter(posX: number, posY: number): void {
        this.scaleCenterX = posX
        this.scaleCenterY = posY
        this.dirty = true
    }
}
