import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    The first spec that dispatches real pointer and keyboard input (issue #44).
    Every other spec drives the model layer through window.__fbe_test hooks, which
    was a deliberate trade - injecting blueprints directly is fast and avoids URL
    length limits - but it means nothing covers the point where a user touches
    anything, and 29 of the strictNullChecks errors left in #22 live in exactly
    that code.

    This covers every mode the canvas has:

        NONE -> PAN     left drag on empty space
        NONE -> COPY    ctrl + left drag
        NONE -> DELETE  ctrl + right drag
        NONE -> EDIT    hovering an entity
        EDIT -> PAINT   pipette (Q)
        COPY -> PAINT   releasing a ctrl drag that selected something

    The bindings are in Editor.ts's ActionRegistry.

    The first three need no entity under the cursor, and run against the empty
    blueprint the editor opens with, so every point on the canvas is empty space
    and a press cannot be caught by an entity under the cursor.

    The last three need one, and load a synthetic blueprint of three chests
    rather than anything from the corpus - a spec that has to say "the pointer is
    now on entity 2" wants a blueprint whose entity numbers it chose itself.
    Reaching them needed one editor addition, `BlueprintContainer.toScreen`: the
    editor only ever mapped screen -> world, so nothing could put the pointer on
    a chosen entity, and hovering is the sole way into EDIT.

    Both routes into PAINT are real input rather than a call to
    spawnPaintContainer, and they are not redundant - pipette builds a
    PaintEntityContainer and the copy release builds a PaintBlueprintContainer,
    which are different classes with different rotate and flip behaviour.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

const CANVAS = '#editor'

type Page = import('@playwright/test').Page

const modeOf = (page: Page): Promise<string> =>
    page.evaluate(() => (window as any).__fbe_test.editorMode())

const hoveredEntityNumber = (page: Page): Promise<number | undefined> =>
    page.evaluate(() => (window as any).__fbe_test.hoveredEntityNumber())

async function openEditor(page: Page): Promise<{ x: number; y: number }> {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const box = await page.locator(CANVAS).boundingBox()
    if (!box) throw new Error('the editor canvas has no bounding box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/*
    Three 1x1 entities in a row at the origin. Small on purpose: initBP centres
    the viewport on the blueprint's bounds, so a compact one puts every entity
    near the middle of the canvas at a comfortable zoom, and leaves the rest of
    the canvas as the empty space these tests move to.
*/
const THREE_CHESTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'wooden-chest', position: { x: 1.5, y: 0.5 } },
        { entity_number: 3, name: 'wooden-chest', position: { x: 2.5, y: 0.5 } },
    ],
})

async function openEditorWithEntities(page: Page): Promise<void> {
    await openEditor(page)
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, THREE_CHESTS)
}

/** Where an entity of the loaded blueprint currently is, in client coordinates. */
async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

/** Whether the paint container is drawn; undefined when there is none. */
const paintVisible = (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() => (window as any).__fbe_test.paintContainerVisible())

/*
    How many entities the canvas is holding. Reuses the container tally #42 left
    behind rather than adding a hook: one blueprint has been loaded, so the
    static map holds exactly its entities, and placing a paste adds to both.
*/
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.entityContainerCount())

/*
    A point the pointer can sit at that is off the canvas. Negative client
    coordinates do get dispatched, and BlueprintContainer then hides the paint
    container - which is the state the rotate tests below need, and the only one
    a spec can reach: the canvas fills the window, so there is no in-viewport
    point that is outside it except the UI panels.
*/
const OFF_CANVAS = { x: -20, y: -20 }

