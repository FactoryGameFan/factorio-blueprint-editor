import { beforeAll, expect, it, vi } from 'vite-plus/test'
import { Sprite, Texture } from 'pixi.js'
import G from '../../common/globals'
import { loadData } from '../../core/factorioData'
import F from './functions'

vi.mock('../../common/globals', () => ({
    default: { getTexture: vi.fn(() => Texture.EMPTY) },
}))

/*
    CreateIcon's last fallback, FD.entities (#342). The bill of materials lists
    an entity no item places under the entity's own name, and without that
    fallback the name resolves to nothing: the dialog's slot draws it through
    `F.SafeIcon`, which catches the throw and leaves the slot empty with only a
    console warning, so nothing else would notice it going. Measured: with the
    fallback removed, the first case fails and the second passes. `red-chest` is one
    of those entities, cut down to the icon fields data.json gives it; the chest
    beside it checks that an item of the same name still answers first.
*/
beforeAll(() => {
    loadData(
        JSON.stringify({
            items: {
                'wooden-chest': {
                    name: 'wooden-chest',
                    icon: '__base__/graphics/icons/wooden-chest.png',
                },
            },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'wooden-chest': { name: 'wooden-chest', icon: 'entity-icon-not-used.png' },
                'red-chest': {
                    name: 'red-chest',
                    icon: '__base__/graphics/icons/passive-provider-chest.png',
                },
            },
            tiles: {},
            inventoryLayout: [],
        })
    )
})

it('draws the icon of an entity that no item places', () => {
    const icon = F.CreateIcon('red-chest')
    expect(icon).toBeInstanceOf(Sprite)
    expect(G.getTexture).toHaveBeenLastCalledWith(
        '__base__/graphics/icons/passive-provider-chest.png',
        0,
        0,
        64,
        64
    )
})

it('still prefers an item over an entity of the same name', () => {
    F.CreateIcon('wooden-chest')
    expect(G.getTexture).toHaveBeenLastCalledWith(
        '__base__/graphics/icons/wooden-chest.png',
        0,
        0,
        64,
        64
    )
})
