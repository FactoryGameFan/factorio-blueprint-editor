import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { Blueprint } from '../core/Blueprint'
import { BillOfMaterials, MaterialCount, billOfMaterials } from '../core/billOfMaterials'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { colors, styles } from './style'

/*
    Cols
    Space   @ 0     +12              ->12
    Items   @ 12    +(10*(36+2))     ->392
    Scroll  @ 392   +16              ->408
    Width : 12 + (10 * (36 + 2)) + 16 = 408

    Rows
    Title   @ 10    +24              ->34
    Summary @ 40    +20              ->60
    Items   @ 66    +(up to 304)     ->370
    Space           +12
*/
const COLUMNS = 10
const CELL = 36
const PITCH = CELL + 2
const HEADER_H = 24
const VP_X = 12
const VP_Y = 66
const VP_W = COLUMNS * PITCH
const VP_H_MAX = 8 * PITCH
const WIDTH = VP_X + VP_W + 16

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`
}

/**
 * One slot: the icon with its count, as the inventory and filter slots draw
 * it. An entity no item places is listed under its own name, and draws its own
 * icon - `CreateIcon` falls back to the entity prototype for exactly that.
 */
function createCell(material: MaterialCount): Container {
    const { name, count } = material
    const cell = new Container()
    cell.label = `bill-of-materials:${name}`
    cell.addChild(
        F.DrawRectangle(
            CELL,
            CELL,
            colors.controls.button.background.color,
            colors.controls.button.background.alpha,
            1,
            true
        ),
        F.SafeIcon(name, () => {
            const icon = new Container()
            F.CreateIconWithAmount(icon, 2, 2, name, count)
            return icon
        })
    )
    return cell
}

/** A section title and its grid of slots, stacked from `y` down; answers the height used. */
function addSection(
    rows: Container,
    y: number,
    title: string,
    materials: readonly MaterialCount[]
): number {
    if (materials.length === 0) return 0
    const header = new Text({ text: title, style: styles.dialog.label })
    header.position.set(0, y + (HEADER_H - header.height) / 2)
    rows.addChild(header)

    materials.forEach((material, i) => {
        const cell = createCell(material)
        cell.position.set((i % COLUMNS) * PITCH, y + HEADER_H + Math.floor(i / COLUMNS) * PITCH)
        rows.addChild(cell)
    })
    return HEADER_H + Math.ceil(materials.length / COLUMNS) * PITCH
}

/**
 * What the loaded blueprint takes to build: every entity counted per item that
 * places it and every tile the same way, in two lists (issue #342). A snapshot
 * taken when the dialog opens: it does not follow edits made while it is up.
 */
export class BillOfMaterialsDialog extends Dialog {
    /** The tally the slots were drawn from. See tests/bill-of-materials.spec.ts. */
    public readonly materials: BillOfMaterials

    private readonly m_Rows: Container
    private readonly m_ScrollThumb: Graphics
    private readonly m_ContentHeight: number
    private readonly m_ViewportHeight: number

    public constructor(bp: Blueprint) {
        const materials = billOfMaterials(
            bp.entities.valuesArray().map(e => e.name),
            bp.tiles.valuesArray().map(t => t.name)
        )

        const rows = new Container()
        let contentHeight = addSection(rows, 0, 'Entities', materials.entities)
        contentHeight += addSection(rows, contentHeight, 'Tiles', materials.tiles)
        const viewportHeight = Math.min(Math.max(contentHeight, HEADER_H), VP_H_MAX)

        super(WIDTH, VP_Y + viewportHeight + 12, 'Bill of Materials')

        this.materials = materials
        this.m_Rows = rows
        this.m_ContentHeight = contentHeight
        this.m_ViewportHeight = viewportHeight

        const entityCount = bp.entities.size
        const tileCount = bp.tiles.size
        this.addLabel(
            12,
            40,
            entityCount === 0 && tileCount === 0
                ? 'Nothing to build'
                : `${plural(entityCount, 'entity', 'entities')}, ${plural(tileCount, 'tile', 'tiles')}`
        )

        const viewport = new Container()
        viewport.position.set(VP_X, VP_Y)
        viewport.addChild(this.m_Rows)
        this.addChild(viewport)

        const mask = new Graphics().rect(VP_X, VP_Y, VP_W, viewportHeight).fill(0xffffff)
        this.addChild(mask)
        viewport.mask = mask
        viewport.eventMode = 'static'
        viewport.hitArea = new Rectangle(0, 0, VP_W, viewportHeight)

        this.m_ScrollThumb = new Graphics().rect(0, 0, 4, 1).fill({ color: 0xc8c8c8, alpha: 0.6 })
        this.m_ScrollThumb.visible = false
        this.addChild(this.m_ScrollThumb)

        const onWheel = (e: WheelEvent): void => {
            const maxScroll = Math.max(0, this.m_ContentHeight - this.m_ViewportHeight)
            if (maxScroll <= 0) return
            e.preventDefault()
            e.stopPropagation()
            this.m_Rows.y = Math.min(
                0,
                Math.max(-maxScroll, this.m_Rows.y - Math.sign(e.deltaY) * PITCH)
            )
            this.refreshScrollbar()
        }
        viewport.addEventListener('wheel', onWheel, { passive: false })
        this.on('destroyed', () => {
            viewport.removeEventListener('wheel', onWheel)
        })

        this.refreshScrollbar()
    }

    private refreshScrollbar(): void {
        const maxScroll = Math.max(0, this.m_ContentHeight - this.m_ViewportHeight)
        if (maxScroll <= 0) {
            this.m_ScrollThumb.visible = false
            return
        }
        const thumbH = Math.max(24, this.m_ViewportHeight ** 2 / this.m_ContentHeight)
        const thumbY = VP_Y + (-this.m_Rows.y / maxScroll) * (this.m_ViewportHeight - thumbH)
        this.m_ScrollThumb.visible = true
        this.m_ScrollThumb.height = thumbH
        this.m_ScrollThumb.position.set(VP_X + VP_W + 6, thumbY)
    }
}
