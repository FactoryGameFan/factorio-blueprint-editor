import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import { loadData } from './factorioData'

/*
    Entity.relocate with a direction: the position grid has to hold the
    footprint the entity has *after* the write, in both directions of history.

    A mirror can transpose a footprint - a 1x3 pump facing north becomes 3x1
    facing east - and the grid sizes its cells from the entity's current
    direction. Writing the position and the direction as two independent
    steps therefore leaves whichever step ran first sized wrongly, and undo
    runs them in the other order, so it cannot be fixed by ordering alone.
    Grid arithmetic only, so vitest and a two-prototype dataset are enough;
    the mirror that calls it is tests/persistent-selection.spec.ts.
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
                // 1 wide, 3 tall at north; 3 wide, 1 tall at east
                pump: {
                    type: 'pump',
                    name: 'pump',
                    collision_box: [
                        [-0.4, -1.4],
                        [0.4, 1.4],
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

const entityOf = (bp: Blueprint, entityNumber: number): Entity => {
    const entity = bp.entities.get(entityNumber)
    if (entity === undefined) throw new Error(`no entity ${entityNumber} in this blueprint`)
    return entity
}

/** Every tile of a 9x9 window around the origin that the grid says the entity covers. */
const cellsHolding = (bp: Blueprint, entity: Entity): string[] => {
    const cells: string[] = []
    for (let x = -4; x < 5; x++) {
        for (let y = -4; y < 5; y++) {
            if (bp.entityPositionGrid.getEntityAtPosition({ x: x + 0.5, y: y + 0.5 }) === entity) {
                cells.push(`${x},${y}`)
            }
        }
    }
    return cells.sort()
}

/** The tiles the entity's own position and size say it covers. */
const footprintOf = (entity: Entity): string[] => {
    const cells: string[] = []
    const { x: w, y: h } = entity.size
    for (let x = entity.position.x - w / 2; x < entity.position.x + w / 2; x++) {
        for (let y = entity.position.y - h / 2; y < entity.position.y + h / 2; y++) {
            cells.push(`${Math.floor(x)},${Math.floor(y)}`)
        }
    }
    return cells.sort()
}

const pumpFacingNorth = (): Blueprint =>
    new Blueprint({
        entities: [{ entity_number: 1, name: 'pump', position: { x: 0.5, y: 1.5 }, direction: 0 }],
    })

describe('relocate with a direction keeps the grid in step with the footprint', () => {
    it('holds the transposed footprint after the write', () => {
        const bp = pumpFacingNorth()
        const pump = entityOf(bp, 1)
        expect(pump.size).toEqual({ x: 1, y: 3 })
        expect(cellsHolding(bp, pump)).toEqual(footprintOf(pump))

        const target = { x: pump.position.x + 1, y: pump.position.y - 1 }
        bp.history.transaction('turn', () => pump.relocate(target, 4))

        expect(pump.direction).toBe(4)
        expect(pump.position).toEqual(target)
        expect(pump.size).toEqual({ x: 3, y: 1 })
        expect(cellsHolding(bp, pump)).toEqual(footprintOf(pump))
    })

    it('holds the original footprint again after undo, and the turned one after redo', () => {
        const bp = pumpFacingNorth()
        const pump = entityOf(bp, 1)
        const before = footprintOf(pump)

        const target = { x: pump.position.x + 1, y: pump.position.y - 1 }
        bp.history.transaction('turn', () => pump.relocate(target, 4))
        const after = footprintOf(pump)

        bp.history.undo()
        expect(pump.direction).toBe(0)
        expect(cellsHolding(bp, pump)).toEqual(before)

        bp.history.redo()
        expect(pump.direction).toBe(4)
        expect(cellsHolding(bp, pump)).toEqual(after)
    })

    it('is one undo step for position and direction together', () => {
        const bp = pumpFacingNorth()
        const pump = entityOf(bp, 1)
        // the constructor recentres, so read the start back rather than assuming it
        const start = { ...pump.position }
        const revision = bp.history.revision

        bp.history.transaction('turn', () => pump.relocate({ x: start.x + 1, y: start.y - 1 }, 4))
        expect(bp.history.revision).toBe(revision + 1)

        bp.history.undo()
        expect(pump.direction).toBe(0)
        expect(pump.position).toEqual(start)
    })

    it('leaves a same-direction relocate as it was', () => {
        const bp = pumpFacingNorth()
        const pump = entityOf(bp, 1)
        bp.history.transaction('shift', () => pump.relocate({ x: 2.5, y: 1.5 }, 0))
        expect(pump.direction).toBe(0)
        expect(cellsHolding(bp, pump)).toEqual(footprintOf(pump))
    })
})
