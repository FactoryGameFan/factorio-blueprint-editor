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
    })

    it('splits planet, space-location and quality tags out as icons (#652)', () => {
        expect(
            splitRichTextIcons('[planet=nauvis] [space-location=solar-system-edge] [quality=rare]')
        ).toEqual([
            { kind: 'icon', type: 'planet', name: 'nauvis', source: '[planet=nauvis]' },
            { kind: 'text', text: ' ' },
            {
                kind: 'icon',
                type: 'space-location',
                name: 'solar-system-edge',
                source: '[space-location=solar-system-edge]',
            },
            { kind: 'text', text: ' ' },
            { kind: 'icon', type: 'quality', name: 'rare', source: '[quality=rare]' },
        ])
    })

    it('leaves an unclosed tag as text', () => {
        expect(splitRichTextIcons('[item=a,b')).toEqual([{ kind: 'text', text: '[item=a,b' }])
    })

    it('matches a tag that starts inside an unclosed one', () => {
        expect(
            splitRichTextIcons('[item=[item=a]').map(r => (r.kind === 'icon' ? r.source : r.text))
        ).toEqual(['[item=', '[item=a]'])
    })

    /*
        The shapes CodeQL reported (js/polynomial-redos). Under the earlier
        pattern the first took 27 s at this length; both now take well under a
        millisecond. The bound is loose so a slow CI runner cannot trip it.
    */
    it.each([
        ['repeated unclosed tags', '[item='.repeat(2000)],
        ['one unclosed tag with a long name', '[item=' + '+'.repeat(60000)],
    ])('splits %s in linear time', (_, text) => {
        const start = performance.now()
        expect(splitRichTextIcons(text)).toEqual([{ kind: 'text', text }])
        expect(performance.now() - start).toBeLessThan(250)
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
            spaceLocations: {
                nauvis: { type: 'planet', name: 'nauvis', icon: 'planet/nauvis.png' },
                'solar-system-edge': {
                    type: 'space-location',
                    name: 'solar-system-edge',
                    icon: 'location/edge.png',
                },
            },
            qualities: { rare: { type: 'quality', name: 'rare', icon: 'quality/rare.png' } },
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

    it('draws a planet, a space location and a quality from their own collections (#652)', () => {
        expect(icon('planet', 'nauvis')).toBe('planet/nauvis.png')
        expect(icon('space-location', 'nauvis')).toBe('planet/nauvis.png')
        expect(icon('space-location', 'solar-system-edge')).toBe('location/edge.png')
        expect(icon('quality', 'rare')).toBe('quality/rare.png')
    })

    it('does not cross collections, and a planet tag needs a planet', () => {
        expect(icon('planet', 'solar-system-edge')).toBeUndefined()
        expect(icon('quality', 'nauvis')).toBeUndefined()
        expect(icon('space-location', 'rare')).toBeUndefined()
        // Unknown names give no icon, so the caller prints the tag as typed.
        expect(icon('planet', 'no-such-planet')).toBeUndefined()
        expect(icon('quality', 'no-such-quality')).toBeUndefined()
    })
})
