import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Entity } from './Entity'
import { loadData } from './factorioData'

/*
    `Entity.getItemName` answers "which item places this entity?", and data.json
    holds four shapes of answer (issue #367). Each entity below is a real one
    with its real fields, cut down to the two the lookup reads.

    - `wooden-chest`: mined into and placed by the same item, as 134 of the 155
      entities are.
    - `curved-rail-a`: mines into `rail`, and no item places it - the rail
      planner does. One of 9 such rails. `minable.result` is the only answer.
    - `captive-biter-spawner`: `minable: null`, placed by the item of the same
      name. The `place_result` fallback is the only answer.
    - `red-chest`: neither. One of 18. Undefined is the answer.

    `car` is an item with a `place_result` and no entity behind it, which the
    exporter does not carry. An unknown entity stays unknown rather than
    borrowing the item's name.
*/
beforeAll(() => {
    loadData(
        JSON.stringify({
            items: {
                'wooden-chest': { name: 'wooden-chest', place_result: 'wooden-chest' },
                rail: { name: 'rail', place_result: 'straight-rail' },
                'captive-biter-spawner': {
                    name: 'captive-biter-spawner',
                    place_result: 'captive-biter-spawner',
                },
                car: { name: 'car', place_result: 'car' },
            },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'wooden-chest': { name: 'wooden-chest', minable: { result: 'wooden-chest' } },
                'straight-rail': { name: 'straight-rail', minable: { result: 'rail' } },
                'curved-rail-a': { name: 'curved-rail-a', minable: { result: 'rail' } },
                'captive-biter-spawner': { name: 'captive-biter-spawner', minable: null },
                'red-chest': { name: 'red-chest' },
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

describe('Entity.getItemName', () => {
    it('answers the mining result where the two relations agree', () => {
        expect(Entity.getItemName('wooden-chest')).toBe('wooden-chest')
    })

    it('keeps the mining result for a planner-placed rail no item places', () => {
        // The case that makes this a fallback rather than a swap: `place_result`
        // alone answers undefined here and would trade 2 broken entities for 9.
        expect(Entity.getItemName('curved-rail-a')).toBe('rail')
    })

    it('falls back to the item whose place_result is the entity (issue #367)', () => {
        expect(Entity.getItemName('captive-biter-spawner')).toBe('captive-biter-spawner')
    })

    it('answers undefined for an entity nothing mines into or places', () => {
        expect(Entity.getItemName('red-chest')).toBeUndefined()
    })

    it('answers undefined for a name that is not an entity, even one an item places', () => {
        expect(Entity.getItemName('car')).toBeUndefined()
    })
})
