import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
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
            },
            fluids: {},
            signals: {},
            recipes: {
                'wooden-chest': { name: 'wooden-chest' },
            },
            entities: {
                'space-platform-hub': {
                    type: 'space-platform-hub',
                    name: 'space-platform-hub',
                    collision_box: [
                        [-1, -1],
                        [1, 1],
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
    it('round-trips with an entity icon when every entity is non-minable', async () => {
        const blueprint = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'space-platform-hub',
                    position: { x: 0, y: 0 },
                },
            ],
        })

        const icons = [
            {
                index: 1,
                signal: { type: 'entity' as const, name: 'space-platform-hub' },
            },
        ]
        expect(blueprint.serialize().icons).toEqual(icons)

        const roundTripped = await getBlueprintOrBookFromSource(await encode(blueprint))

        expect(getAndClearLoadWarnings()).toEqual([])
        expect(roundTripped.serialize().icons).toEqual(icons)
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
    const withIcon = (signal: { type?: string; name: string }): Blueprint =>
        new Blueprint({
            icons: [{ index: 1, signal }],
            entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0, y: 0 } }],
        } as never)

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
