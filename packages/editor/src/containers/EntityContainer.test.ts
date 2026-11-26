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

    /*
        The neighbour route: an entity redraws the ones around it, a rail its
        gates and anything else its update group. Each neighbour is a container
        whose redraw is the real one, so a neighbour redraw that passed its own
        sort would show here as a `true`.
    */
    Object.assign(G.BPC, { sortDeferred: true })
    const neighbour = Object.create(EntityContainer.prototype, {
        entitySprites: { value: [], writable: true },
        position: { value: { x: 0, y: 0 } },
    }) as EntityContainer
    vi.spyOn(EntityContainer, 'containerOf').mockReturnValue(neighbour)
    vi.spyOn(
        EntityContainer as unknown as { updateGroups: Map<string, Set<string>> },
        'updateGroups',
        'get'
    ).mockReturnValue(
        new Map([
            ['straight-rail', new Set(['gate'])],
            ['pipe', new Set(['pipe'])],
        ])
    )
    const gate = { entityNumber: 2, name: 'gate', type: 'gate' }
    const pipe = { entityNumber: 3, name: 'pipe', type: 'pipe' }
    Object.assign(G.bp, {
        entityPositionGrid: {
            getEntitiesInArea: () => [gate],
            getSurroundingEntities: () => [pipe],
        },
    })
    const redrawSurroundingEntities = EntityContainer.prototype['redrawSurroundingEntities']
    for (const [name, type] of [
        ['straight-rail', 'straight-rail'],
        ['pipe', 'pipe'],
    ]) {
        addEntitySprites.mockClear()
        const entity = { name, type, position: { x: 0, y: 0 }, size: { x: 1, y: 1 } }
        redrawSurroundingEntities.call({ m_Entity: entity } as unknown as EntityContainer)
        expect(addEntitySprites, name).toHaveBeenCalledOnce()
        expect(addEntitySprites, name).toHaveBeenLastCalledWith([], false)
    }
})
