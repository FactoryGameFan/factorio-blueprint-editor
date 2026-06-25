import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { IPoint } from '../types'

function hashStringToColor(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
        hash = hash & hash // Convert to 32-bit int
    }
    // Generate a hue from hash, fixed saturation and lightness for visibility
    const hue = Math.abs(hash % 360)
    // Convert HSL to RGB (s=60%, l=40%)
    const s = 0.6
    const l = 0.4
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
    const m = l - c / 2
    let r: number, g: number, b: number
    if (hue < 60) {
        r = c
        g = x
        b = 0
    } else if (hue < 120) {
        r = x
        g = c
        b = 0
    } else if (hue < 180) {
        r = 0
        g = c
        b = x
    } else if (hue < 240) {
        r = 0
        g = x
        b = c
    } else if (hue < 300) {
        r = x
        g = 0
        b = c
    } else {
        r = c
        g = 0
        b = x
    }
    const ri = Math.round((r + m) * 255)
    const gi = Math.round((g + m) * 255)
    const bi = Math.round((b + m) * 255)
    return (ri << 16) | (gi << 8) | bi
}

export class UnknownEntitySprite extends Container {
    public __zIndex = 0
    public zOrder = 0
    public readonly entityPos: IPoint

    constructor(entityName: string, position: IPoint, tileWidth = 1, tileHeight = 1) {
        super()

        this.entityPos = position
        this.position.set(position.x, position.y)

        const color = hashStringToColor(entityName)
        const pxW = tileWidth * 32
        const pxH = tileHeight * 32

        const rect = new Graphics()
        rect.rect(-pxW / 2, -pxH / 2, pxW, pxH)
        rect.fill({ color, alpha: 0.5 })
        rect.stroke({ color, alpha: 0.8, width: 2 })
        this.addChild(rect)

        const style = new TextStyle({
            fontFamily: 'monospace',
            fontSize: 8,
            fill: 0xffffff,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: pxW - 4,
        })
        const label = new Text({ text: entityName, style })
        label.anchor.set(0.5, 0.5)
        this.addChild(label)
    }
}
