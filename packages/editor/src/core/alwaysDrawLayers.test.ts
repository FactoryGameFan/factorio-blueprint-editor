import { describe, expect, it } from 'vite-plus/test'
import { drillLayers } from './alwaysDrawLayers'

/*
    The fixtures copy the shape of big-mining-drill's graphics_set in data.json,
    cut down to filenames: `animation.north.layers` is the still base and its
    shadow, and working visualisations 0, 1, 4, 5 and 6 are the ones that matter
    here. See issue #374.
*/
const sprite = (filename: string, extra: object = {}) => ({ filename, ...extra }) as never

const still = { filename: 'N-still.png', dice: 2 }
const base = [sprite('N-still.png', { dice: 2 }), sprite('N-still-shadow.png')]
const wheels = { filename: 'N-wheels.png', frame_count: 3 }
const visualisations = [
    { always_draw: true, animation: sprite('scorchmark.png') },
    { always_draw: true, animation: { layers: [sprite('drill.png')] } },
    // Not always_draw: drawn only while working.
    { animation: sprite('smoke.png') },
    {
        always_draw: true,
        north_animation: { ...still },
        east_animation: sprite('E-still-reel.png'),
    },
    {
        always_draw: true,
        animated_shift: true,
        enabled_in_animated_shift_during_waypoint_stop: false,
        enabled_in_animated_shift_during_transition: true,
        north_animation: { ...wheels },
    },
    {
        always_draw: true,
        animated_shift: true,
        enabled_in_animated_shift_during_waypoint_stop: true,
        enabled_in_animated_shift_during_transition: false,
        north_animation: { ...wheels },
    },
    // Directional, and absent at north: must not fall back to `animation`.
    { always_draw: true, east_animation: sprite('E-front.png') },
] as never

const names = (layers: readonly { filename?: string }[]) => layers.map(l => l.filename)

describe('drillLayers', () => {
    it('draws the still base and the wheels once each', () => {
        expect(names(drillLayers(base, visualisations, 'north'))).toEqual([
            'N-still-shadow.png',
            'scorchmark.png',
            'drill.png',
            'N-still.png',
            'N-wheels.png',
        ])
    })

    it('keeps a base layer that only shares a filename with a visualisation', () => {
        const east = [sprite('E-still.png'), sprite('E-still-shadow.png')]
        expect(names(drillLayers(east, visualisations, 'east'))).toEqual([
            'E-still.png',
            'E-still-shadow.png',
            'scorchmark.png',
            'drill.png',
            'E-still-reel.png',
            'E-front.png',
        ])
    })

    it('keeps two layers from one file that differ in any field', () => {
        const layers = drillLayers(
            [sprite('a.png', { dice: 2 })],
            [{ always_draw: true, animation: sprite('a.png') }] as never,
            'north'
        )
        expect(layers).toHaveLength(2)
    })

    it('keeps an animated-shift entry that is switched off only during transition', () => {
        const layers = drillLayers(
            [],
            [
                {
                    always_draw: true,
                    animated_shift: true,
                    enabled_in_animated_shift_during_transition: false,
                    animation: sprite('head.png'),
                },
            ] as never,
            'north'
        )
        expect(names(layers)).toEqual(['head.png'])
    })

    it('skips an animated-shift entry switched off during a waypoint stop', () => {
        // The two entries differ, so only the flag rule can remove one of them.
        const layers = drillLayers(
            [],
            [
                {
                    always_draw: true,
                    animated_shift: true,
                    enabled_in_animated_shift_during_waypoint_stop: false,
                    enabled_in_animated_shift_during_transition: true,
                    north_animation: sprite('moving-wheels.png', { frame_count: 3 }),
                },
                {
                    always_draw: true,
                    animated_shift: true,
                    enabled_in_animated_shift_during_waypoint_stop: true,
                    enabled_in_animated_shift_during_transition: false,
                    north_animation: sprite('parked-wheels.png', { frame_count: 1 }),
                },
            ] as never,
            'north'
        )
        expect(names(layers)).toEqual(['parked-wheels.png'])
    })
})
