import { test, expect } from '@playwright/test'
import {
    encodeBlueprint as encode,
    packVersion as version,
    decodeBlueprintString,
} from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    The display panel editor.

    `DisplayPanelEditor` was never registered in `UI/editors/factory.ts`, so a
    display panel could be placed but had no editor at all - no way to set its
    icon, its text, or whether that text always shows. The commented-out chest
    editor case sat unreachable the same way for two releases with every check
    green, because nothing here runs Playwright in CI - see CLAUDE.md. That is
    the reason this spec exists rather than a general policy: `overlay-container
    .spec.ts` tallies what `createEntityInfo` returns and would keep passing if
    the editor stopped opening entirely, since it never opens one.

    What it cannot see either is the visibility swap `EntityContainer.
    pointerOverEventHandler`/`pointerOutEventHandler` do: the always-show label
    and the full-text hover tooltip draw in different containers, so they hide
    `entityInfo` on hover and restore it on hover-out, rather than removing or
    rebuilding anything the tally would notice. `entityInfoVisible` is a new
    `__fbe_test` hook for exactly that; nothing before this needed to read it.

    Locating controls: the dialog is drawn with pixi, so there is no selector
    for the text field. `topDialogBounds` plus `DisplayPanelEditor`'s own layout
    constants would give the field's position, but the field is a real DOM
    `<input>` - `TextInput` is the one control in UI/ that is - so it is found
    and driven directly instead, the way tests/text-input.spec.ts does.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

const INITIAL_TEXT = 'Old text'

/** always_show: true so the panel draws its persistent label with no hover needed. */
const DISPLAY_PANEL = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'display-panel' } }],
    entities: [
        {
            entity_number: 1,
            name: 'display-panel',
            position: { x: 0.5, y: 0.5 },
            text: INITIAL_TEXT,
            always_show: true,
        },
    ],
})

async function load(page: Page, source: string): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
    return errors
}

/** Where entity `n` sits on screen right now - loading re-centres the view, so this is read fresh rather than computed from the encoded position. */
async function screenPositionOf(
    page: Page,
    entityNumber: number
): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/*
    Hovers the entity, which is enough to enter EDIT and to run the
    pointerOver/pointerOut visibility swap - a left click on top of that is
    `openEntityGUI` and is what actually opens the dialog.

    Steps away first: hovering is driven by GridData's `update32`, which only
    fires when the pointer crosses a tile boundary, so moving to a point the
    pointer already occupies emits nothing. Same reason as chest-editor.spec.ts.
*/
async function hover(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
}

async function openEditorOn(page: Page, entityNumber: number): Promise<void> {
    const at = await screenPositionOf(page, entityNumber)
    await hover(page, at)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')

    await page.mouse.down()
    await page.mouse.up()
}

const dialogCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.openDialogCount())

const entityInfoVisible = (page: Page, entityNumber: number): Promise<boolean> =>
    page.evaluate((n: number) => window.__fbe_test.entityInfoVisible(n), entityNumber)

/*
    Focuses the DOM input currently holding `value` - DisplayPanelEditor's own
    text field, told apart from the settings pane's inputs by having an inline
    style. TextInput writes that, nothing else on the page does. Borrowed from
    tests/text-input.spec.ts's focusInputWithValue.
*/
async function focusInputWithValue(page: Page, value: string): Promise<void> {
    await page.evaluate((v: string) => {
        const el = [...document.querySelectorAll('input, textarea')].find(
            i => (i as HTMLInputElement).style.cssText !== '' && (i as HTMLInputElement).value === v
        )
        if (!el) throw new Error(`no input holding "${v}"`)
        ;(el as HTMLInputElement).focus()
    }, value)
}

async function decodedEntities(page: Page): Promise<Record<string, unknown>[]> {
    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    return decodeBlueprintString(source).blueprint.entities
}

