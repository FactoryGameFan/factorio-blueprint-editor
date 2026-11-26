import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import { loadData } from './factorioData'

/*
    Entity.getFlippedCopy's splitter input/output priority swap (#387).
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

    This file came with the #387 fix (3306aa21) and was dropped by the merge
    in 90c212ac, which left eight browser rows in
    tests/persistent-selection.spec.ts as the only guard. Two of those rows
    stay, for the keypress reaching mirrorSelection and its write-back onto
    the live entity; the per-direction table lives here.
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

/** A single splitter facing `direction`, with both priorities set directly. */
const splitterAt = (
    direction: number,
    priorities: { input_priority?: 'left' | 'right'; output_priority?: 'left' | 'right' }
): Entity => {
    const bp = new Blueprint({
        entities: [
            {
                entity_number: 1,
                name: 'splitter',
                position: { x: 0.5, y: 0.5 },
                // Omitted at 0, as an exported blueprint writes it.
                ...(direction === 0 ? {} : { direction }),
                ...priorities,
            },
        ],
    })
    const entity = bp.entities.get(1)
    if (entity === undefined) throw new Error('splitter did not round-trip into the blueprint')
    return entity
}

/** Everything a flip changes on a splitter. */
const flipState = (e: Entity) => ({
    direction: e.direction,
    position: e.rawEntity.position,
    input: e.splitterInputPriority,
    output: e.splitterOutputPriority,
})

/*
    Where each starting direction lands. Vertical is Shift+G in the editor,
    horizontal Shift+F; the same arrays the browser rows used.
*/
const AXES = [
    { vertical: true, name: 'vertical', lands: { 0: 8, 4: 4, 8: 0, 12: 12 } },
    { vertical: false, name: 'horizontal', lands: { 0: 0, 4: 12, 8: 8, 12: 4 } },
] as const

describe("getFlippedCopy always reverses a splitter's priorities", () => {
    for (const { vertical, name, lands } of AXES) {
        for (const direction of [0, 4, 8, 12] as const) {
            it(`${name} flip at direction ${direction} lands on ${lands[direction]} and swaps both priorities`, () => {
                const flipped = splitterAt(direction, {
                    input_priority: 'right',
                    output_priority: 'left',
                }).getFlippedCopy(vertical)

                expect(flipped.direction).toBe(lands[direction])
                expect(flipped.splitterInputPriority).toBe('left')
                expect(flipped.splitterOutputPriority).toBe('right')
            })

            it(`a second ${name} flip at direction ${direction} restores the splitter`, () => {
                const start = splitterAt(direction, {
                    input_priority: 'right',
                    output_priority: 'left',
                })
                const twice = start.getFlippedCopy(vertical).getFlippedCopy(vertical)

                expect(flipState(twice)).toEqual(flipState(start))
            })
        }
    }

    it('a priority-less splitter stays priority-less', () => {
        const flipped = splitterAt(8, {}).getFlippedCopy(true)
        expect(flipped.splitterInputPriority).toBeUndefined()
        expect(flipped.splitterOutputPriority).toBeUndefined()
    })
})
