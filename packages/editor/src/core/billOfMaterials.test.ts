import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { billOfMaterials, materialAmountLabel } from './billOfMaterials'
import { loadData } from './factorioData'

/*
    Real prototypes, cut down to the fields the tally reads: `minable` and
    `placeable_by` on entities, `place_result` on items, `minable` on tiles.
    The rail numbers are data.json's own - a curved-rail-a is placed by 3 rail
    and a half-diagonal-rail by 2 - and `red-chest` is one of the 18 entities
    no item places.
*/
beforeAll(() => {
    loadData(
        JSON.stringify({
            items: {
                'wooden-chest': { name: 'wooden-chest', place_result: 'wooden-chest' },
                'transport-belt': { name: 'transport-belt', place_result: 'transport-belt' },
                rail: { name: 'rail', place_result: 'straight-rail' },
            },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'wooden-chest': { name: 'wooden-chest', minable: { result: 'wooden-chest' } },
                'transport-belt': {
                    name: 'transport-belt',
                    minable: { result: 'transport-belt' },
                },
                'straight-rail': {
                    name: 'straight-rail',
                    minable: { result: 'rail' },
                    placeable_by: { item: 'rail', count: 1 },
                },
                'curved-rail-a': {
                    name: 'curved-rail-a',
                    minable: { result: 'rail', count: 3 },
                    placeable_by: { item: 'rail', count: 3 },
                },
                'half-diagonal-rail': {
                    name: 'half-diagonal-rail',
                    minable: { result: 'rail', count: 2 },
                    placeable_by: { item: 'rail', count: 2 },
                },
                'red-chest': { name: 'red-chest' },
            },
            tiles: {
                concrete: { name: 'concrete', minable: { result: 'concrete' } },
                'hazard-concrete-left': {
                    name: 'hazard-concrete-left',
                    minable: { result: 'hazard-concrete' },
                },
                'hazard-concrete-right': {
                    name: 'hazard-concrete-right',
                    minable: { result: 'hazard-concrete' },
                },
                landfill: { name: 'landfill' },
            },
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: {},
        })
    )
})

/** Entities of normal quality, by name - most cases below do not care about quality. */
const named = (...names: string[]): { name: string }[] => names.map(name => ({ name }))

describe('billOfMaterials', () => {
    it('counts entities per item, most first', () => {
        const bom = billOfMaterials(
            named(
                'transport-belt',
                'wooden-chest',
                'transport-belt',
                'transport-belt',
                'wooden-chest'
            ),
            []
        )
        expect(bom.entities).toEqual([
            { name: 'transport-belt', count: 3 },
            { name: 'wooden-chest', count: 2 },
        ])
        expect(bom.tiles).toEqual([])
    })

    it('folds every rail shape into rail, at what each one costs to place', () => {
        // 1 + 3 + 3 + 2: counting pieces instead would read 4.
        const bom = billOfMaterials(
            named('straight-rail', 'curved-rail-a', 'curved-rail-a', 'half-diagonal-rail'),
            []
        )
        expect(bom.entities).toEqual([{ name: 'rail', count: 9 }])
    })

    it('lists an entity no item places under its own name rather than dropping it', () => {
        const bom = billOfMaterials(named('red-chest', 'wooden-chest', 'red-chest'), [])
        expect(bom.entities).toEqual([
            { name: 'red-chest', count: 2 },
            { name: 'wooden-chest', count: 1 },
        ])
    })

    it('keeps tiles in their own list, per item', () => {
        const bom = billOfMaterials(named('wooden-chest'), [
            'hazard-concrete-left',
            'concrete',
            'hazard-concrete-right',
            'hazard-concrete-left',
            'landfill',
        ])
        expect(bom.entities).toEqual([{ name: 'wooden-chest', count: 1 }])
        expect(bom.tiles).toEqual([
            { name: 'hazard-concrete', count: 3 },
            { name: 'concrete', count: 1 },
            { name: 'landfill', count: 1 },
        ])
    })

    it('breaks a tie in count by name, so the order does not depend on the input', () => {
        const a = billOfMaterials(named('wooden-chest', 'transport-belt'), ['landfill', 'concrete'])
        const b = billOfMaterials(named('transport-belt', 'wooden-chest'), ['concrete', 'landfill'])
        expect(a).toEqual(b)
        expect(a.entities.map(e => e.name)).toEqual(['transport-belt', 'wooden-chest'])
        expect(a.tiles.map(t => t.name)).toEqual(['concrete', 'landfill'])
    })

    it('keeps each quality of an item on its own line, and normal is no quality', () => {
        const bom = billOfMaterials(
            [
                { name: 'wooden-chest', quality: 'legendary' },
                { name: 'wooden-chest' },
                { name: 'wooden-chest', quality: 'normal' },
                { name: 'wooden-chest', quality: 'uncommon' },
                { name: 'curved-rail-a', quality: 'legendary' },
            ],
            []
        )
        expect(bom.entities).toEqual([
            { name: 'rail', quality: 'legendary', count: 3 },
            { name: 'wooden-chest', count: 2 },
            { name: 'wooden-chest', quality: 'uncommon', count: 1 },
            { name: 'wooden-chest', quality: 'legendary', count: 1 },
        ])
    })
})

describe('materialAmountLabel', () => {
    it('is exact up to four digits', () => {
        expect(materialAmountLabel(1)).toBe('1')
        expect(materialAmountLabel(1535)).toBe('1535')
        expect(materialAmountLabel(1999)).toBe('1999')
        expect(materialAmountLabel(9999)).toBe('9999')
    })

    it('goes to three significant figures past that, rounded down', () => {
        expect(materialAmountLabel(10_000)).toBe('10.0k')
        expect(materialAmountLabel(10_300)).toBe('10.3k')
        expect(materialAmountLabel(12_345)).toBe('12.3k')
        // Down, so the last tenth below a boundary does not roll over to it.
        expect(materialAmountLabel(99_999)).toBe('99.9k')
        expect(materialAmountLabel(100_000)).toBe('100k')
        expect(materialAmountLabel(123_456)).toBe('123k')
        expect(materialAmountLabel(999_999)).toBe('999k')
        expect(materialAmountLabel(1_000_000)).toBe('1.00M')
        expect(materialAmountLabel(1_259_999)).toBe('1.25M')
        expect(materialAmountLabel(12_345_678)).toBe('12.3M')
    })

    it('is never wider than five characters below a billion', () => {
        for (const n of [9999, 10_000, 99_999, 100_000, 999_999, 1_000_000, 999_999_999]) {
            expect(materialAmountLabel(n).length).toBeLessThanOrEqual(5)
        }
    })
})
