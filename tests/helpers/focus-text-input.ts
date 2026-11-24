type Page = import('@playwright/test').Page

/**
 * Focuses a `TextInput`'s DOM element and fails if the focus did not land.
 *
 * `TextInput._onAdded` appends the element `display: none`, and only pixi's
 * first render after the dialog opens shows it. `focus()` on a hidden element is
 * a silent no-op, and the keys typed next go to the canvas as keybinds, so a spec
 * that focuses straight after the click that opened the dialog loses the race
 * whenever the machine is quick. Waiting for `display` to change waits for the
 * render itself, rather than for a number of frames (the same wait as
 * train-stop-name.spec.ts; text-input.spec.ts waits two frames instead).
 *
 * The element is the first one with an inline style, which the settings pane's
 * inputs lack, and holding `value` when one is given. `select` also selects its
 * text, for a spec that types over what is there.
 */
export async function focusTextInput(
    page: Page,
    options: { value?: string; select?: boolean } = {}
): Promise<void> {
    const { value, select = false } = options

    await page.waitForFunction((v: string | undefined) => {
        const el = ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[]).find(
            i => i.style.cssText !== '' && (v === undefined || i.value === v)
        )
        return el !== undefined && el.style.display !== 'none'
    }, value)
    await page.evaluate(
        ({ v, sel }) => {
            const el = (
                [...document.querySelectorAll('input, textarea')] as HTMLInputElement[]
            ).find(i => i.style.cssText !== '' && (v === undefined || i.value === v))
            if (!el) throw new Error('no TextInput element on the page')
            el.focus()
            if (document.activeElement !== el) {
                throw new Error(
                    `focusing the TextInput left ${document.activeElement?.tagName} focused ` +
                        `(display: ${el.style.display})`
                )
            }
            if (sel) el.select()
        },
        { v: value, sel: select }
    )
}