test('clicking a display panel opens its editor, and it closes again', async ({ page }) => {
    const errors = await load(page, DISPLAY_PANEL)
    expect(await dialogCount(page)).toBe(0)

    await openEditorOn(page, 1)
    expect(await dialogCount(page)).toBe(1)

    await page.keyboard.press('Escape')
    expect(await dialogCount(page)).toBe(0)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('editing the text field writes through to the serialized blueprint', async ({ page }) => {
    /*
        Asserted against the serialized blueprint rather than against the model
        a getter would read back, since a setter that wrote a correct value into
        the wrong shape would still make Entity.displayPanelText answer right -
        `serialize()` is the thing a real export depends on.
    */
    const errors = await load(page, DISPLAY_PANEL)
    await openEditorOn(page, 1)

    await focusInputWithValue(page, INITIAL_TEXT)
    /*
        Select-all, and it has to be ControlOrMeta rather than Control. On macOS
        Control+A is the emacs "beginning of line" binding, not select-all, so
        nothing is selected and the typed text lands in *front* of what is
        already there - the assertion below gets "New textOld text". It passes
        on Linux either way, which is why it reached the default branch.
    */
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('New text')
    // Tabbing away is what commits the change in the running app.
    await page.keyboard.press('Tab')

    const entities = await decodedEntities(page)
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ text: 'New text' })
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('hovering hides the always-show label behind the tooltip, and moving away restores it', async ({
    page,
}) => {
    const errors = await load(page, DISPLAY_PANEL)

    // Not hovering: the always-show label is the only thing there is to draw.
    expect(await entityInfoVisible(page, 1)).toBe(true)

    const at = await screenPositionOf(page, 1)
    await hover(page, at)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')
    expect(await entityInfoVisible(page, 1)).toBe(false)

    await page.mouse.move(at.x, at.y + 240)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('NONE')
    expect(await entityInfoVisible(page, 1)).toBe(true)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    The rest of the dialog's surface (#234): the alt-mode checkbox, the icon
    picker, and the read-only branch a circuit-connected panel gets. Every
    control below is drawn with pixi, so each is found from `topDialogBounds`
    plus `DisplayPanelEditor`'s own layout constants, read only after a frame
    has rendered the dialog - see tests/chest-editor.spec.ts's
    renderedDialogBounds for the click that lands on the blueprint otherwise.
*/

type Bounds = { x: number; y: number; width: number; height: number }

async function renderedDialogBounds(page: Page): Promise<Bounds> {
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
    )
    return page.evaluate(() => window.__fbe_test.topDialogBounds())
}

/** The checkbox is drawn 18px square at dialog-local (12, 168), or (12, 160) on a connected panel. */
async function clickAlwaysShow(page: Page, connected = false): Promise<void> {
    const dialog = await renderedDialogBounds(page)
    await page.mouse.click(dialog.x + 12 + 9, dialog.y + (connected ? 160 : 168) + 9)
}

/** The icon slot, 36px square at dialog-local (140, 65) on an unconnected panel. */
async function iconSlotAt(page: Page): Promise<{ x: number; y: number }> {
    const dialog = await renderedDialogBounds(page)
    return { x: dialog.x + 140 + 18, y: dialog.y + 65 + 18 }
}

/*
    Picks the first item of the picker's `tab`th group tab. InventoryDialog puts
    its 68px tabs at (12, 46) on a 70px pitch and its items at (12, 126) on a
    38px one, so both centres are measured from those corners.
*/
async function pickFirstItemOfTab(page: Page, tab: number): Promise<void> {
    let picker = await renderedDialogBounds(page)
    await page.mouse.click(picker.x + 12 + tab * 70 + 34, picker.y + 46 + 34)
    picker = await renderedDialogBounds(page)
    await page.mouse.click(picker.x + 12 + 18, picker.y + 126 + 18)
}

const exportedAlwaysShow = async (page: Page): Promise<unknown> =>
    (await decodedEntities(page))[0].always_show

test('the alt-mode checkbox writes always_show, and undo restores it', async ({ page }) => {
    /*
        The fixture starts with always_show: true, so the first click turns it
        off - and off is written as the field's absence, the way Factorio
        itself omits it, not as `false`.

        The last click is what checks the dialog followed the undo. If
        `onEntityChange` stopped updating the checkbox, it would still read
        unchecked after the undo, that click would try to turn always_show on,
        the setter would find it already on and do nothing, and the export
        would stay `true`.
    */
    const errors = await load(page, DISPLAY_PANEL)
    await openEditorOn(page, 1)
    expect(await exportedAlwaysShow(page)).toBe(true)

    await clickAlwaysShow(page)
    expect(await exportedAlwaysShow(page)).toBeUndefined()

    await page.keyboard.press('Control+KeyZ')
    expect(await exportedAlwaysShow(page)).toBe(true)

    await clickAlwaysShow(page)
    expect(await exportedAlwaysShow(page)).toBeUndefined()

    await clickAlwaysShow(page)
    expect(await exportedAlwaysShow(page)).toBe(true)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('picking an icon writes its name and signal type, and a right click clears it', async ({
    page,
}) => {
    /*
        The picker's filter is items, fluids and virtual signals. Against the
        committed Space Age data that spans seven group tabs - logistics,
        production, intermediate products, space, combat, fluids, signals, with
        creative left out of every filtered picker - which is past the five the
        base 404px layout holds, so `computeWidth` widens the dialog to
        7 * 70 + 22. The width is asserted first because it is also what makes
        the tab indices below mean fluids and signals.

        DisplayPanelIcon also passes showRecipePanel = false, since nothing it
        offers has a recipe and the panel would be a permanently empty bar.
        The bounds cannot see that: `Panel.height` answers its background's
        height, 442 either way, and the recipe panel hangs below it. What the
        panel does add is its label, an empty `Text`, so the picker drawing
        its title and nothing else is the check - measured, dropping the
        argument makes it `["Select Icon", ""]`.

        A fluid and a virtual signal rather than an item, because an item's
        signal type is written as nothing at all, so an item pick could not
        tell a lost `displayPanelIconType` from a working one.
    */
    const errors = await load(page, DISPLAY_PANEL)
    await openEditorOn(page, 1)
    expect((await decodedEntities(page))[0].icon).toBeUndefined()

    let slot = await iconSlotAt(page)
    await page.mouse.click(slot.x, slot.y)
    expect(await dialogCount(page)).toBe(2)
    const picker = await renderedDialogBounds(page)
    expect(picker.width).toBe(7 * 70 + 22)
    expect(await page.evaluate(() => window.__fbe_test.topDialogTexts())).toEqual(['Select Icon'])

    await pickFirstItemOfTab(page, 5)
    expect(await dialogCount(page)).toBe(1)
    expect((await decodedEntities(page))[0].icon).toEqual({ type: 'fluid', name: 'water' })

    slot = await iconSlotAt(page)
    await page.mouse.click(slot.x, slot.y)
    expect(await dialogCount(page)).toBe(2)
    await pickFirstItemOfTab(page, 6)
    expect(await dialogCount(page)).toBe(1)
    expect((await decodedEntities(page))[0].icon).toEqual({
        type: 'virtual',
        name: 'signal-everything',
    })

    // A right click is DisplayPanelIcon's clear, and opens nothing.
    slot = await iconSlotAt(page)
    await page.mouse.click(slot.x, slot.y, { button: 'right' })
    expect(await dialogCount(page)).toBe(1)
    expect((await decodedEntities(page))[0].icon).toBeUndefined()

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/*
    A panel on the logistic network, which is one way `generateConnector`
    becomes true - enough to put the editor down its read-only conditions
    branch without a wire. 25 parameters is past MAX_ROWS (20), so the dialog
    shows 20 rows and a "+5 more" line.
*/
const CONNECTED_ROWS = 25

const CONNECTED_PANEL = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'display-panel' } }],
    entities: [
        {
            entity_number: 1,
            name: 'display-panel',
            position: { x: 0.5, y: 0.5 },
            control_behavior: {
                connect_to_logistic_network: true,
                parameters: Array.from({ length: CONNECTED_ROWS }, (_, i) => ({
                    text: `Row ${i + 1}`,
                    icon: { type: 'item', name: 'iron-plate' },
                    condition: {
                        first_signal: { type: 'item', name: 'iron-plate' },
                        comparator: '>',
                        constant: i,
                    },
                })),
            },
        },
    ],
})

test('a connected panel shows its conditions read-only, capped at 20 rows', async ({ page }) => {
    /*
        Height and labels both, because neither alone reaches the rows: the
        height is computed from the parameter count before a single row is
        built, so it would stay right with the row loop deleted, and the labels
        say nothing about the formula the dialog is sized by.
    */
    const errors = await load(page, CONNECTED_PANEL)
    await openEditorOn(page, 1)
    expect(await dialogCount(page)).toBe(1)

    // 222 plus one 26px row for each of the 20 shown and one for "+5 more".
    expect((await renderedDialogBounds(page)).height).toBe(222 + 21 * 26)

    const texts = await page.evaluate(() => window.__fbe_test.topDialogTexts())
    expect(texts).toContain('Conditions (read only):')
    for (let i = 1; i <= 20; i++) expect(texts).toContain(`"Row ${i}"`)
    expect(texts).not.toContain('"Row 21"')
    expect(texts).toContain(`+${CONNECTED_ROWS - 20} more`)
    // One comparator and one constant per row, from createConditionDisplay.
    expect(texts.filter(t => t === '>')).toHaveLength(20)
    expect(texts).toContain('19')
    // The unconnected layout's text and icon fields are not built at all.
    expect(texts).not.toContain('Icon:')
    expect(texts).not.toContain('Text:')

    // The checkbox moves up 8px in this layout, and writes the same field.
    expect(await exportedAlwaysShow(page)).toBeUndefined()
    await clickAlwaysShow(page, true)
    expect(await exportedAlwaysShow(page)).toBe(true)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
