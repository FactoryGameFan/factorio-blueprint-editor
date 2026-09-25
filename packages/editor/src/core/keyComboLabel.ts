/*
    Turns an action's `keyCombo`, such as `Control+KeyZ`, into the words the
    game uses for the same keys, such as `Control + Z` (#505).

    The key names follow the `[control-keys]` section of Factorio 2.0.77's
    `core/locale/en/core.cfg`: `Control`, `Left Alt`, `Spacebar`,
    `Numpad 1` and so on. The modifier stays `Control` on a Mac too, because
    the editor's Control binding is the Control key there as well, not
    Command.
*/

const NAMED: Readonly<Record<string, string>> = {
    Control: 'Control',
    Shift: 'Shift',
    Alt: 'Alt',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ControlLeft: 'Left Control',
    ControlRight: 'Right Control',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Spacebar',
    CapsLock: 'Caps Lock',
    NumLock: 'Num Lock',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    ContextMenu: 'Menu',
    NumpadAdd: 'Numpad +',
    NumpadSubtract: 'Numpad -',
    NumpadMultiply: 'Numpad *',
    NumpadDivide: 'Numpad /',
    NumpadDecimal: 'Numpad .',
    NumpadComma: 'Numpad ,',
    NumpadEqual: 'Numpad =',
    NumpadEnter: 'Numpad Enter',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    IntlBackslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    ClickL: 'Left-click',
    ClickR: 'Right-click',
    ClickM: 'Middle-click',
    Click4: 'Mouse button 4',
    Click5: 'Mouse button 5',
}

function keyName(part: string): string {
    if (Object.hasOwn(NAMED, part)) return NAMED[part]
    const letterOrDigit = /^(?:Key|Digit)(\w)$/.exec(part)
    if (letterOrDigit) return letterOrDigit[1]
    const numpad = /^Numpad(\d)$/.exec(part)
    if (numpad) return `Numpad ${numpad[1]}`
    // Escape, Enter, Tab, Home, F1 and the rest are already the game's word.
    return part
}

/** `Control+KeyZ` -> `Control + Z`. */
export function keyComboLabel(keyCombo: string): string {
    return keyCombo.split('+').map(keyName).join(' + ')
}

/**
 * A button's hover text: its name, then its keybind in brackets when it has
 * one, which is the locale's `inline-keybind-format`, `__1__ (__2__)`.
 */
export function withKeybind(name: string, keyCombo: string | undefined): string {
    return keyCombo ? `${name} (${keyComboLabel(keyCombo)})` : name
}
