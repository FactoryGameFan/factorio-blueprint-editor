import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { ISignal } from '../types'
import { encode, getAndClearLoadWarnings, getBlueprintOrBookFromSource } from './bpString'
import { loadData } from './factorioData'

beforeAll(() => {
    // loadData permanently replaces FD's accessors. Vitest's per-file module
    // isolation keeps this synthetic dataset from leaking into other test files.
    loadData(
        JSON.stringify({
            /*
                `wooden-chest` is deliberately an item, a recipe AND an entity,
                which is the shape most placeable things really have in
                data.json. It is what makes the signal type ambiguous to a
                lookup, and so what the ordering in `deriveSignalType` is for.
            */
            items: {
                'wooden-chest': { name: 'wooden-chest', place_result: 'wooden-chest' },
                'captive-biter-spawner': {
                    name: 'captive-biter-spawner',
                    place_result: 'captive-biter-spawner',
                },
            },
            fluids: {},
            signals: {},
            recipes: {
                'wooden-chest': { name: 'wooden-chest' },
            },
            entities: {
                /*
                    `red-chest` has neither a `minable` nor an item that places
                    it, in data.json as here. `captive-biter-spawner` has no
                    `minable` either but is placed by the item above, which is
                    the shape issue #367 is about.
                */
                'red-chest': {
                    type: 'container',
                    name: 'red-chest',
                    collision_box: [
                        [-0.35, -0.35],
                        [0.35, 0.35],
                    ],
                },
                'captive-biter-spawner': {
                    type: 'unit-spawner',
                    name: 'captive-biter-spawner',
                    minable: null,
                    collision_box: [
                        [-2.2, -2.2],
                        [2.2, 2.2],
                    ],
                },
                'wooden-chest': {
                    type: 'container',
                    name: 'wooden-chest',
                    minable: { result: 'wooden-chest' },
                    collision_box: [
                        [-0.35, -0.35],
                        [0.35, 0.35],
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

describe('Blueprint icon generation', () => {
    it('round-trips with an entity icon when no item mines into or places any entity', async () => {
        const blueprint = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'red-chest',
                    position: { x: 0, y: 0 },
                },
            ],
        })

        const icons = [
            {
                index: 1,
                signal: { type: 'entity' as const, name: 'red-chest' },
            },
        ]
        expect(blueprint.serialize().icons).toEqual(icons)

        const roundTripped = await getBlueprintOrBookFromSource(await encode(blueprint))

        expect(getAndClearLoadWarnings()).toEqual([])
        expect(roundTripped.serialize().icons).toEqual(icons)
    })

    it('scores an unmineable entity by the item that places it (issue #367)', () => {
        /*
            Two spawners against two chests. Reading `minable.result` alone
            skipped the spawners, so the chests took the icon; scored, the 5x5
            spawners win. Two of each because the first occurrence of a name
            counts 0, so a lone spawner ties a lone chest at 0.

            A spawner on its own is not a test of this: with nothing scored the
            entity-name fallback above names it anyway, and `deriveSignalType`
            then finds the item, so the icon reads the same with or without the
            fix. Measured: that shape stayed green with the fix reverted.
        */
        const blueprint = new Blueprint({
            entities: [
                { entity_number: 1, name: 'captive-biter-spawner', position: { x: 2.5, y: 2.5 } },
                { entity_number: 2, name: 'captive-biter-spawner', position: { x: 7.5, y: 2.5 } },
                { entity_number: 3, name: 'wooden-chest', position: { x: 0.5, y: 6.5 } },
                { entity_number: 4, name: 'wooden-chest', position: { x: 1.5, y: 6.5 } },
            ],
        })

        expect(blueprint.serialize().icons).toEqual([
            { index: 1, signal: { type: 'item', name: 'captive-biter-spawner' } },
        ])
    })

    it('derives `item` for a name that is also a recipe', () => {
        const blueprint = new Blueprint({
            entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0, y: 0 } }],
        })

        expect(blueprint.serialize().icons).toEqual([
            { index: 1, signal: { type: 'item', name: 'wooden-chest' } },
        ])
    })
})

describe('Blueprint icon signal types', () => {
    /*
        An icon carries a signal type, and the blueprint it came from chose it.
        Re-deriving one from the name alone cannot be right in general, so a
        parsed icon keeps the type it arrived with (issue #264).
    */
    const withIcon = (signal: ISignal): Blueprint =>
        new Blueprint({
            icons: [{ index: 1, signal }],
            entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0, y: 0 } }],
        })

    it('keeps an incoming `item` type on a name that is also a recipe', () => {
        expect(withIcon({ type: 'item', name: 'wooden-chest' }).serialize().icons).toEqual([
            { index: 1, signal: { type: 'item', name: 'wooden-chest' } },
        ])
    })

    it('keeps an incoming `recipe` type rather than re-deriving it', () => {
        expect(withIcon({ type: 'recipe', name: 'wooden-chest' }).serialize().icons).toEqual([
            { index: 1, signal: { type: 'recipe', name: 'wooden-chest' } },
        ])
    })

    it('keeps a `space-location` type for a name no FD collection holds', () => {
        // Planets are in none of data.json's eleven collections, so a lookup
        // cannot classify one. Preserving the incoming type is what saves it.
        expect(withIcon({ type: 'space-location', name: 'nauvis' }).serialize().icons).toEqual([
            { index: 1, signal: { type: 'space-location', name: 'nauvis' } },
        ])
    })

    it('keeps an omitted type omitted', () => {
        /*
            Factorio leaves `type` out for an item icon, and does so for 383 of
            the corpus's 1034 icons. Writing one back in is what turned those
            into `recipe`, so the absence has to survive too - preserving only
            the present types would still rewrite more than a third of them.
        */
        expect(withIcon({ name: 'wooden-chest' }).serialize().icons).toEqual([
            { index: 1, signal: { name: 'wooden-chest' } },
        ])
    })

    it('round-trips a preserved type through encode and decode', async () => {
        const bp = withIcon({ type: 'item', name: 'wooden-chest' })
        const back = await getBlueprintOrBookFromSource(await encode(bp))
        expect(getAndClearLoadWarnings()).toEqual([])
        expect(back.serialize().icons).toEqual([
            { index: 1, signal: { type: 'item', name: 'wooden-chest' } },
        ])
    })
})
