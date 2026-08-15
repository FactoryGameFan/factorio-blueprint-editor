import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    The first coverage `UI/controls/TextInput.ts` has had.

    It is a port of Mwni's pixi-text-input, and it is the odd one out among the
    UI controls: it is not drawn with pixi at all, it appends a real DOM <input>
    over the canvas and keeps it positioned. So unlike everything else in UI/,
    what it produces can be asserted on directly, without a tally or a digest -
    the element is either in the document with the right value and styles or it
    is not.

    Reached the way a user reaches it: hover an entity to enter EDIT, then left
    click, which is the `openEntityGUI` action. That route only became drivable
    with the EDIT coverage from issue #44.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

const STATION = 'Iron Pickup'

const TRAIN_STOP = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        {
            entity_number: 1,
            name: 'train-stop',
            position: { x: 1, y: 1 },
            direction: 0,
            station: STATION,
            manual_trains_limit: 4,
        },
    ],
})

/** Loads the train stop and answers where it is on screen. */
async function loadTrainStop(page: Page): Promise<{ x: number; y: number }> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, TRAIN_STOP)

    const at = await page.evaluate(() => (window as any).__fbe_test.entityScreenPosition(1))
    if (!at) throw new Error('the train stop is not in the loaded blueprint')
    return at
}

/*
    Hovers the entity and left clicks, which is the `openEntityGUI` action.

    Steps away from the entity first, because hovering is driven by GridData's
    `update32`, which only fires when the pointer crosses a tile boundary -
    moving to a point the pointer already occupies emits nothing and leaves the
    mode at NONE. That matters on the second open in the lifecycle test.
*/
async function openEditorAt(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
    expect(await page.evaluate(() => (window as any).__fbe_test.editorMode())).toBe('EDIT')

    await page.mouse.down()
    await page.mouse.up()
}

async function openEntityEditor(page: Page): Promise<{ x: number; y: number }> {
    const at = await loadTrainStop(page)
    await openEditorAt(page, at)
    return at
}

/*
    The elements TextInput put on the page, told apart from the settings pane's
    own inputs (55 of them at rest) by having an inline style - TextInput writes
    _input_style onto the element, nothing else on the page does.
*/
const textInputValues = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[])
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )

test('the entity editor puts its inputs on the page and takes them away again', async ({
    page,
}) => {
    /*
        TextInput manages the element's presence in the document by hand, so the
        assertion is the exact set rather than "at least one": a close that left
        the element behind shows up here as a surplus and nowhere else, and
        closing and reopening would then pile a fresh pair of inputs over the
        canvas every time. Confirmed by mutation - stopping _onRemoved from
        detaching fails this and neither of the other two.

        _getDOMInputBounds has a third append/remove pair for measuring, and this
        does *not* cover it: it only appends when the element is not already in
        the document, which by the time it runs here it is. Breaking that removal
        passes all three tests.
    */
    const at = await openEntityEditor(page)

    // The station name box and the trains-limit box, and nothing else.
    expect(await textInputValues(page)).toEqual([STATION, '4'])

    await page.keyboard.press('Escape')
    expect(await textInputValues(page)).toEqual([])

    await openEditorAt(page, at)
    expect(await textInputValues(page)).toEqual([STATION, '4'])
})

test('the input carries the styles TextInput was constructed with', async ({ page }) => {
    /*
        _createDOMInput writes every entry of _input_style onto the element, and
        that loop is the only consumer of the option. A style silently dropped
        there leaves the input unstyled and floating over the canvas rather than
        sitting in the box drawn for it, which no mode or sprite assertion can
        see.
    */
    await openEntityEditor(page)

    const styled = await page.evaluate(() => {
        const el = [...document.querySelectorAll('input')].find(i => i.value === 'Iron Pickup') as
            | HTMLInputElement
            | undefined
        if (!el) return undefined
        /*
            Longhands rather than the shorthands the constructor writes. Setting
            `border` to 'none' and reading `border` back gives '' - the CSSOM
            will not re-serialise a shorthand whose longhands came out mixed -
            so the shorthand tells you nothing about whether the write landed.
        */
        return {
            position: el.style.position,
            width: el.style.width,
            color: el.style.color,
            borderStyle: el.style.borderStyle,
            outlineStyle: el.style.outlineStyle,
            transformOrigin: el.style.transformOrigin,
            // From the constructor's literal rather than from options, so this
            // also pins that the defaults survive the spread of `options.input`.
            lineHeight: el.style.lineHeight,
            fontFamily: el.style.fontFamily,
            fontSize: el.style.fontSize,
        }
    })

    expect(styled).toEqual({
        position: 'absolute',
        width: '250px',
        color: 'black',
        borderStyle: 'none',
        outlineStyle: 'none',
        transformOrigin: '0px 0px',
        lineHeight: '1',
        fontFamily: 'Roboto, sans-serif',
        /*
            This line used to read `''`, recording issue #60 rather than the
            expected answer: style.ts has `fontSize: 14`, a number, and
            TextInput interpolated it straight into a CSS value, so the element
            was asked for `font-size: 14` - no unit, invalid, dropped by the
            CSSOM - and every text box rendered at the browser default. The
            comment said this line would move when someone fixed it. It has.
        */
        fontSize: '14px',
    })
})

