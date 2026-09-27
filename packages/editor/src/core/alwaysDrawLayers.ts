/*
    Which layers a mining drill draws on top of its main animation: its
    `always_draw` working visualisations, with the copies removed.

    Split out of spriteDataBuilder.ts so it can be unit tested without loading
    Factorio data; it is pure.
*/
import type { Sprite as SpriteData, WorkingVisualisation } from 'factorio:prototype'
import type { NamedDirection } from '../types'

/**
 * The drill's main animation layers for `dir`, followed by the layers of every
 * `always_draw` working visualisation for that facing, with duplicates dropped.
 *
 * An always_draw visualisation is either directional - one entry per facing, and
 * absent for facings it does not apply to - or a single non-directional
 * `animation` drawn the same way whichever way the drill points.
 * electric-mining-drill only has the first kind; big-mining-drill has two of the
 * second kind (a scorch mark and the drill head), so both have to be read. A
 * directional entry that omits this facing stays dropped rather than falling
 * back to a plain `animation` it does not have.
 *
 * big-mining-drill then draws two sprites twice (issue #374), and two rules
 * remove the copies:
 *
 * - `enabled_in_animated_shift_during_waypoint_stop` and
 *   `..._during_transition` split one animated-shift part between two entries,
 *   so the game shows one or the other. Its `wv[5]` and `wv[6]` are the wheels,
 *   identical at every facing, and differ only in those two flags. The editor
 *   draws a drill at rest, which is a waypoint stop, so an entry switched off
 *   there is skipped. Both default to true, so an entry setting neither is kept.
 *
 * - A layer identical in every field to a later one is dropped, keeping the
 *   later copy. Its `wv[4]` at north and south is byte-for-byte the first layer
 *   of `graphics_set.animation`, the still base. Keeping the later copy keeps
 *   the stacking the double draw already had, the base over the scorch mark and
 *   drill head that sit between the two copies; keeping the first would move
 *   those on top of the base. East and west escape because their `wv[4]` is a
 *   different file.
 */
export function drillLayers(
    base: readonly SpriteData[],
    visualisations: readonly WorkingVisualisation[],
    dir: NamedDirection
): readonly SpriteData[] {
    const animDir = `${dir}_animation` as const
    const extra = visualisations
        .filter(vis => vis.always_draw)
        .filter(
            vis =>
                !(
                    vis.animated_shift &&
                    vis.enabled_in_animated_shift_during_waypoint_stop === false
                )
        )
        .map(vis => vis[animDir] ?? vis.animation)
        .filter(anim => !!anim)
        .flatMap(anim => (anim.layers ? anim.layers : [anim]))

    // Sprite data comes from JSON, so identical layers serialise identically.
    const all = [...base, ...extra] as readonly SpriteData[]
    const keys = all.map(layer => JSON.stringify(layer))
    return all.filter((_, i) => !keys.includes(keys[i], i + 1))
}
