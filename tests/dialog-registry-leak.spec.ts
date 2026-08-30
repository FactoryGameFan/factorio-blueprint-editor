import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    A dialog whose constructor throws, and what it leaves behind (issue #280).

    Two separate things, and they are not alternatives.

    The NARROW half is `DisplayPanelEditor`. Every icon it draws is named by the
    blueprint - `control_behavior.parameters` carries an icon per row and a
    signal at each end of that row's condition - and `F.CreateIcon` ends in a
    bare `throw` for a name FD does not have. `data.json` exports no planet
    prototype at all, so `nauvis`, `vulcanus`, `fulgora` and `gleba` all reach
    it (issue #231), and 19 icon references in the committed corpus use one. The
    throw cost the whole dialog: clicking the panel did nothing at all. The fix
    is `F.SafeIcon`, so the cost is the one icon and a warning naming it.

    The GENERAL half is `Dialog`'s registry. `Dialog`'s constructor used to push
    `this` onto the static `s_openDialogs`, and `super()` runs before any
    subclass body, so a subclass that threw afterwards left an entry for a
    dialog that was never shown. `Dialog.anyOpen()` then answered true with
    nothing on screen, and `E` - which reads exactly that to decide between
    "close the top dialog" and "open the inventory" - went to the wrong branch.
    Registration moved to the `added` event, which a constructor that throws
    never reaches.

    Why the general half needs its own case, and its own entity. Once the narrow
    half is in, no display panel can reach the throw any more, so the registry
    fix would have nothing to prove. The third test uses an assembling machine
    carrying a recipe name FD does not have, which is the same class of input -
    a name out of the blueprint, reaching an unguarded `F.CreateIcon`, this time
    through `Editor`'s own `Recipe` slot. That editor is still broken and this
    spec does not fix it; it is the fixture precisely because it is broken.

    What can and cannot be observed. `window.__fbe_test.openDialogCount()` reads
    the pixi child count of `dialogsContainer`, so it cannot see a phantom
    registry entry at all - a leaked entry and a clean registry both read 0. The
    only thing that can see one is the keybind that branches on it, so the third
    test presses `E` and asks whether the inventory opened. That is also the
    thing the user actually loses.

    One correction to the issue text, measured. The phantom is not permanent:
    `closeLast()` calls `close()` on it, and `close()` filters the registry
    before it destroys anything, so the entry clears itself. The cost is one
    swallowed `E` (or `Escape`) per failed open, not a dead keybind for the
    session. Two failed opens cost two presses, which is why the third test
    clicks twice.

    MUTATION RECORD - each half reverted in turn, against this spec.

    1. `F.SafeIcon(...)` -> `F.CreateIcon(...)` at all three sites in
       `DisplayPanelEditor.ts` (the narrow half reverted, registry fix kept):
         - test 1 FAILS: `expect(received).toEqual(expected)` on the page-error
           list, `["Error: No item, fluid, recipe, signal or inventory group
           named nauvis"]` against `[]`; the dialog count assertion that follows
           would have failed too, 0 against 1.
         - test 2 FAILS the same way, naming `vulcanus`.
         - test 3 PASSES - it never opens a display panel.

    2. `this.once('added', () => Dialog.s_openDialogs.push(this))` ->
       `Dialog.s_openDialogs.push(this)` in `Dialog.ts` (the general half
       reverted, `F.SafeIcon` kept):
         - test 3 FAILS: `expect(received).toBe(expected)` on the dialog count
           after `E`, 0 against 1. Both phantoms are still queued, so the first
           `E` closes one instead of opening the inventory.
         - tests 1 and 2 PASS - nothing in them throws any more, so nothing
           leaks.

    3. Both reverted (the pre-fix code):
         - all three FAIL, each with its own message above.

    So neither half covers for the other, and neither test can pass for the
    wrong reason.

    4. The alternative the issue offers, measured rather than argued: the
       registry push left in the constructor, and a bare try/catch wrapped
       around `UIContainer.createEditor` instead (`F.SafeIcon` kept).
         - test 3 FAILS, and it fails at the CONTROL rather than at the keybind:
           `expect(received).toHaveLength(expected)`, 2 against 0, on the
           page-error filter that opens test 3. Swallowing the throw is all
           that catch does. The phantom entries are still queued and the `E`
           press after them still goes to the wrong branch; the test never
           gets that far, because the constructor's failure has stopped being
           visible at all. That is the whole objection to it, written down in
           `UIContainer.createEditor`'s own comment: it does not clear the
           registry - `s_openDialogs` is `protected`, so clearing it from there
           would need a new public escape hatch on `Dialog` - and it buys the
           silence of every future broken editor for nothing.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/*
    `connect_to_logistic_network` rather than a wire, because
    `Entity.generateConnector` is what puts the editor down its read-only
    conditions branch and either input satisfies it. A wire would need a second
    entity to run to; this needs one panel.
*/
function displayPanel(parameters: Record<string, unknown>[]): string {
    return encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        icons: [{ index: 1, signal: { type: 'item', name: 'display-panel' } }],
        entities: [
            {
                entity_number: 1,
                name: 'display-panel',
                position: { x: 0.5, y: 0.5 },
                control_behavior: { connect_to_logistic_network: true, parameters },
            },
        ],
    })
}

