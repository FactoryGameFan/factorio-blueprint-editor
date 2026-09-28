import { test, expect } from '@playwright/test'
import {
    decodeBlueprintString,
    encodeBlueprint as encode,
    packVersion as version,
} from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    The inserter's stack size override (issue #339).

    `override_stack_size` could be read through `Entity.inserterStackSize` and
    nothing could write it: `InserterEditor` drew the filter mode and filters
    and stopped there. 1007 corpus entities carry the field, every one in a 2.0
    blueprint, so it is a setting players still use.

    What is pinned here is the whole path through real input: the checkbox and
    box in the dialog, what the export carries afterwards, that an unticked or
    undone override is *absent* rather than written as some value, and that the
    range stops where the game's does.

    Locating controls: the dialog is drawn with pixi, so the checkbox is clicked
    at the position `InserterEditor.addStackSize` gives it. The box is a
    `TextInput`, a real DOM <input>, and is found and typed into as one.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/** Where InserterEditor puts the checkbox for an inserter with filter slots. */
const CHECKBOX_X = 140
const CHECKBOX_Y = 116

const INSERTERS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'inserter' } }],
    entities: [
        { entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 } },
        // The one corpus value above its prototype's limit, kept as found.
        {
            entity_number: 2,
            name: 'fast-inserter',
            position: { x: 3.5, y: 0.5 },
            override_stack_size: 12,
        },
        {
            entity_number: 3,
            name: 'bulk-inserter',
            position: { x: 6.5, y: 0.5 },
            override_stack_size: 7,
        },
        { entity_number: 4, name: 'stack-inserter', position: { x: 9.5, y: 0.5 } },
    ],
})

/*
    A bulk inserter between two chests, the arrangement whose info panel line is
    rotation speed times stack size and nothing else: 0.04 * 60 = 2.4 swings/s,
    so 16.8 items/s at the override of 7 and 28.8 at the fallback of 12. See
    tests/inserter-throughput.spec.ts for the other arrangements.
*/
const BETWEEN_CHESTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'bulk-inserter' } }],
    entities: [
        { entity_number: 1, name: 'steel-chest', position: { x: 0.5, y: 0.5 } },
        {
            entity_number: 2,
            name: 'bulk-inserter',
            position: { x: 0.5, y: 1.5 },
            override_stack_size: 7,
        },
        { entity_number: 3, name: 'steel-chest', position: { x: 0.5, y: 2.5 } },
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

/** Moves onto the entity from a tile away, so the hover registers. See tests/chest-editor.spec.ts. */
async function hover(page: Page, entityNumber: number): Promise<void> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
}

async function openEditorOn(page: Page, entityNumber: number): Promise<void> {
    await hover(page, entityNumber)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')
    await page.mouse.down()
    await page.mouse.up()
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(1)
}

/** The top dialog's bounds, after a frame has rendered it. See tests/chest-editor.spec.ts. */
async function renderedDialogBounds(
    page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
    )
    return page.evaluate(() => window.__fbe_test.topDialogBounds())
}

async function clickCheckbox(page: Page): Promise<void> {
    const dialog = await renderedDialogBounds(page)
    await page.mouse.click(dialog.x + CHECKBOX_X + 8, dialog.y + CHECKBOX_Y + 8)
}

/*
    Closes the dialog after its box has been typed into. Escape alone does not:
    the keybinds skip a key aimed at a focused input, so the press is lost and
    the dialog stays open. A click on the dialog's own title bar, away from any
    control, blurs the box first, as tests/blueprint-info-editor.spec.ts does.
*/
async function closeDialog(page: Page): Promise<void> {
    const dialog = await renderedDialogBounds(page)
    await page.mouse.click(dialog.x + 30, dialog.y + 14)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.__fbe_test.openDialogCount())).toBe(0)
}

/** The values of the DOM inputs TextInput has put on the page. See tests/chest-editor.spec.ts. */
const textInputValues = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        ([...document.querySelectorAll('input, textarea')] as HTMLInputElement[])
            .filter(el => el.style.cssText !== '')
            .map(el => el.value)
    )

/** Replaces what the dialog's one box holds by typing, which is what fires its 'changed'. */
async function typeSize(page: Page, text: string): Promise<void> {
    await page.evaluate(() => {
        const el = ([...document.querySelectorAll('input')] as HTMLInputElement[]).find(
            i => i.style.cssText !== ''
        )
        if (!el) throw new Error('no TextInput on the page')
        el.focus()
        el.select()
    })
    await page.keyboard.type(text)
}

/** The exported entity of this name, decoded from what the editor encodes now. */
async function exported(page: Page, name: string): Promise<Record<string, unknown>> {
    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    const entities = decodeBlueprintString(source).blueprint.entities as Record<string, unknown>[]
    const entity = entities.find(e => e.name === name)
    if (!entity) throw new Error(`no ${name} in the export`)
    return entity
}

