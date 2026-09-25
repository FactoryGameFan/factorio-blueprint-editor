import { Graphics } from 'pixi.js'
import type { IconShape, PathSegment } from '../core/shortcutIcons'

/*
    Draws the vector shape data in `core/` - the shortcut bar's icons and the
    overlay chrome - onto a pixi `Graphics`. Both callers then bake the result
    to a texture, since the editor's canvas has antialiasing off.
*/

/*
    Arcs are traced as short lines rather than with `Graphics.arc`. Pixi's arc
    adds its start point even when the pen is already there, and a stroke
    divides by that zero-length step: measured, it cut a wedge out of the
    outer edge of each wire's ring. `lineTo` skips a repeated point. A full
    circle leaves off its last point, which is its first, and `close` joins
    the two.
*/
const ARC_STEP_DEGREES = 3

function tracePath(g: Graphics, path: readonly PathSegment[]): void {
    for (const s of path) {
        switch (s.op) {
            case 'move':
                g.moveTo(s.x, s.y)
                break
            case 'line':
                g.lineTo(s.x, s.y)
                break
            case 'arc': {
                const sweep = s.to - s.from
                const steps = Math.ceil(Math.abs(sweep) / ARC_STEP_DEGREES)
                const last = Math.abs(sweep) >= 360 ? steps - 1 : steps
                for (let i = 0; i <= last; i++) {
                    const a = ((s.from + (sweep * i) / steps) * Math.PI) / 180
                    g.lineTo(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a))
                }
                break
            }
            case 'close':
                g.closePath()
                break
        }
    }
}

/** Draws the shapes in order, each over the last, and returns `g`. */
export function drawShapes(g: Graphics, shapes: readonly IconShape[]): Graphics {
    for (const shape of shapes) {
        tracePath(g, shape.path)
        if (shape.kind === 'fill') {
            g.fill(shape.color)
            /*
                All holes go in one `cut()`. Pixi 8's `cut()` adds a hole to
                the last fill and, when that fill already has one, to the fill
                before it as well, so a second call would punch the previous
                shape too.
            */
            if (shape.holes?.length) {
                for (const hole of shape.holes) tracePath(g, hole)
                g.cut()
            }
        } else {
            g.stroke({ width: shape.width, color: shape.color, cap: 'butt', join: 'miter' })
        }
    }
    return g
}
