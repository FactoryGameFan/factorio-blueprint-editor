import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { suppressOverlays } from './helpers/overlays'

/*
    Pasting a wired selection, which is the only consumer of
    PaintBlueprintEntityContainer.placeEntityContainer's return value.

    That method answers the entity it created, or undefined where it created
    none - a fast replace and a rotate-in-place both reuse an entity that already
    exists. PaintBlueprintContainer collects the ones that are not undefined into
    an old-number -> new-number map and copies each wire whose *both* ends are in
    it. So the return value does not decide whether entities get placed; it
    decides whether their wires come with them, which is why placing entities and
    counting them cannot see a mistake in it.

    Nothing covered this: wire-connections.spec.ts walks a blueprint it decoded
    itself, and the paste path only exists in the live editor.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

type Page = import('@playwright/test').Page

/*
    Two constant combinators joined by one green wire. The 2.0 `wires` form is
    [entity, connector, entity, connector], and 2 is the green circuit connector
    on a combinator's input side.
*/
const TWO_WIRED = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [
        { entity_number: 1, name: 'constant-combinator', position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: 'constant-combinator', position: { x: 2.5, y: 0.5 } },
    ],
    wires: [[1, 2, 2, 2]],
})

const wireCount = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.wireCount())

const entityCount = (page: Page): Promise<number> =>
    page.evaluate(() => (window as any).__fbe_test.entityContainerCount())

async function screenOf(page: Page, entityNumber: number): Promise<{ x: number; y: number }> {
    const at = await page.evaluate(
        (n: number) => (window as any).__fbe_test.entityScreenPosition(n),
        entityNumber
    )
    if (!at) throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    return at
}

async function load(page: Page, source = TWO_WIRED): Promise<void> {
    await suppressOverlays(page)
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = (window as any).__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, source)
}

/** Ctrl drag from one screen point to another, which leaves PAINT holding a copy. */
async function copySelection(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number }
): Promise<void> {
    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(to.x, to.y)
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await page.evaluate(() => (window as any).__fbe_test.editorMode())).toBe('PAINT')
}

async function clickAt(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.up()
}

test('the blueprint loads with its wire', async ({ page }) => {
    // The baseline the paste is measured against - a wire that failed to decode
    // would make the interesting test below pass for the wrong reason.
    await load(page)
    expect(await entityCount(page)).toBe(2)
    expect(await wireCount(page)).toBe(1)
})

test('pasting a wired selection brings the wire with it', async ({ page }) => {
    await load(page)

    const first = await screenOf(page, 1)
    const second = await screenOf(page, 2)

    // Ctrl drag across both, which leaves PAINT holding a copy.
    await page.mouse.move(first.x, first.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(second.x, second.y)
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await page.evaluate(() => (window as any).__fbe_test.editorMode())).toBe('PAINT')

    // Well clear of the originals, so the paste has somewhere to land.
    await page.mouse.move(first.x, first.y + 220)
    await page.mouse.down()
    await page.mouse.up()

    expect(await entityCount(page)).toBe(4)
    // The copy's own wire, alongside the original's.
    expect(await wireCount(page)).toBe(2)
})

test('a wire whose other end was not selected is not copied', async ({ page }) => {
    /*
        A wire with one end outside the selection must not come along. The
        original pair keeps its wire; the lone copy arrives with none.

        Two checks enforce this and they cover each other, which is worth knowing
        before touching either:

          1. copy time - PaintBlueprintContainer builds its own Blueprint from
             the selection and filters wires through an entity-number whitelist,
             so a half-connected wire never enters the thing being pasted;
          2. paste time - `en0 === undefined || en1 === undefined`, which drops a
             wire whose ends did not both make it into the new-number map.

        Weakening *either* on its own leaves this test passing, because the other
        still catches it. Weakening both fails it, and loudly: serializeBpWires
        throws "Wire connects to entity undefined", since it refuses to drop an
        endpoint it cannot resolve rather than silently exporting a wire-less
        blueprint.

        So this is a backstop on the property, not coverage of either check. If
        one of them ever looks redundant, it is - and this is what says removing
        both is not.
    */
    await load(page)

    const first = await screenOf(page, 1)

    // A ctrl drag that starts and ends on the first combinator only.
    await page.mouse.move(first.x, first.y)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.move(first.x + 4, first.y + 4)
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await page.evaluate(() => (window as any).__fbe_test.editorMode())).toBe('PAINT')

    await page.mouse.move(first.x, first.y + 220)
    await page.mouse.down()
    await page.mouse.up()

    expect(await entityCount(page)).toBe(3)
    expect(await wireCount(page)).toBe(1)
})

/*
    Pasted electric poles wire themselves to the poles already on the map, as a
    pole placed by hand does (#343). The rule is in WireConnections.autoConnectPoles
    and is pinned row by row against the game in poleAutoConnect.test.ts; these
    two check that a real paste reaches it, which no unit test can see.
*/

const pole = (entity_number: number, x: number): Record<string, unknown> => ({
    entity_number,
    name: 'medium-electric-pole',
    position: { x, y: 0.5 },
})

/** Two medium poles 6 tiles apart, in reach of each other (9) but not wired. */
const TWO_POLES_6_APART = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [pole(1, 0.5), pole(2, 6.5)],
})

/** Two medium poles 4 tiles apart, not wired. */
const TWO_POLES_4_APART = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: [pole(1, 0.5), pole(2, 4.5)],
})

test('a pasted pole wires to the map poles in reach, in one undo step', async ({ page }) => {
    await load(page, TWO_POLES_6_APART)
    expect(await entityCount(page)).toBe(2)
    expect(await wireCount(page)).toBe(0)

    const first = await screenOf(page, 1)
    const second = await screenOf(page, 2)

    // Copy the first pole alone, then paste it on the tile halfway between
    // the two - 3 tiles from each, so both are in reach.
    await copySelection(page, first, { x: first.x + 4, y: first.y + 4 })
    await clickAt(page, { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 })

    expect(await entityCount(page)).toBe(3)
    expect(await wireCount(page)).toBe(2)

    // The pole and both of its wires go back together.
    await page.keyboard.press('Control+KeyZ')
    expect(await entityCount(page)).toBe(2)
    expect(await wireCount(page)).toBe(0)
})

test('pasted poles do not auto-wire to each other', async ({ page }) => {
    // The game leaves two unwired poles in one blueprint unwired, even within
    // reach of each other. Passing the hand-placement flag on paste instead of
    // this fix would wire the second to the first.
    await load(page, TWO_POLES_4_APART)
    expect(await wireCount(page)).toBe(0)

    // Zoom out until 12 tiles fit on screen above the poles.
    const start = await screenOf(page, 1)
    await page.mouse.move(start.x, start.y)
    const tileWidth = async (): Promise<number> =>
        ((await screenOf(page, 2)).x - (await screenOf(page, 1)).x) / 4
    for (let i = 0; i < 20 && (await tileWidth()) > 20; i++) {
        await page.mouse.wheel(0, 100)
    }

    const first = await screenOf(page, 1)
    const second = await screenOf(page, 2)
    const pixelsPerTile = (second.x - first.x) / 4

    await copySelection(page, first, second)
    // 12 tiles north: out of reach of both originals, so nothing can wire.
    await clickAt(page, {
        x: (first.x + second.x) / 2,
        y: first.y - 12 * pixelsPerTile,
    })

    expect(await entityCount(page)).toBe(4)
    expect(await wireCount(page)).toBe(0)
})
