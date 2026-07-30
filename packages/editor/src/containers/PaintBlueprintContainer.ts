import { Entity } from '../core/Entity'
import { Blueprint } from '../core/Blueprint'
import { EntitySprite } from './EntitySprite'
import { PaintContainer } from './PaintContainer'
import { PaintBlueprintEntityContainer } from './PaintBlueprintEntityContainer'
import { BlueprintContainer } from './BlueprintContainer'
import { IConnection } from '../core/WireConnections'

export class PaintBlueprintContainer extends PaintContainer {
    private readonly bp: Blueprint
    private readonly entities = new Map<Entity, PaintBlueprintEntityContainer>()

    public constructor(bpc: BlueprintContainer, entities: Entity[]) {
        super(bpc, 'blueprint')

        const minX = entities.reduce(
            (min, e) => Math.min(min, e.position.x - e.size.x / 2),
            Infinity
        )
        const minY = entities.reduce(
            (min, e) => Math.min(min, e.position.y - e.size.y / 2),
            Infinity
        )
        const maxX = entities.reduce(
            (max, e) => Math.max(max, e.position.x + e.size.x / 2),
            -Infinity
        )
        const maxY = entities.reduce(
            (max, e) => Math.max(max, e.position.y + e.size.y / 2),
            -Infinity
        )

        const center = {
            x: Math.floor((minX + maxX) / 2),
            y: Math.floor((minY + maxY) / 2),
        }

        const entNrWhitelist = new Set(entities.map(e => e.entityNumber))
        const wires = entities[0].Blueprint.wireConnections
            .serializeBpWires()
            .filter(wire => entNrWhitelist.has(wire[0]) && entNrWhitelist.has(wire[2]))
        this.bp = new Blueprint({
            entities: entities.map(e => {
                const ent = e.serialize(entNrWhitelist)
                ent.position.x -= center.x
                ent.position.y -= center.y
                return ent
            }),
            wires,
        })

        for (const [, e] of this.bp.entities) {
            const epc = new PaintBlueprintEntityContainer(this, this.bpc, this.bp, e)
            this.addChild(...epc.entitySprites)
            this.entities.set(e, epc)
        }

        this.children.sort(EntitySprite.compareFn)
        for (const [e] of this.entities) {
            this.bpc.underlayContainer.activateRelatedAreas(e.name)
        }

        this.attachUpdateOn16()
        this.moveAtCursor()
    }

    public hide(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        super.hide()
    }

    public show(): void {
        if (this.entities) {
            for (const [e] of this.entities) {
                this.bpc.underlayContainer.activateRelatedAreas(e.name)
            }
        }
        super.show()
    }

    public destroy(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        for (const [, c] of this.entities) {
            c.destroy()
        }
        super.destroy()
    }

    public override getItemName(): string {
        return 'blueprint'
    }

    public override rotate(_ccw?: boolean): void {}

    public logDataForComparison(): void {
        const withOutNums = [...this.entities.keys()].map(e => ({
            ...e.rawEntity,
            entity_number: undefined as number | undefined,
        }))
        withOutNums.sort(
            (a, b) =>
                Math.sign(b.position.y - a.position.y) || Math.sign(b.position.x - a.position.x)
        )
        console.log(withOutNums)
    }

    public override canFlipOrRotateByCopying(): boolean {
        return true
    }

    /*
        No visibility check, matching flippedEntities below. There was one, and
        it cost the paste: rotate() destroys the container before spawning what
        this returns, so returning undefined while hidden fed undefined to
        PaintBlueprintContainer's constructor, which threw, and the catch in
        spawnPaintContainer dropped the whole paste to EditorMode.NONE with only
        a console error (issue #53).

        Rotating needs no cursor position - getRotatedCopy does not read one -
        which is what separates this from moveAtCursor and placeEntityContainer,
        where the check is load-bearing and stays.
    */
    public override rotatedEntities(ccw?: boolean): Entity[] {
        const result = []
        for (const [e] of this.entities) {
            result.push(e.getRotatedCopy(ccw))
        }
        return result
    }