/** A planet as the row's own icon - `DisplayPanelEditor`'s parameter loop. */
const PLANET_ROW_ICON = displayPanel([
    {
        icon: { type: 'space-location', name: 'nauvis' },
        text: 'home',
        condition: {
            first_signal: { type: 'item', name: 'iron-plate' },
            comparator: '>',
            constant: 5,
        },
    },
])

/*
    A planet at each end of the condition instead - `createConditionDisplay`.
    Kept apart from the row icon so that reverting either call site on its own
    is caught: with both planets in one blueprint, whichever threw first would
    mask the other.
*/
const PLANET_CONDITION = displayPanel([
    {
        icon: { type: 'item', name: 'iron-plate' },
        text: 'away',
        condition: {
            first_signal: { type: 'space-location', name: 'vulcanus' },
            comparator: '<',
            second_signal: { type: 'space-location', name: 'gleba' },
        },
    },
])

/*
    An assembling machine naming a recipe FD does not have. Decodes and loads -
    the schema's `recipeName` keyword only warns - and then `Editor`'s `Recipe`
    slot calls `F.CreateIcon` on it with nothing catching, so the constructor
    throws after `super()` has run. The fixture for the registry half.
*/
const UNKNOWN_RECIPE = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'assembling-machine-1' } }],
    entities: [
        {
            entity_number: 1,
            name: 'assembling-machine-1',
            position: { x: 1.5, y: 1.5 },
            recipe: 'totally-not-a-recipe',
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

/*
    Hover then click, which is `openEntityGUI`. Steps away first because
    hovering is driven by GridData's `update32` and only fires when the pointer
    crosses a tile boundary - moving to a point it already occupies emits
    nothing. Same reason as display-panel-editor.spec.ts and chest-editor.spec.ts.
*/
async function clickEntity(page: Page, entityNumber: number): Promise<void> {
    const at = await page.evaluate(
        (n: number) => window.__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)

    await page.mouse.move(at.x, at.y + 240)
    await page.mouse.move(at.x, at.y)
    expect(await page.evaluate(() => window.__fbe_test.editorMode())).toBe('EDIT')

    await page.mouse.down()
    await page.mouse.up()
}

const dialogCount = (page: Page): Promise<number> =>
    page.evaluate(() => window.__fbe_test.openDialogCount())

test('a display panel row icon naming a planet costs the icon, not the dialog', async ({
    page,
}) => {
    const errors = await load(page, PLANET_ROW_ICON)
    expect(await dialogCount(page)).toBe(0)

    await clickEntity(page, 1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(await dialogCount(page)).toBe(1)

    /*
        The warning names the icon. It reaches the user as a toast rather than a
        console line - `G.logger` is wired to the website's toasts - so a probe
        listening on `page.on('console')` would see nothing and read a working
        guard as a silent skip.
    */
    await expect(page.locator('.toasts-warning', { hasText: 'nauvis' })).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await dialogCount(page)).toBe(0)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a condition signal naming a planet costs that icon, not the dialog', async ({ page }) => {
    const errors = await load(page, PLANET_CONDITION)

    await clickEntity(page, 1)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(await dialogCount(page)).toBe(1)

    // Both ends of the condition are guarded, not just the first.
    await expect(page.locator('.toasts-warning', { hasText: 'vulcanus' })).toBeVisible()
    await expect(page.locator('.toasts-warning', { hasText: 'gleba' })).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await dialogCount(page)).toBe(0)
})

test('an editor constructor that throws leaves the E keybind alone', async ({ page }) => {
    const errors = await load(page, UNKNOWN_RECIPE)

    /*
        Twice. One phantom entry costs one `E` press, so a single failed open
        would still let the second press through and a spec pressing twice would
        pass against the leak. Two failed opens against one press cannot.
    */
    await clickEntity(page, 1)
    await clickEntity(page, 1)

    /*
        The control for this whole test: the constructor really did throw, twice.
        Without it a change that quietly made the machine editor open would leave
        the assertion below passing while measuring nothing about the registry.
    */
    expect(errors.filter(e => e.includes('totally-not-a-recipe'))).toHaveLength(2)
    expect(await dialogCount(page)).toBe(0)

    // Nothing is open, so E opens the inventory. A leaked entry sends it to
    // `Dialog.closeLast()` instead and nothing appears.
    await page.keyboard.press('KeyE')
    expect(await dialogCount(page)).toBe(1)
})
