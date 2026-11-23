import { Container, Text } from 'pixi.js'
import type { Blueprint } from '../core/Blueprint'
import {
    BillOfMaterials,
    MaterialCount,
    billOfMaterials,
    materialAmountLabel,
} from '../core/billOfMaterials'
import { ICON_BADGE_SCALE } from '../core/qualityBadge'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { SCROLL_TRACK_W, ScrollArea } from './controls/ScrollArea'
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

/** What a slot drew, read back off the display tree. See tests/bill-of-materials.spec.ts. */
export interface DrawnMaterialSlot {
    name: string
    quality?: string
    /** The amount label's text, as drawn. */
    amount: string
    /** Whether a quality badge was drawn in the slot. */
    badge: boolean
}

const SLOT_LABEL = 'bill-of-materials'
const AMOUNT_LABEL = 'amount'

/** Which material each slot was drawn for, so `drawnSlots` can pair the two. */
const cellMaterial = new WeakMap<Container, MaterialCount>()

/*
    The badge sits in the slot's bottom-left corner with the amount in the
    bottom-right, as in the game's own inventory slots. Its size is borrowed
    from the alt-mode recipe and filter badges, 0.45 of the icon
    (qualityBadge.ts); nobody has measured an inventory slot. The amount is
    added last so a five-character label that reaches the badge still reads on
    top of it.
*/
const BADGE_SIZE = 32 * ICON_BADGE_SCALE.filter

/**
 * One slot: the icon, its quality badge and its count. An entity no item
 * places is listed under its own name, and draws its own icon - `CreateIcon`
 * falls back to the entity prototype for exactly that.
 */
function createCell(material: MaterialCount): Container {
    const { name, quality, count } = material
    const cell = new Container()
    cell.label = SLOT_LABEL
    cell.addChild(
        F.DrawRectangle(
            CELL,
            CELL,
            colors.controls.button.background.color,
            colors.controls.button.background.alpha,
            1,
            true
        )
    )

    const icon = F.SafeIcon(name, () => F.CreateIcon(name, undefined, false))
    icon.position.set(2, 2)
    cell.addChild(icon)

    const badge = F.CreateQualityBadge(quality, { x: 2, y: 34 }, BADGE_SIZE)
    if (badge) cell.addChild(badge)

    const amount = new Text({ text: materialAmountLabel(count), style: styles.icon.amount })
    amount.label = AMOUNT_LABEL
    amount.anchor.set(1, 1)
    amount.position.set(35, 35)
    cell.addChild(amount)

    cellMaterial.set(cell, material)
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

    public constructor(bp: Blueprint) {
        const materials = billOfMaterials(
            bp.entities.valuesArray(),
            bp.tiles.valuesArray().map(t => t.name)
        )

        const rows = new Container()
        let contentHeight = addSection(rows, 0, 'Entities', materials.entities)
        contentHeight += addSection(rows, contentHeight, 'Tiles', materials.tiles)
        const viewportHeight = Math.min(Math.max(contentHeight, HEADER_H), VP_H_MAX)

        super(WIDTH, VP_Y + viewportHeight + 12, 'Bill of Materials')

        this.materials = materials
        this.m_Rows = rows

        const entityCount = bp.entities.size
        const tileCount = bp.tiles.size
        this.addLabel(
            12,
            40,
            entityCount === 0 && tileCount === 0
                ? 'Nothing to build'
                : `${plural(entityCount, 'entity', 'entities')}, ${plural(tileCount, 'tile', 'tiles')}`
        )

        // The track sits centred in the 16px gutter right of the slots.
        const scrollArea = new ScrollArea({
            width: VP_W,
            height: viewportHeight,
            trackX: VP_W + (16 - SCROLL_TRACK_W) / 2,
        })
        scrollArea.position.set(VP_X, VP_Y)
        scrollArea.content.addChild(this.m_Rows)
        scrollArea.contentHeight = contentHeight
        this.addChild(scrollArea)
    }

    /**
     * Every slot in drawing order, entities then tiles, with the text and badge
     * it actually drew - what `materials` says is the input, this is the output.
     * See tests/bill-of-materials.spec.ts.
     */
    public get drawnSlots(): DrawnMaterialSlot[] {
        const slots: DrawnMaterialSlot[] = []
        for (const cell of this.m_Rows.children) {
            const material = cellMaterial.get(cell)
            if (material === undefined) continue
            const amount = cell.getChildByLabel(AMOUNT_LABEL)
            slots.push({
                name: material.name,
                ...(material.quality === undefined ? {} : { quality: material.quality }),
                amount: amount instanceof Text ? amount.text : '',
                badge: cell.getChildByLabel(/^quality-badge:/) !== null,
            })
        }
        return slots
    }
}
