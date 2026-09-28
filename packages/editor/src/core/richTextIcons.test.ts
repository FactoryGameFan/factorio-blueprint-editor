import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { loadData } from './factorioData'
import { iconTagSource, splitRichTextIcons } from './richTextIcons'

describe('splitRichTextIcons', () => {
    it('leaves a name with no tags as one text run', () => {
        expect(splitRichTextIcons('Iron Pickup')).toEqual([{ kind: 'text', text: 'Iron Pickup' }])
    })

    it('splits icon tags out of the text around them, in order', () => {
        expect(splitRichTextIcons('[S] [virtual-signal=signal-fuel] Service')).toEqual([
            { kind: 'text', text: '[S] ' },
            {
                kind: 'icon',
                type: 'virtual-signal',
                name: 'signal-fuel',
                source: '[virtual-signal=signal-fuel]',
            },
            { kind: 'text', text: ' Service' },
        ])
    })

    it('drops what follows the name, such as a quality', () => {
        expect(splitRichTextIcons('[item=iron-plate,quality=rare]')).toEqual([
            {
                kind: 'icon',
                type: 'item',
                name: 'iron-plate',
                source: '[item=iron-plate,quality=rare]',
            },
        ])
    })

    it('handles adjacent tags and every drawable type', () => {
        expect(
            splitRichTextIcons('[item=a][fluid=b][recipe=c][entity=d]').map(r =>
                r.kind === 'icon' ? `${r.type}:${r.name}` : r.text
            )
        ).toEqual(['item:a', 'fluid:b', 'recipe:c', 'entity:d'])
    })

    it('keeps tags it cannot draw as text', () => {
        expect(splitRichTextIcons('[gps=1,2] [color=red]x[/color]')).toEqual([
            { kind: 'text', text: '[gps=1,2] [color=red]x[/color]' },
        ])
        // No planet, space-location or quality prototypes in data.json to draw.
        const noPrototype = '[planet=nauvis] [space-location=solar-system-edge] [quality=rare]'
        expect(splitRichTextIcons(noPrototype)).toEqual([{ kind: 'text', text: noPrototype }])
    })
})

/*
    The shapes below are the real ones out of data.json, cut down to the icon
    fields. `pentapod-egg` is an item and a recipe with icons of their own,
    which differ. `straight-rail` is an entity with no item of that name - the item
    that places it is `rail`. `fluoroketone` is a recipe with no icon of its
    own and a single fluid product, so it draws the product's.
*/
beforeAll(() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    loadData(
        JSON.stringify({
            items: {
                'pentapod-egg': { name: 'pentapod-egg', icon: 'pentapod-egg.png' },
                rail: { name: 'rail', icon: 'item/rail.png' },
            },
            fluids: {
                'fluoroketone-hot': { name: 'fluoroketone-hot', icon: 'fluid/hot.png' },
            },
            signals: {
                'signal-fuel': { name: 'signal-fuel', icon: 'signal/fuel.png' },
            },
            recipes: {
                'pentapod-egg': { name: 'pentapod-egg', icon: 'pentapod-egg-3.png' },
                fluoroketone: {
                    name: 'fluoroketone',
                    results: [{ type: 'fluid', name: 'fluoroketone-hot', amount: 50 }],
                },
            },
            entities: {
                'straight-rail': { name: 'straight-rail', icon: 'entity/rail.png' },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: {},
        })
    )
    log.mockRestore()
})

describe('iconTagSource', () => {
    const icon = (...args: Parameters<typeof iconTagSource>) => iconTagSource(...args)?.icon

    it('looks a name up only in the collection its tag type names', () => {
        expect(icon('item', 'pentapod-egg')).toBe('pentapod-egg.png')
        expect(icon('recipe', 'pentapod-egg')).toBe('pentapod-egg-3.png')
        expect(icon('virtual-signal', 'signal-fuel')).toBe('signal/fuel.png')
        expect(icon('fluid', 'fluoroketone-hot')).toBe('fluid/hot.png')
    })

    it('draws an entity from the entity, with or without an item of its name', () => {
        expect(icon('entity', 'straight-rail')).toBe('entity/rail.png')
        expect(icon('item', 'straight-rail')).toBeUndefined()
        // An item is not an entity: no fallback across collections.
        expect(icon('entity', 'rail')).toBeUndefined()
        expect(icon('entity', 'character')).toBeUndefined()
    })

    it("gives a recipe with no icon of its own its product's", () => {
        expect(icon('recipe', 'fluoroketone')).toBe('fluid/hot.png')
        expect(icon('fluid', 'fluoroketone')).toBeUndefined()
    })
})
