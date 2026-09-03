import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Every editor slot that draws an icon the blueprint named, and what it costs
    when that name is one FD does not have (issue #286).

    `F.CreateIcon` ends in a bare `throw` when the name is in none of
    `FD.items`, `FD.fluids`, `FD.recipes`, `FD.signals` or `FD.inventoryLayout`.
    Every name below comes out of a blueprint, and `UIContainer.createEditor` is
    a bare call with no `try` above it - on purpose, see the comment there - so
    an unguarded call costs the user the **whole dialog**: clicking the entity
    does nothing at all. `F.SafeIcon` is the fix, and the cost becomes one icon
    and a warning naming it.

    This is the same narrow half `tests/dialog-registry-leak.spec.ts` covers for
    two of `DisplayPanelEditor`'s three icon sites. It is a separate spec because
    that one is about #280's registry, and because the sites here are spread
    across four components that no single editor reaches.

    Why the display panel is here at all, when #280 was supposed to have closed
    it. `DisplayPanelEditor` has two branches and PR #285 guarded one of them.
    `if (connected)` draws the read-only conditions list, which is where the two
    guarded sites are; the `return` at the end of that branch means an
    unconnected panel instead reaches `new DisplayPanelIcon(entity)` further
    down, whose `F.CreateIcon` is bare. Both display panel specs on record set
    `connect_to_logistic_network: true`, so both take the guarded branch and
    neither can see this. An unconnected panel is the ordinary one.

    Reading the warning. It reaches the user as a **toast**, not a console line -
    `G.logger` is wired to the website's toasts at `index.ts` - so a probe
    listening on `page.on('console')` sees nothing and reads a working guard as a
    silent skip.

    Two of the six guards are not icon slots at all, and neither was in the
    issue. Running the first draft of this spec found them.

    - `Preview.generatePreview` called the **static**
      `OverlayContainer.createEntityInfo` with no `try` around it, where
      `OverlayContainer`'s own instance method wraps the identical call
      (`OverlayContainer.ts:493`). `Preview` is built by `Editor`'s base
      constructor, so that one throw cost *every* editor its dialog, not one
      entity type - it is why guarding `Recipe.ts` alone left the machine editor
      still refusing to open.
    - `EntityInfoPanel.updateVisualization` calls `getModule`, which throws by
      design (`factorioData.ts:255`, issue #55, to tell an absent item from a
      present non-module one). It runs from `pointerOverEventHandler`, so an
      unknown module threw on **hover**, before any click - no dialog involved.

    Both warn with `console.warn` rather than `G.logger`, which is the toast.
    They sit on paths that repeat - every hover, every preview redraw - so a
    toast each would be a stream of them. The icon slots raise the toast instead,
    once, when the dialog opens, which is what the assertions below read.

    MUTATION RECORD - each guard reverted in turn against this spec, measured
    rather than reasoned. Baseline 5 passed.

      Recipe.ts                 -> 1 fails: the recipe test
      DisplayPanelIcon.ts       -> 1 fails: the display panel test
      Modules.ts (both sites)   -> 1 fails: the module test
      Filters.ts (both sites)   -> 2 fail:  the chest and splitter tests
      Preview.ts try/catch      -> 3 fail:  recipe, module and chest
      EntityInfoPanel.readModule-> 1 fails: the module test

    So no guard is invisible, and the two Filters arms need both the chest test
    (`CreateIconWithAmount`, amounts on) and the splitter test (`CreateIcon`,
    amounts off) - one alone leaves the other arm unmeasured.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/** Not a recipe, module, item or signal in `data.json`. Distinct per case so a warning cannot be attributed to the wrong one. */
const NO_SUCH_RECIPE = 'totally-not-a-recipe'
const NO_SUCH_MODULE = 'totally-not-a-module'
const NO_SUCH_FILTER_ITEM = 'totally-not-a-filter-item'
const NO_SUCH_SPLITTER_ITEM = 'totally-not-a-splitter-item'

/** `defines.inventory.crafter_modules`, read off data.json rather than guessed. */
const MODULE_INVENTORY = 4

function blueprint(entity: Record<string, unknown>): string {
    return encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        icons: [{ index: 1, signal: { type: 'item', name: 'assembling-machine-1' } }],
        entities: [{ entity_number: 1, position: { x: 1.5, y: 1.5 }, ...entity }],
    })
}

