import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    The machine editor for Space Age's machines with module slots (issue #345).

    `UI/editors/factory.ts` routed only the twelve vanilla machines to
    `TempEditor`, so clicking a foundry, biochamber, biolab, crusher, cryogenic
    plant, electromagnetic plant, recycler or big mining drill opened nothing.
    Routing them there raised two layout problems this spec also pins:

    - `TempEditor` hid the recipe row for `electric-furnace` by name. The
      recycler is a furnace too, and would have got a picker over every item's
      recycling recipe, which the game never asks for.
    - `Modules` laid its slots out in one row. The cryogenic plant's eight
      reached x=510 in a 402-wide dialog, so they now wrap four to a row, which
      is the most any vanilla machine has.

    Everything is driven through the pointer, like tests/chest-editor.spec.ts:
    each slot is clicked where the intended layout puts it, and a pick from the
    inventory it opens has to reach the entity. A slot drawn anywhere else, or a
    recipe row where there should be none, moves what sits under those points,
    so a wrong layout fails by writing to the wrong thing or to nothing at all.
    The two vanilla rows at the end are controls: their layout must not move.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/*
    TempEditor puts the recipe slot at (208, 45) and the module slots at 208
    across, 38 lower when there is a recipe row. Slots are 36px square on a 38px
    pitch, and `Modules.COLUMNS` is four.
*/
const SLOTS_X = 208
const SLOTS_Y = 45
const SLOT_PITCH = 38
const SLOT_SIZE = 36
const SLOT_CENTRE = 18
const MODULE_COLUMNS = 4

/** TempEditor's size, which none of these machines should grow. */
const DIALOG_WIDTH = 402
const DIALOG_HEIGHT = 171

interface Machine {
    name: string
    /** Blueprint position, on the tile grid the machine's footprint needs. */
    position: { x: number; y: number }
    moduleSlots: number
    recipeRow: boolean
}

const MACHINES: Machine[] = [
    { name: 'foundry', position: { x: 0.5, y: 0.5 }, moduleSlots: 4, recipeRow: true },
    { name: 'biochamber', position: { x: 0.5, y: 0.5 }, moduleSlots: 4, recipeRow: true },
    // A lab has no recipe.
    { name: 'biolab', position: { x: 0.5, y: 0.5 }, moduleSlots: 4, recipeRow: false },
    { name: 'crusher', position: { x: 0, y: 0.5 }, moduleSlots: 2, recipeRow: true },
    { name: 'cryogenic-plant', position: { x: 0.5, y: 0.5 }, moduleSlots: 8, recipeRow: true },
    { name: 'electromagnetic-plant', position: { x: 0, y: 0 }, moduleSlots: 5, recipeRow: true },
    // A furnace, so it takes its recipe from what it is fed.
    { name: 'recycler', position: { x: 0, y: 0 }, moduleSlots: 4, recipeRow: false },
    // A mining drill has no recipe.
    { name: 'big-mining-drill', position: { x: 0.5, y: 0.5 }, moduleSlots: 4, recipeRow: false },
    // Controls: a vanilla machine with a recipe row, and a furnace without one.
    { name: 'assembling-machine-3', position: { x: 0.5, y: 0.5 }, moduleSlots: 4, recipeRow: true },
    { name: 'electric-furnace', position: { x: 0.5, y: 0.5 }, moduleSlots: 2, recipeRow: false },
]

async function load(page: Page, machine: Machine): Promise<string[]> {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    const source = encode({
        item: 'blueprint',
        version: version(2, 0, 55),
        icons: [{ index: 1, signal: { type: 'item', name: machine.name } }],
        entities: [{ entity_number: 1, name: machine.name, position: machine.position }],
    })

    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
    return errors
}

/** Hovers the entity and left clicks it. See tests/chest-editor.spec.ts for the step away. */
async function openEditorOn(page: Page, entityNumber: number): Promise<void> {
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

/** The topmost dialog's bounds, after two frames. See tests/chest-editor.spec.ts for why. */
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

async function click(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.up()
}

/** Picks the first item of the inventory now on top, which closes it. */
async function pickFirstItem(page: Page): Promise<void> {
    const inventory = await renderedDialogBounds(page)
    await click(page, inventory.x + 12 + SLOT_CENTRE, inventory.y + 126 + SLOT_CENTRE)
}

for (const machine of MACHINES) {
    test(`${machine.name} opens an editor with ${machine.moduleSlots} module slots${
        machine.recipeRow ? ' and a recipe' : ' and no recipe'
    }`, async ({ page }) => {
        const errors = await load(page, machine)
        await openEditorOn(page, 1)
        expect(await dialogCount(page)).toBe(1)

        const dialog = await renderedDialogBounds(page)
        expect(dialog.width).toBe(DIALOG_WIDTH)
        expect(dialog.height).toBe(DIALOG_HEIGHT)

        const modulesY = SLOTS_Y + (machine.recipeRow ? SLOT_PITCH : 0)
        const slotAt = (index: number): { x: number; y: number } => ({
            x: SLOTS_X + (index % MODULE_COLUMNS) * SLOT_PITCH,
            y: modulesY + Math.floor(index / MODULE_COLUMNS) * SLOT_PITCH,
        })

        for (let index = 0; index < machine.moduleSlots; index++) {
            const slot = slotAt(index)
            expect(slot.x + SLOT_SIZE, `slot ${index} right edge`).toBeLessThanOrEqual(dialog.width)
            expect(slot.y + SLOT_SIZE, `slot ${index} bottom edge`).toBeLessThanOrEqual(
                dialog.height
            )

            await click(page, dialog.x + slot.x + SLOT_CENTRE, dialog.y + slot.y + SLOT_CENTRE)
            expect(await dialogCount(page), `slot ${index} opens the module picker`).toBe(2)
            await pickFirstItem(page)
            expect(await dialogCount(page)).toBe(1)
        }

        // Every slot took its pick, and no click wrote anywhere else.
        const modules = await page.evaluate(() => window.__fbe_test.entityModules(1))
        expect(modules).toHaveLength(machine.moduleSlots)
        expect(modules.every(m => m !== undefined)).toBe(true)

        // The grid position after the last slot holds nothing, when it is inside the dialog.
        const next = slotAt(machine.moduleSlots)
        if (next.y + SLOT_SIZE <= dialog.height) {
            await click(page, dialog.x + next.x + SLOT_CENTRE, dialog.y + next.y + SLOT_CENTRE)
            expect(await dialogCount(page), 'no slot past the last one').toBe(1)
        }

        if (machine.recipeRow) {
            await click(page, dialog.x + SLOTS_X + SLOT_CENTRE, dialog.y + SLOTS_Y + SLOT_CENTRE)
            expect(await dialogCount(page), 'the recipe slot opens the recipe picker').toBe(2)
            await pickFirstItem(page)
            expect(await page.evaluate(() => window.__fbe_test.entityRecipe(1))).toBeTruthy()
        } else {
            // (208, 45) was module slot 0 above, so nothing there set a recipe.
            expect(await page.evaluate(() => window.__fbe_test.entityRecipe(1))).toBeUndefined()
        }

        expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    })
}
