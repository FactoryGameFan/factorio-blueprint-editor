import FD from '../core/factorioData'
import { IPoint } from '../types'
import G from '../common/globals'
import { Tile } from '../core/Tile'
import { EntitySprite } from './EntitySprite'

export class TileContainer {
    private readonly tileSprites: EntitySprite[] = []

    public constructor(tile: Tile) {
        const sprite = TileContainer.generateSprite(tile.name, tile.x, tile.y)
        // A tile that could not be drawn contributes nothing rather than
        // stopping the load - see generateSprite.
        if (sprite !== undefined) {
            this.tileSprites.push(sprite)
            G.BPC.addTileSprites([sprite])
        }

        tile.on('destroy', () => this.tileSprites.forEach(s => s.destroy()))
    }

    /**
     * Undefined where the prototype carries nothing to draw this tile with.
     *
     * Deliberately not a `need()`, which is how spriteDataBuilder reads optional
     * prototype fields: that works there because `getSpriteData` wraps every
     * generator in a try/catch and degrades to a placeholder box. Nothing wraps
     * this - it is called straight from `BlueprintContainer.initBP`, so a throw
     * takes the entire blueprint load down. That is the failure mode of issue
     * #46, and issue #54 is the note not to reintroduce it at the read.
     *
     * Warned rather than skipped quietly, because the alternative outcome is an
     * invisible hole in a floor, which is not something anyone would report
     * accurately. Every tile in data.json draws today, so this is a guard on a
     * shape the types permit and the data has never produced.
     */
    public static generateSprite(name: string, x: number, y: number): EntitySprite | undefined {
        const width = 64
        const height = 64
        const scale = 0.5

        let filename: string
        let countX: number
        let countY: number
        let X: number
        let Y: number

        const variants = FD.tiles[name].variants
        if (variants.material_background === undefined) {
            const variant = variants.main?.find(v => (v.size || 1) === 1)
            if (variant?.picture === undefined || variant.count === undefined) {
                console.warn(
                    `Tile "${name}" has no single-tile "main" variant to draw with; leaving it blank.`
                )
                return undefined
            }
            filename = variant.picture
            countX = variant.count
            countY = 1
            X = Math.floor(Math.random() * (countX - 1))
            Y = Math.floor(Math.random() * (countY - 1))
        } else {
            const variant = variants.material_background
            filename = variant.picture
            countX = 8
            countY = 8
            X = Math.abs(Math.floor(x)) % countX
            Y = Math.abs(Math.floor(y)) % countY
            if (Math.sign(x) === -1) X = (countX - X) % countX
            if (Math.sign(y) === -1) Y = (countY - Y) % countY
        }

        const texture = G.getTexture(filename, X * width, Y * height, width, height)

        return new EntitySprite(
            texture,
            {
                filename,
                width,
                height,
                scale,
            },
            {
                x: x * width * scale,
                y: y * height * scale,
            }
        )
    }

    public static generateSprites(
        name: string,
        position: IPoint,
        positions: IPoint[]
    ): EntitySprite[] {
        // flatMap rather than map, so a tile with nothing to draw drops out
        // instead of leaving an undefined for the caller to spread into pixi.
        return positions.flatMap(p => {
            const s = TileContainer.generateSprite(name, p.x + position.x, p.y + position.y)
            if (s === undefined) return []
            s.position.set(p.x * 32, p.y * 32)
            s.alpha = 0.5
            return [s]
        })
    }
}