/** `Editor`'s Recipe slot, via MachineEditor. The site issue #286 names. */
const UNKNOWN_RECIPE = blueprint({
    name: 'assembling-machine-2',
    recipe: NO_SUCH_RECIPE,
})

/*
    `DisplayPanelIcon`, via the branch #285 did not reach. No
    `connect_to_logistic_network` and no wire, so `Entity.generateConnector` is
    false and the editor falls past the conditions branch to the icon slot.
    `Entity.displayPanelIcon` reads `m_rawEntity.icon` first, which is where the
    GUI puts the icon a user picks.
*/
const UNKNOWN_PANEL_ICON = blueprint({
    name: 'display-panel',
    icon: { type: 'space-location', name: 'nauvis' },
    text: 'home',
})

/** `Modules`, via MachineEditor. An assembling-machine-3 has four module slots. */
const UNKNOWN_MODULE = blueprint({
    name: 'assembling-machine-3',
    items: [
        {
            id: { name: NO_SUCH_MODULE },
            items: { in_inventory: [{ inventory: MODULE_INVENTORY, stack: 0 }] },
        },
    ],
})

/** `Filters` with amounts on, via ChestEditor - the `CreateIconWithAmount` arm. */
const UNKNOWN_CHEST_FILTER = blueprint({
    name: 'requester-chest',
    request_filters: {
        sections: [
            {
                index: 1,
                filters: [{ index: 1, name: NO_SUCH_FILTER_ITEM, count: 5, comparator: '=' }],
            },
        ],
    },
})

/** `Filters` with amounts off, via SplitterEditor - the `CreateIcon` arm beside it. */
const UNKNOWN_SPLITTER_FILTER = blueprint({
    name: 'fast-splitter',
    filter: { name: NO_SUCH_SPLITTER_ITEM },
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
    Hover then click, which is `openEntityGUI`. Steps away first because hovering
    is driven by GridData's `update32` and only fires when the pointer crosses a
    tile boundary - moving to a point it already occupies emits nothing. Same
    reason as dialog-registry-leak.spec.ts and chest-editor.spec.ts.
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

/*
    The shared shape of every case: the editor opens, nothing reaches the page
    error handler, and the unknown name is named in a warning the user can see.

    All three assertions carry weight. The dialog count is the bug; the empty
    error list is what tells a guard from a swallowed throw somewhere higher; and
    the toast is what stops a "fix" that simply drops the icon silently, which
    would pass the first two and leave the user with no idea why the slot is
    blank.
*/
async function expectIconCostsOnlyTheIcon(page: Page, source: string, name: string): Promise<void> {
    const errors = await load(page, source)
    expect(await dialogCount(page)).toBe(0)

    await clickEntity(page, 1)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(await dialogCount(page)).toBe(1)
    await expect(page.locator('.toasts-warning', { hasText: name })).toBeVisible()
}

test('a machine naming a recipe the data lacks still opens its editor', async ({ page }) => {
    await expectIconCostsOnlyTheIcon(page, UNKNOWN_RECIPE, NO_SUCH_RECIPE)
})

test('an unconnected display panel with a planet icon still opens its editor', async ({ page }) => {
    await expectIconCostsOnlyTheIcon(page, UNKNOWN_PANEL_ICON, 'nauvis')
})

test('a machine holding a module the data lacks still opens its editor', async ({ page }) => {
    await expectIconCostsOnlyTheIcon(page, UNKNOWN_MODULE, NO_SUCH_MODULE)
})

test('a chest filtering on an item the data lacks still opens its editor', async ({ page }) => {
    await expectIconCostsOnlyTheIcon(page, UNKNOWN_CHEST_FILTER, NO_SUCH_FILTER_ITEM)
})

test('a splitter filtering on an item the data lacks still opens its editor', async ({ page }) => {
    await expectIconCostsOnlyTheIcon(page, UNKNOWN_SPLITTER_FILTER, NO_SUCH_SPLITTER_ITEM)
})
