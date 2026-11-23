import { expect, it, vi } from 'vite-plus/test'
import 'pixi.js/events'
import { Container, type FederatedWheelEvent } from 'pixi.js'
import { ScrollArea } from './ScrollArea'

/*
    What the Playwright specs cannot see: that closing a dialog takes the
    scroll area's listeners off with it, now that the dialogs no longer do it
    themselves. `Panel.destroy()` destroys its children, and that reaches
    `ScrollArea.destroy`, which calls `dispose`.
*/

/** Just the parts of a wheel event the area reads, with the two calls it should make spied on. */
function wheel(deltaY: number, deltaMode = 0) {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const event = { deltaY, deltaMode, preventDefault, stopPropagation }
    return { event: event as unknown as FederatedWheelEvent, preventDefault, stopPropagation }
}

function makeArea(contentHeight = 1000): ScrollArea {
    const area = new ScrollArea({ width: 100, height: 100, trackX: 100 })
    area.contentHeight = contentHeight
    return area
}

it('scrolls by the wheel in pixels, lines and pages, and clamps at both ends', () => {
    const area = makeArea()
    area.emit('wheel', wheel(20).event)
    area.emit('wheel', wheel(1).event)
    expect(area.scroll).toBe(21)
    area.emit('wheel', wheel(2, 1).event)
    expect(area.scroll).toBe(53)
    area.emit('wheel', wheel(1, 2).event)
    expect(area.scroll).toBe(153)
    area.emit('wheel', wheel(-5000).event)
    expect(area.scroll).toBe(0)
    area.emit('wheel', wheel(5000).event)
    expect(area.scroll).toBe(900)
})

it('leaves the wheel alone when everything fits', () => {
    const area = makeArea(80)
    const e = wheel(100)
    area.emit('wheel', e.event)
    expect(area.scroll).toBe(0)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
})

it('takes every listener off when its parent is destroyed with its children', () => {
    const parent = new Container()
    const area = makeArea()
    parent.addChild(area)
    expect(area.listenerCount('wheel')).toBe(1)
    const spy = vi.spyOn(area, 'dispose')
    parent.destroy({ children: true })
    expect(spy).toHaveBeenCalled()
    expect(area.destroyed).toBe(true)
    expect(area.listenerCount('wheel')).toBe(0)
    for (const child of area.children) {
        expect(child.listenerCount('pointerdown')).toBe(0)
        expect(child.listenerCount('globalpointermove')).toBe(0)
    }
})
