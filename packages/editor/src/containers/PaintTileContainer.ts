import FD from '../core/factorioData'
import { IPoint } from '../types'
import { Tile } from '../core/Tile'
import util from '../common/util'
import { Entity } from '../core/Entity'
import { TileContainer } from './TileContainer'
import { PaintContainer } from './PaintContainer'
import { BlueprintContainer } from './BlueprintContainer'

export class PaintTileContainer extends PaintContainer {
    private static size = 2

    public constructor(bpc: BlueprintContainer, name: string) {
        super(bpc, name)

        this.bpc.transparentEntities()

        this.attachUpdateOn16()
        this.moveAtCursor()
        this.redraw()
    }

    private static getTilePositions(): IPoint[] {
        return [...Array(Math.pow(PaintTileContainer.size, 2)).keys()].map(i => {
            const offset = PaintTileContainer.size / 2 - 0.5
            return {
                x: (i % PaintTileContainer.size) - offset,
                y: (i - (i % PaintTileContainer.size)) / PaintTileContainer.size - offset,
            }
        })
    }

    public hide(): void {
        this.bpc.transparentEntities(false)
        super.hide()
    }

    public show(): void {
        this.bpc.transparentEntities()
        super.show()
    }

    public destroy(): void {
        this.bpc.transparentEntities(false)
        super.destroy()
    }

    public override getItemName(): string {
        // Same shape as PaintEntityContainer's, and for the same reason: the
        // abstract stays `string` because PaintContainer's constructor draws an
        // icon from it, and something being painted is by definition something
        // with an item to place it with. Naming the invariant beats widening
        // the base and pushing a check onto the quickbar.
        const itemName = Tile.getItemName(this.name)
        if (itemName === undefined) {
            throw new Error(`${this.name} is being painted but has no item to place it with`)
        }
        return itemName
    }

    public increaseSize(): void {
        if (PaintTileContainer.size === 20) return
        PaintTileContainer.size += 1
        this.moveAtCursor()
        this.redraw()
    }

    public decreaseSize(): void {
        if (PaintTileContainer.size === 1) return
        PaintTileContainer.size -= 1
        this.moveAtCursor()
        this.redraw()
    }

    public override rotate(_ccw?: boolean): void {
        const nD = FD.tiles[this.name].next_direction
        if (nD) {
            this.name = nD
            this.redraw()
        }
    }

    public override canFlipOrRotateByCopying(): boolean {
        return false
    }

    public override rotatedEntities(_ccw?: boolean): Entity[] {
        throw new Error('A tile is not rotated by copying')
    }

    public override flippedEntities(_vertical: boolean): Entity[] {
        throw new Error('A tile is not flipped by copying')
    }

    protected override redraw(): void {
        this.removeChildren()
        const sprites = TileContainer.generateSprites(
            this.name,
            this.position,
            PaintTileContainer.getTilePositions()
        )
        // generateSprites can now come back empty, and pixi's addChild reads
        // children[0] before checking the length.
        if (sprites.length > 0) {
            this.addChild(...sprites)
        }
    }

    public override moveAtCursor(): void {
        this.setNewPosition({
            x: PaintTileContainer.size,
            y: PaintTileContainer.size,
        })
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        const position = this.getGridPosition()

        this.bpc.bp.removeTiles(
            PaintTileContainer.getTilePositions().map(p => util.sumprod(p, position))
        )
    }

    public override placeEntityContainer(): void {
        if (!this.visible) return

        const position = this.getGridPosition()

        this.bpc.bp.createTiles(
            this.name,
            PaintTileContainer.getTilePositions().map(p => util.sumprod(p, position))
        )
    }
}
