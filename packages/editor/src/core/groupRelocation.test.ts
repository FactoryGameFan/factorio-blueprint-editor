import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { IPoint } from '../types'
import { Blueprint } from './Blueprint'
import { loadData } from './factorioData'

/*
    PositionGrid.canGroupRelocate, the check behind moving or mirroring a
    persistent selection as one unit
    (docs/superpowers/specs/2026-09-05-persistent-selection-design.md).

    canMoveTo lifts one entity out of the grid before asking whether its
    destination is free. Asked once per member of a group that is moving
    together, that refuses the group whenever a member's destination is a
    tile another member is about to vacate - two chests side by side cannot
    shift one tile along their row, and cannot trade places, even though
    either move leaves the grid exactly as valid as it found it. The group form
    lifts every member first, so only what is *not* moving can block.

    Pure grid arithmetic, so vitest and a two-prototype dataset are enough; the
    drag that calls it is tests/persistent-selection.spec.ts.
*/

beforeAll(() => {
    // loadData permanently replaces FD's accessors; vitest's per-file module
    // isolation keeps this synthetic dataset out of the other test files.
    loadData(
        JSON.stringify({
            items: {},
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'wooden-chest': {
                    type: 'container',
                    name: 'wooden-chest',
                    collision_box: [
                        [-0.35, -0.35],
                        [0.35, 0.35],
                    ],
                },
                'steel-furnace': {
                    type: 'furnace',
                    name: 'steel-furnace',
                    collision_box: [
                        [-0.7, -0.7],
                        [0.7, 0.7],
                    ],
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: {},
        })
    )
})

interface Placement {
    name: string
    x: number
    y: number
}

/**
 * A blueprint numbered from 1 in the order given. The constructor recentres
 * everything, so only the offsets between placements survive - every case
 * below reads positions back rather than using the literals.
 */
const blueprintOf = (...placements: Placement[]): Blueprint =>
    new Blueprint({
        entities: placements.map((p, i) => ({
            entity_number: i + 1,
            name: p.name,
            position: { x: p.x, y: p.y },
        })),
    })

const entityOf = (bp: Blueprint, entityNumber: number) => {
    const entity = bp.entities.get(entityNumber)
    if (entity === undefined) throw new Error(`no entity ${entityNumber} in this blueprint`)
    return entity
}

const shifted = (bp: Blueprint, entityNumbers: number[], delta: IPoint) =>
    entityNumbers.map(n => {
        const entity = entityOf(bp, n)
        return {
            entity,
            position: { x: entity.position.x + delta.x, y: entity.position.y + delta.y },
            direction: entity.direction,
        }
    })

/** Two chests side by side, then a third two tiles further along the row. */
const ROW = (): Blueprint =>
    blueprintOf(
        { name: 'wooden-chest', x: 0.5, y: 0.5 },
        { name: 'wooden-chest', x: 1.5, y: 0.5 },
        { name: 'wooden-chest', x: 3.5, y: 0.5 }
    )

describe('canGroupRelocate lifts the whole group before asking', () => {
    it('lets two adjacent entities shift along their row together', () => {
        const bp = ROW()
        const grid = bp.entityPositionGrid

        // The single-entity check refuses: chest 2 is in chest 1's way.
        expect(grid.canMoveTo(entityOf(bp, 1), shifted(bp, [1], { x: 1, y: 0 })[0].position)).toBe(
            false
        )
        expect(grid.canGroupRelocate(shifted(bp, [1, 2], { x: 1, y: 0 }))).toBe(true)
    })

    it('lets two entities trade places', () => {
        const bp = ROW()
        const a = entityOf(bp, 1)
        const b = entityOf(bp, 2)

        expect(
            bp.entityPositionGrid.canGroupRelocate([
                { entity: a, position: { ...b.position }, direction: a.direction },
                { entity: b, position: { ...a.position }, direction: b.direction },
            ])
        ).toBe(true)
    })

    it('still refuses a destination held by something outside the group', () => {
        const bp = ROW()
        // Shifting chests 1 and 2 by two lands chest 2 on chest 3, which stays put.
        expect(bp.entityPositionGrid.canGroupRelocate(shifted(bp, [1, 2], { x: 2, y: 0 }))).toBe(
            false
        )
    })

    it('is a check only: every member is back in the grid afterwards, pass or fail', () => {
        const bp = ROW()
        const grid = bp.entityPositionGrid

        grid.canGroupRelocate(shifted(bp, [1, 2], { x: 1, y: 0 }))
        grid.canGroupRelocate(shifted(bp, [1, 2], { x: 2, y: 0 }))

        for (const n of [1, 2, 3]) {
            expect(grid.getEntityAtPosition(entityOf(bp, n).position)).toBe(entityOf(bp, n))
        }
    })

    it('answers true for an empty group', () => {
        expect(ROW().entityPositionGrid.canGroupRelocate([])).toBe(true)
    })

    it('reads the footprint at the target direction, not the current one', () => {
        // A 2x2 furnace beside a chest: moving the furnace one tile towards the
        // chest overlaps it whichever way the furnace faces, and the group form
        // must see that through the direction it is handed.
        const bp = blueprintOf(
            { name: 'steel-furnace', x: 1, y: 1 },
            { name: 'wooden-chest', x: 2.5, y: 0.5 }
        )
        expect(bp.entityPositionGrid.canGroupRelocate(shifted(bp, [1], { x: 1, y: 0 }))).toBe(false)
        expect(bp.entityPositionGrid.canGroupRelocate(shifted(bp, [1, 2], { x: 1, y: 0 }))).toBe(
            true
        )
    })
})
