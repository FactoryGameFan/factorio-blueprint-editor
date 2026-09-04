import EventEmitter from 'eventemitter3'
import FD from './factorioData'

export interface TileEvents {
    destroy: []
}

export class Tile extends EventEmitter<TileEvents> {
    private readonly _name: string
    private readonly _x: number
    private readonly _y: number

    public constructor(name: string, x: number, y: number) {
        super()

        this._name = name
        this._x = x
        this._y = y
    }

    /**
     * The item a tile is placed with, or undefined for one that has none.
     *
     * Matches `Entity.getItemName`, which answers the same question for entities
     * and had to widen for the 20 with no `minable.result` - that read used to
     * throw a TypeError and took blueprint icon generation down with it.
     * `computeAutoIcons` already accepts `(name: string) => string | undefined`
     * for both and drops the ones with nothing to show.
     *
     * Every tile in data.json does have `minable.result` today, so this is the
     * type catching up with a shape the data has not exercised, not a fix.
     */
    public static getItemName(name: string): string | undefined {
        if (name === 'landfill') return 'landfill'
        return FD.tiles[name].minable?.result
    }

    public get name(): string {
        return this._name
    }

    public get x(): number {
        return this._x
    }

    public get y(): number {
        return this._y
    }

    public get hash(): string {
        return `${this._x},${this._y}`
    }

    public destroy(): void {
        this.emit('destroy')
        this.removeAllListeners()
    }
}
