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
    await page.keyboard.press('Control+A')
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