/** Ctrl-drags across all three chests and releases, which leaves PAINT. */
async function copyIntoPaint(page: Page): Promise<void> {
    const first = await screenOf(page, 1)
    const last = await screenOf(page, 3)

    await page.mouse.move(first.x, first.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(last.x, last.y)
    await page.mouse.up()
    await page.keyboard.up('Control')
}

test('a left drag on empty space enters and leaves PAN', async ({ page }) => {
    const centre = await openEditor(page)

    await page.mouse.move(centre.x, centre.y)
    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.down()
    expect(await modeOf(page)).toBe('PAN')

    // The drag itself, so panEnd is reached from a moved viewport rather than a
    // press and release in place.
    await page.mouse.move(centre.x + 64, centre.y + 32)
    expect(await modeOf(page)).toBe('PAN')

    await page.mouse.up()
    expect(await modeOf(page)).toBe('NONE')
})

test('ctrl and a left drag enter and leave COPY', async ({ page }) => {
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)

    await page.keyboard.down('Control')
    await page.mouse.down()
    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.move(centre.x + 96, centre.y + 96)
    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await modeOf(page)).toBe('NONE')
})

test('ctrl and a right drag enter and leave DELETE', async ({ page }) => {
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)

    await page.keyboard.down('Control')
    await page.mouse.down({ button: 'right' })
    expect(await modeOf(page)).toBe('DELETE')

    await page.mouse.move(centre.x + 96, centre.y + 96)
    expect(await modeOf(page)).toBe('DELETE')

    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')
    expect(await modeOf(page)).toBe('NONE')
})

test('hovering an entity enters EDIT, and leaving it returns to NONE', async ({ page }) => {
    await openEditorWithEntities(page)

    const chest = await screenOf(page, 2)
    // Somewhere the blueprint does not reach - the chests are a single row at
    // the origin, so straight down is empty whatever the zoom.
    const empty = { x: chest.x, y: chest.y + 240 }

    await page.mouse.move(empty.x, empty.y)
    expect(await modeOf(page)).toBe('NONE')

    await page.mouse.move(chest.x, chest.y)
    expect(await modeOf(page)).toBe('EDIT')

    await page.mouse.move(empty.x, empty.y)
    expect(await modeOf(page)).toBe('NONE')
})

test('EDIT follows the pointer from one entity to the next', async ({ page }) => {
    /*
        Moving between two adjacent entities without passing over empty space
        takes the branch that swaps the hover container while already in EDIT,
        rather than the enter-from-NONE one. Worth separating: updateHoverContainer
        returns early when the container is unchanged, so a swap that failed to
        fire would leave the box on the first entity and still report EDIT.
    */
    await openEditorWithEntities(page)

    const first = await screenOf(page, 1)
    const second = await screenOf(page, 2)

    await page.mouse.move(first.x, first.y)
    expect(await modeOf(page)).toBe('EDIT')

    await page.mouse.move(second.x, second.y)
    expect(await modeOf(page)).toBe('EDIT')
    expect(await hoveredEntityNumber(page)).toBe(2)
})

test('pipette on a hovered entity enters PAINT', async ({ page }) => {
    await openEditorWithEntities(page)

    const chest = await screenOf(page, 1)
    await page.mouse.move(chest.x, chest.y)
    expect(await modeOf(page)).toBe('EDIT')

    await page.keyboard.press('KeyQ')
    expect(await modeOf(page)).toBe('PAINT')

    /*
        Pipette again while painting destroys the container rather than stacking
        a second one. The mode lands back on EDIT rather than NONE: the paint
        container's `destroyed` handler sets NONE and then runs
        updateHoverContainer, and the pointer never left the chest. Asserting
        EDIT here is the stronger check of the two - NONE would also be the
        answer if the hover had simply failed to come back.
    */
    await page.keyboard.press('KeyQ')
    expect(await modeOf(page)).toBe('EDIT')
    expect(await hoveredEntityNumber(page)).toBe(1)
})

