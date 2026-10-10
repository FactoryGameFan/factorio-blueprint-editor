import { afterEach, expect, it, vi } from 'vite-plus/test'
import EventEmitter from 'eventemitter3'
import { Container } from 'pixi.js'
import { EntitySprite } from '../../../containers/EntitySprite'
import { OverlayContainer } from '../../../containers/OverlayContainer'
import type { Entity } from '../../../core/Entity'
import { Preview } from './Preview'

vi.mock('../../../common/globals', () => ({ default: { BPC: {}, bp: {} } }))
afterEach(() => vi.restoreAllMocks())

/*
    `Preview` keeps its own list of entity events to rebuild on, separate from
    `EntityContainer`'s, so an event that changes what an editor's preview
    draws can reach the map and miss the dialog. The three display panel
    events did (#550), and `station` before them (#536). Listing every event
    the preview should follow, not only the ones that were missed, is what
    makes this a guard for the next one.

    The entity is a bare EventEmitter carrying only what `generatePreview`
    reads. `getParts` returns a fresh pixi `Container` per call because the
    preview `addChild`s the result, and pixi throws on an empty spread.
*/
const fakeEntity = (): Entity =>
    Object.assign(new EventEmitter(), {
        name: 'display-panel',
        size: { x: 1, y: 1 },
        entityData: undefined,
        direction: 0,
    }) as unknown as Entity

const REDRAW_EVENTS = [
    'recipe',
    'modules',
    'filters',
    'splitterInputPriority',
    'splitterOutputPriority',
    'station',
    'displayPanelIcon',
    'displayPanelText',
    'displayPanelAlwaysShow',
] as const

it.each(REDRAW_EVENTS)('rebuilds the preview when the entity emits %s', event => {
    const getParts = vi
        .spyOn(EntitySprite, 'getParts')
        .mockImplementation(() => [new Container() as unknown as EntitySprite])
    vi.spyOn(OverlayContainer, 'createEntityInfo').mockReturnValue(undefined)
    const entity = fakeEntity()

    new Preview(entity, 114)
    expect(getParts).toHaveBeenCalledTimes(1)
    ;(entity as unknown as EventEmitter).emit(event)
    expect(getParts).toHaveBeenCalledTimes(2)
})