test('an inserter with no override opens unticked, showing the fallback', async ({ page }) => {
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 1)

    // inserterStackSize's fallback for a plain inserter, which is what the info
    // panel assumes too.
    expect(await textInputValues(page)).toEqual(['3'])
    expect(await exported(page, 'inserter')).not.toHaveProperty('override_stack_size')
    expect(errors).toEqual([])
})

test('ticking the box writes an override, and one undo takes the field away again', async ({
    page,
}) => {
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 1)

    await clickCheckbox(page)
    expect((await exported(page, 'inserter')).override_stack_size).toBe(3)

    /*
        Absent, not 0 or 3: the undo has to delete the key, or the export gains
        a field the imported blueprint never had.
    */
    await page.keyboard.press('Control+KeyZ')
    expect(await exported(page, 'inserter')).not.toHaveProperty('override_stack_size')
    expect(await textInputValues(page)).toEqual(['3'])
    expect(errors).toEqual([])
})

test('unticking the box deletes the override', async ({ page }) => {
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 3)
    expect(await textInputValues(page)).toEqual(['7'])

    await clickCheckbox(page)
    expect(await exported(page, 'bulk-inserter')).not.toHaveProperty('override_stack_size')
    // Back to the bulk inserter's fallback.
    expect(await textInputValues(page)).toEqual(['12'])
    expect(errors).toEqual([])
})

test('a typed size survives an export and a reload', async ({ page }) => {
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 3)

    await typeSize(page, '10')
    expect((await exported(page, 'bulk-inserter')).override_stack_size).toBe(10)

    const source = await page.evaluate(() => window.__fbe_test.encodeLoaded())
    await closeDialog(page)
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)

    await openEditorOn(page, 3)
    expect(await textInputValues(page)).toEqual(['10'])
    expect(errors).toEqual([])
})

test('the box stops at the largest hand the inserter can have', async ({ page }) => {
    /*
        4 for a plain inserter and 16 for a stack inserter - the stack inserter's
        own stack_size_bonus of 4 on top of the bulk inserters' 12, which is the
        one number here read from its prototype rather than from technologies.
    */
    const errors = await load(page, INSERTERS)

    await openEditorOn(page, 1)
    await typeSize(page, '9')
    expect(await textInputValues(page)).toEqual(['4'])
    expect((await exported(page, 'inserter')).override_stack_size).toBe(4)

    await typeSize(page, '0')
    expect((await exported(page, 'inserter')).override_stack_size).toBe(1)

    await closeDialog(page)
    await openEditorOn(page, 4)
    await typeSize(page, '16')
    expect((await exported(page, 'stack-inserter')).override_stack_size).toBe(16)
    await typeSize(page, '17')
    expect((await exported(page, 'stack-inserter')).override_stack_size).toBe(16)
    expect(errors).toEqual([])
})

test('an override above the limit is kept as found', async ({ page }) => {
    /*
        The corpus has one fast inserter set to 12, three times what research
        can give it. Opening its dialog must not be what rewrites that.
    */
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 2)

    expect(await textInputValues(page)).toEqual(['12'])
    expect((await exported(page, 'fast-inserter')).override_stack_size).toBe(12)
    expect(errors).toEqual([])
})

test('an undo past the limit raises the range to the restored value', async ({ page }) => {
    /*
        Lowered to 3 and reopened, the dialog's range stops at the fast
        inserter's own 4. An undo then brings the 12 back. The range used to be
        fixed when the dialog opened, so the box was clamped to it and read 4
        while the entity held 12, and a typed 10 was cut down to 4.
    */
    const errors = await load(page, INSERTERS)
    await openEditorOn(page, 2)
    await typeSize(page, '3')
    await closeDialog(page)

    await openEditorOn(page, 2)
    expect(await textInputValues(page)).toEqual(['3'])

    await page.keyboard.press('Control+KeyZ')
    expect((await exported(page, 'fast-inserter')).override_stack_size).toBe(12)
    expect(await textInputValues(page)).toEqual(['12'])

    await typeSize(page, '10')
    expect((await exported(page, 'fast-inserter')).override_stack_size).toBe(10)
    expect(errors).toEqual([])
})

test('the info panel follows an undo while the inserter is hovered', async ({ page }) => {
    /*
        Without a listener the panel is rebuilt only when the pointer arrives,
        so an undo pressed while it is already showing the inserter would leave
        the old speed on screen.
    */
    const errors = await load(page, BETWEEN_CHESTS)
    const panelSpeed = async (): Promise<number> => {
        const text = await page.evaluate(() => window.__fbe_test.entityInfoPanelText())
        const match = /Speed: ([\d.]+) items\/s/.exec(text ?? '')
        if (!match) throw new Error(`no speed line in the panel, it said: ${text}`)
        return Number(match[1])
    }

    await openEditorOn(page, 2)
    await clickCheckbox(page)
    await page.keyboard.press('Escape')

    await hover(page, 2)
    expect(await panelSpeed()).toBeCloseTo(28.8, 2)

    await page.keyboard.press('Control+KeyZ')
    expect(await panelSpeed()).toBeCloseTo(16.8, 2)
    expect(errors).toEqual([])
})
