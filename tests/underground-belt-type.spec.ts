import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'
import { waitForEditor, loadBlueprint } from './helpers/fbe-test-api'

/*
    An underground belt with no `type` is an input. Factorio 2.0.77 reads one
    back as `type: "input"` and builds it with `belt_to_ground_type == "input"`
    (tools/oracle/fixtures/underground-type.json), and #547's pairing rule and
    the drawing both read it as an output instead.

    Each belt here has a transport belt facing north on its east side. An
    output there feeds the transport belt, which then draws as a curve; an input
    feeds nothing east of it, so the transport belt stays straight. That is the
    neighbour check in getBeltSprites, a different read from the one that picks
    the underground's own sheet, and both have to agree with the game.

    The three copies sit 10 tiles apart so none is a neighbour of another. The
    `output` copy is the control: without it, an underground whose type is
    ignored altogether would pass.
*/

const EAST = 4
const NORTH = 0

const rows: ('input' | 'output' | undefined)[] = [undefined, 'input', 'output']

const BELTS = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    entities: rows.flatMap((type, i) => [
        {
            entity_number: 2 * i + 1,
            name: 'underground-belt',
            position: { x: 0.5, y: 0.5 + 10 * i },
            direction: EAST,
            ...(type && { type }),
        },
        {
            entity_number: 2 * i + 2,
            name: 'transport-belt',
            position: { x: 1.5, y: 0.5 + 10 * i },
            direction: NORTH,
        },
    ]),
})

test('an underground belt with no type draws as an input, and so does the belt beside it', async ({
    page,
}) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)
    await loadBlueprint(page, BELTS)

    const tally = await page.evaluate(() => window.__fbe_test.spriteDataTally())
    const [untyped, input, output] = tally['underground-belt'] ?? []
    const [besideUntyped, besideInput, besideOutput] = tally['transport-belt'] ?? []

    // soft, so a failure reports the neighbour check and the sheet separately
    expect.soft(untyped).toBe(input)
    expect.soft(output).not.toBe(input)

    expect.soft(besideUntyped).toBe(besideInput)
    expect.soft(besideOutput).not.toBe(besideInput)

    expect(pageErrors).toEqual([])
})