test('releasing a ctrl drag that selected entities enters PAINT', async ({ page }) => {
    await openEditorWithEntities(page)

    const first = await screenOf(page, 1)
    const last = await screenOf(page, 3)

    await page.mouse.move(first.x, first.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    expect(await modeOf(page)).toBe('COPY')

    await page.mouse.move(last.x, last.y)
    await page.mouse.up()
    await page.keyboard.up('Control')

    // exitCopyMode spawns a paint container from whatever the drag selected, so
    // the mode after release is PAINT rather than NONE - which is what the same
    // gesture gives on the empty blueprint above.
    expect(await modeOf(page)).toBe('PAINT')
})

/*
    The four rotate/flip cases against a pasted blueprint. Each starts from a
    fresh paint container on purpose: an earlier version of this shared one
    across cases and read a false pass, because the case that destroys the
    container ran first and left the rest asserting against no container at all.
*/
test('rotating a visible paste keeps it in PAINT', async ({ page }) => {
    await openEditorWithEntities(page)
    await copyIntoPaint(page)

    await page.keyboard.press('KeyR')

    // The control for the hidden case below. rotate() rebuilds the container
    // from rotated copies, so PAINT here means the rebuild worked.
    expect(await modeOf(page)).toBe('PAINT')
    expect(await paintVisible(page)).toBe(true)
})

test('flipping a paste with the pointer off the canvas keeps it', async ({ page }) => {
    await openEditorWithEntities(page)
    await copyIntoPaint(page)

    await page.mouse.move(OFF_CANVAS.x, OFF_CANVAS.y)
    expect(await paintVisible(page)).toBe(false)

    await page.keyboard.press('Shift+KeyF')

    // flippedEntities has no visibility check, so this survives. It is the
    // sibling that shows the check on rotatedEntities is not load-bearing.
    expect(await modeOf(page)).toBe('PAINT')
})

test('rotating a paste with the pointer off the canvas keeps it (issue #53)', async ({ page }) => {
    /*
        rotatedEntities used to return undefined while hidden, and rotate()
        destroys the container before spawning what it returns - so
        spawnPaintContainer got undefined, PaintBlueprintContainer's constructor
        threw on it, and the catch dropped the whole paste to NONE with only a
        console error. Keyboard actions are global, so the pointer being off the
        canvas does not stop the rotate from firing.

        The container comes back visible rather than hidden, even though the
        pointer has not returned. That is not a second bug being pinned here:
        it is exactly what flipping while hidden does above, and matching flip
        was the point. `isPointerInside` hit-tests gridData.x/y, which are world
        coordinates rather than screen ones, so the re-hide at the end of
        spawnPaintContainer does not fire for an off-canvas pointer.
    */
    const errors: string[] = []
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await openEditorWithEntities(page)
    await copyIntoPaint(page)

    await page.mouse.move(OFF_CANVAS.x, OFF_CANVAS.y)
    expect(await paintVisible(page)).toBe(false)

    await page.keyboard.press('KeyR')

    expect(await modeOf(page)).toBe('PAINT')
    expect(await paintVisible(page)).toBeDefined()
    expect(errors.join(' | ')).not.toContain('Failed to create paint container')
})

test('a paste rotated while hidden is still placeable when the pointer returns', async ({
    page,
}) => {
    /*
        The rotate above proves the container survived; this proves it is still
        usable, which is what the user lost. Places it and checks the blueprint
        grew - a container that survived as a husk would pass the first test and
        fail this one.
    */
    await openEditorWithEntities(page)
    await copyIntoPaint(page)

    await page.mouse.move(OFF_CANVAS.x, OFF_CANVAS.y)
    await page.keyboard.press('KeyR')

    // Well clear of the three chests, so the paste has somewhere to land.
    const chest = await screenOf(page, 2)
    await page.mouse.move(chest.x, chest.y + 200)
    await page.mouse.down()
    await page.mouse.up()

    expect(await entityCount(page)).toBe(6)
})

test('the modes do not leak into one another', async ({ page }) => {
    /*
        Each entry/exit pair is registered independently, so the thing worth
        checking is that running them back to back leaves no mode set - an
        exit that failed to fire would show up here rather than in the tests
        above, each of which starts from a fresh page.
    */
    const centre = await openEditor(page)
    await page.mouse.move(centre.x, centre.y)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Control')
        await page.mouse.down()
        await page.mouse.move(centre.x + 32, centre.y + 32)
        await page.mouse.up()
        await page.keyboard.up('Control')
        expect(await modeOf(page)).toBe('NONE')

        await page.mouse.down()
        await page.mouse.move(centre.x, centre.y)
        await page.mouse.up()
        expect(await modeOf(page)).toBe('NONE')
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
