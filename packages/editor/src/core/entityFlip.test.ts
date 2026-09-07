import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import { loadData } from './factorioData'

/*
    Entity.getFlippedCopy's splitter input/output priority swap.
    BlueprintContainer.mirrorSelection is the one caller that writes the
    result onto a committed, live entity; PaintBlueprintContainer's
    carried-group flip is the other.

    The swap used to be conditional on the *new* direction landing in one
    specific pair per axis ({4, 8} vertical, {0, 12} horizontal) - true only
    when the *old* direction was 0 or 4, since the new direction is
    `(axisDir * 2 - old) % 16`. A reflection always reverses chirality, so the
    swap has to fire every time, regardless of which way the entity ends up
    facing - the old guard silently left "left" as "left" (or "right" as
    "right") for the other two starting directions, the mirror image of where
    the priority belongs. Flipping twice must return to the start, which the
    old guard also did not do.
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
                splitter: {
                    type: 'splitter',
                    name: 'splitter',
                    collision_box: [
                        [-1, -0.5],
                        [1, 0.5],
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

const NORTH = 0
const EAST = 4
const SOUTH = 8
const WEST = 12

/** A single splitter, facing `direction`, with `output_priority` set directly. */
const splitterAt = (direction: number, output_priority: 'left' | 'right'): Entity => {
    const bp = new Blueprint({
        entities: [
            {
                entity_number: 1,
                name: 'splitter',
                position: { x: 0.5, y: 0.5 },
                direction,
                output_priority,
            },
        ],
    })
    const entity = bp.entities.get(1)
    if (entity === undefined) throw new Error('splitter did not round-trip into the blueprint')
    return entity
}

describe("getFlippedCopy always reverses a splitter's priority", () => {
    const directions = [
        { direction: NORTH, name: 'north' },
        { direction: EAST, name: 'east' },
        { direction: SOUTH, name: 'south' },
        { direction: WEST, name: 'west' },
    ]

    for (const { direction, name } of directions) {
        it(`vertical flip swaps a ${name}-facing splitter's priority`, () => {
            const flipped = splitterAt(direction, 'left').getFlippedCopy(true)
            expect(flipped.splitterOutputPriority).toBe('right')
        })

        it(`horizontal flip swaps a ${name}-facing splitter's priority`, () => {
            const flipped = splitterAt(direction, 'left').getFlippedCopy(false)
            expect(flipped.splitterOutputPriority).toBe('right')
        })
    }

    it('flipping twice returns to the original priority', () => {
        const once = splitterAt(SOUTH, 'left').getFlippedCopy(true)
        const twice = once.getFlippedCopy(true)
        expect(twice.splitterOutputPriority).toBe('left')
    })

    it('a priority-less splitter stays priority-less', () => {
        const flipped = splitterAt(SOUTH, undefined as unknown as 'left').getFlippedCopy(true)
        expect(flipped.splitterOutputPriority).toBeUndefined()
    })
})
