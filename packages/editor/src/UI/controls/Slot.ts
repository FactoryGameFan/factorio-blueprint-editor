import { Container } from 'pixi.js'
import { colors } from '../style'
import { Button } from './Button'

/**
 * Base Slot
 */
export class Slot<Data, Content extends Container = Container> extends Button<Data, Content> {
    /*
        The item name the slot's icon was last drawn for, absent until it has
        drawn one. A cache key rather than a label: `Filters.m_UpdateSlots`
        compares it against the filter's name to decide whether to rebuild the
        icon, and on a slot that has never drawn anything the comparison has to
        answer "different", which is what the undefined is for.

        It was called `name`, which collided with pixi's own `Container.name` -
        deprecated since v8, implemented as an accessor pair that proxies to
        `label` and logs a deprecation warning on every read and write. The
        declaration here shadowed it with an own field, so the warning never
        fired and the collision was invisible; it also meant this could not be
        typed honestly, since an override has to stay assignable to the `string`
        the base declares. Renaming answers both.
    */
    public iconName: string | undefined

    // Override Rollover Color of Button
    public get hover(): number {
        return colors.controls.slot.hover.color
    }

    // Override Pressed appearance of Button
    public get pressed(): boolean {
        return true
    }

    public constructor(width = 36, height = 36, border = 1) {
        super(width, height, border)
    }
}