/** Focuses the DOM input currently holding `value`. */
async function focusInputWithValue(page: Page, value: string): Promise<void> {
    await page.evaluate((v: string) => {
        const el = [...document.querySelectorAll('input')].find(i => i.value === v)
        if (!el) throw new Error(`no input holding ${v}`)
        el.focus()
    }, value)
}

const valueOf = (page: Page, selectorValue: string): Promise<string | undefined> =>
    page.evaluate(
        (v: string) =>
            ([...document.querySelectorAll('input')] as HTMLInputElement[]).find(
                i => i.style.cssText !== '' && (i.value === v || i.value.startsWith(v))
            )?.value,
        selectorValue
    )

test('a numeric-only box rejects what does not match its restriction', async ({ page }) => {
    /*
        The trains-limit box is built with numericOnly, which sets `restrict`.
        This is the only test that runs the input event path rather than just
        construction: _onInputKeyDown records the selection, _onInputInput fires,
        and _applyRestriction either accepts the new text or puts the old one
        back and restores the caret from that recorded selection.

        Worth having beyond the round trip, because the reverting branch is the
        one that reads `_selection` - and a caret restored to the wrong place is
        the kind of thing that only shows up when a second character is typed.
    */
    await openEntityEditor(page)
    await focusInputWithValue(page, '4')

    await page.keyboard.press('End')
    await page.keyboard.type('7')
    expect(await valueOf(page, '47')).toBe('47')

    // Rejected, and the caret must survive it - hence typing again after.
    await page.keyboard.type('x')
    expect(await valueOf(page, '47')).toBe('47')

    await page.keyboard.type('9')
    expect(await valueOf(page, '479')).toBe('479')
})

/*
    Same inline-style filter as textInputValues, plus whether the element is
    currently on screen. `display` rather than a bounding box: _setDOMInputVisible
    is what writes it, and a zero-sized box would also be what an element that
    has not been positioned yet reports.
*/
const textInputVisibility = (page: Page): Promise<{ value: string; shown: boolean }[]> =>
    page.evaluate(() =>
        ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[])
            .filter(el => el.style.cssText !== '')
            .map(el => ({ value: el.value, shown: el.style.display !== 'none' }))
    )

/*
    A frame has to run before any of these reads. _onAdded hides the element and
    only onRender -> _updateDOMInput puts it back, so a read taken straight after
    the click that opened the dialog races the renderer: measured, 1 run in 6 came
    back with all six fields hidden and the test failing on its first assertion.

    Two frames rather than one, because the first callback can be queued ahead of
    pixi's own render. A timeout would also have worked and would have hidden the
    reason - and it matters here beyond flakiness: the middle assertion expects
    everything hidden, which an unrendered frame satisfies for the wrong reason.
*/
const nextFrame = (page: Page): Promise<void> =>
    page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
    )

test('a dialog opened on top hides the DOM fields of the one underneath', async ({ page }) => {
    /*
        The one thing about TextInput that no pixi assertion can reach. Its
        element sits on document.body over the canvas, so a dialog drawn on top
        of the one that owns it cannot cover it: before this was handled, opening
        the icon picker over Blueprint Info left six fields showing through it -
        the name box printing "Blueprint" across the picker's slot row, and five
        more invisible only because their background is none, all still answering
        elementFromPoint and so eating the clicks aimed at the slots underneath.

        Both halves matter and they fail differently. Hiding on open is the bug;
        showing again on close is what a fix that only ever hides gets wrong, and
        that one is worse, since the fields never come back for the rest of the
        session. Mutation-checked: dropping the updateDOMInputVisibility call from
        Dialog's constructor fails the middle assertion only, and dropping it from
        close() fails the last one only.

        Blueprint Info is used rather than an entity editor because it is the
        dialog that both owns TextInputs and opens a second dialog over itself.
    */
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    // The corner button that opens it - 36x36 at (152, 6), see BlueprintInfoButton.
    await page.mouse.click(170, 24)
    await nextFrame(page)
    const opened = await textInputVisibility(page)
    // Name, description, and BlueprintAlignment's grid width/height and position x/y.
    expect(opened.map(f => f.shown)).toEqual([true, true, true, true, true, true])

    /*
        The first icon slot, at dialog-local (12, 119) and 36 across, opens the
        picker as a second dialog. Read the dialog's own bounds rather than
        assuming where it sits: Dialog.setPosition centres it on the screen.
    */
    const info = await page.evaluate(() => (window as any).__fbe_test.topDialogBounds())
    await page.mouse.click(info.x + 12 + 18, info.y + 119 + 18)
    expect(await page.evaluate(() => (window as any).__fbe_test.openDialogCount())).toBe(2)
    await nextFrame(page)

    expect((await textInputVisibility(page)).map(f => f.shown)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
    ])

    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => (window as any).__fbe_test.openDialogCount())).toBe(1)
    await nextFrame(page)
    expect((await textInputVisibility(page)).map(f => f.shown)).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
    ])
})
