import { afterEach, expect, it, vi } from 'vite-plus/test'
import G from '../common/globals'
import { EntityContainer } from './EntityContainer'
import { EntitySprite } from './EntitySprite'

vi.mock('../common/globals', () => ({ default: { BPC: {}, bp: {} } }))
afterEach(() => vi.restoreAllMocks())

it('defers every redraw route, including neighbouring entities, while preserving explicit sort', () => {
    const addEntitySprites = vi.fn()
    Object.assign(G.BPC, { sortDeferred: true, addEntitySprites })
    vi.spyOn(EntitySprite, 'getParts').mockReturnValue([])
    const container = { entitySprites: [], position: { x: 0, y: 0 } } as unknown as EntityContainer
    EntityContainer.prototype.redraw.call(container)
    expect(addEntitySprites).toHaveBeenLastCalledWith([], false)
    Object.assign(G.BPC, { sortDeferred: false })
    EntityContainer.prototype.redraw.call(container)
    expect(addEntitySprites).toHaveBeenLastCalledWith([], true)
    EntityContainer.prototype.redraw.call(container, false, false)
    expect(addEntitySprites).toHaveBeenLastCalledWith([], false)
})