    public override flippedEntities(vertical: boolean): Entity[] {
        const result = []
        for (const [e] of this.entities) {
            result.push(e.getFlippedCopy(vertical))
        }
        return result
    }

    public override moveAtCursor(): void {
        if (!this.visible) return

        const firstRailPosHere = this.bp.getFirstRailRelatedEntityPos()
        const firstRailPosInBP = this.bpc.bp.getFirstRailRelatedEntityPos()

        if (firstRailPosHere && firstRailPosInBP) {
            const frX = this.bpc.gridData.x32 + firstRailPosHere.x
            const frY = this.bpc.gridData.y32 + firstRailPosHere.y

            // grid offsets
            const oX = -Math.abs((Math.abs(frX) % 2) - (Math.abs(firstRailPosInBP.x - 1) % 2)) + 1
            const oY = -Math.abs((Math.abs(frY) % 2) - (Math.abs(firstRailPosInBP.y - 1) % 2)) + 1

            this.setPosition({
                x: (this.bpc.gridData.x32 + oX) * 32,
                y: (this.bpc.gridData.y32 + oY) * 32,
            })
        } else {
            this.setPosition({
                x: this.bpc.gridData.x32 * 32,
                y: this.bpc.gridData.y32 * 32,
            })
        }

        for (const [, c] of this.entities) {
            c.moveAtCursor()
        }
    }

    protected override redraw(): void {}

    public override placeEntityContainer(): void {
        if (!this.visible) return

        /*
            Two loops, and they must stay two (issue #163). Every entity is
            decided against the destination grid as it stands *now*, before the
            first placement mutates it, so the entities inside one paste cannot
            block one another - which is what makes the paste order-independent
            and what makes it agree with the green preview the user just saw.

            Collapsing this to `container.placeEntityContainer(container.planPlacement())`
            inside the loop below type-checks and reads as a pure simplification.
            It is the bug: from the second entity on, the plan is made against a
            grid the previous placement has already changed, and an overlapping
            pair the editor's rectangles disagree about - two curved rails the
            game accepts two tiles apart - loses its second entity silently.

            Making `placement` a required parameter stops a caller *forgetting*
            to plan. It cannot stop a caller planning in the wrong place, which
            is the regression, so the reason lives here.
        */
        const placements = [...this.entities].map(
            ([entity, container]) => [entity, container, container.planPlacement()] as const
        )

        this.bpc.bp.history.startTransaction('Create Entities')

        const oldEntIDToNewEntID = new Map<number, number>()
        for (const [entity, container, placement] of placements) {
            const e = container.placeEntityContainer(placement)
            if (e) {
                oldEntIDToNewEntID.set(entity.entityNumber, e.entityNumber)
            }
        }

        // Create wire connections
        if (oldEntIDToNewEntID.size !== 0) {
            for (const [oldID] of oldEntIDToNewEntID) {
                this.bp.wireConnections
                    .getEntityConnections(oldID)
                    .flatMap<IConnection>(connection => {
                        const en0 = oldEntIDToNewEntID.get(connection.cps[0].entityNumber)
                        const en1 = oldEntIDToNewEntID.get(connection.cps[1].entityNumber)
                        // only copy a wire when both of its ends were pasted
                        if (en0 === undefined || en1 === undefined) return []
                        return [
                            {
                                ...connection,
                                cps: [
                                    { ...connection.cps[0], entityNumber: en0 },
                                    { ...connection.cps[1], entityNumber: en1 },
                                ],
                            },
                        ]
                    })
                    .forEach(conn => this.bpc.bp.wireConnections.create(conn))
            }
        }

        this.bpc.bp.history.commitTransaction()
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        this.bpc.bp.history.startTransaction('Remove Entities')
        for (const [, c] of this.entities) {
            c.removeContainerUnder()
        }
        this.bpc.bp.history.commitTransaction()
    }
}
