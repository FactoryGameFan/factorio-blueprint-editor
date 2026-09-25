import { describe, expect, it } from 'vite-plus/test'
import { keyComboLabel, withKeybind } from './keyComboLabel'

/*
    The shortcut bar's hover text (#505). The combos are the ones the actions
    serialise, from `Action.keyCombo` in actions.ts; the words are the game's,
    from `[control-keys]` in Factorio 2.0.77's core locale.
*/
describe('keyComboLabel', () => {
    it.each([
        ['Control+KeyZ', 'Control + Z'],
        ['Control+KeyY', 'Control + Y'],
        ['Control+KeyS', 'Control + S'],
        ['AltLeft', 'Left Alt'],
        ['AltRight', 'Right Alt'],
        ['Control+Shift+KeyV', 'Control + Shift + V'],
        ['Alt+ClickL', 'Alt + Left-click'],
        ['Control+ClickR', 'Control + Right-click'],
        ['Digit7', '7'],
        ['Numpad4', 'Numpad 4'],
        ['NumpadAdd', 'Numpad +'],
        ['Shift+Equal', 'Shift + ='],
        ['Space', 'Spacebar'],
        ['ArrowUp', 'Up'],
        ['PageDown', 'Page Down'],
        ['Escape', 'Escape'],
        ['F5', 'F5'],
    ])('%s reads as %s', (combo, label) => {
        expect(keyComboLabel(combo)).toBe(label)
    })

    it('does not resolve a key name through the object prototype', () => {
        expect(keyComboLabel('toString')).toBe('toString')
    })
})

describe('withKeybind', () => {
    it("writes the keybind after the name, in the locale's inline format", () => {
        expect(withKeybind('Undo', 'Control+KeyZ')).toBe('Undo (Control + Z)')
        expect(withKeybind('Toggle "Alt-mode"', 'AltLeft')).toBe('Toggle "Alt-mode" (Left Alt)')
    })

    it('leaves the name alone for a button with no keybind', () => {
        expect(withKeybind('Import string', undefined)).toBe('Import string')
    })
})
