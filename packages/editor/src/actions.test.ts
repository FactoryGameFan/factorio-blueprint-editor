import { expect, it } from 'vite-plus/test'
import { ActionRegistry, MouseButton } from './actions'

it('runs pending button and modifier releases before replacing them', () => {
    const calls: string[] = []
    const registry = new ActionRegistry({
        test: {
            trigger: { button: MouseButton.Left },
            modifiers: { shift: true },
            callbacks: {
                onPress: () => (calls.push('press'), true),
                onRelease: () => {
                    calls.push('release')
                },
            },
            modifierCallbacks: {
                onPress: () => (calls.push('modifier press'), true),
                onRelease: () => {
                    calls.push('modifier release')
                },
            },
        },
    })
    const action = registry.get('test')
    if (!action) throw new Error('test action missing')
    const modifiers = { shift: true }
    const pointer = { button: MouseButton.Left } as PointerEvent
    action.pressMod(modifiers, 'Shift')
    action.press(modifiers, pointer)
    // A keyup filtered by the editor never reaches the registry.
    action.pressMod(modifiers, 'Shift')
    action.press(modifiers, pointer)
    action.forceRelease()
    expect(calls).toEqual([
        'modifier press',
        'press',
        'modifier release',
        'modifier press',
        'release',
        'press',
        'release',
        'modifier release',
    ])
})
