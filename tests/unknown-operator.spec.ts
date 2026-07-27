import { test, expect } from '@playwright/test'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    What the editor says when a combinator carries an operator it does not know
    (issue #55).

    The three combinator `draw_*` functions switch on the operator and each had
    a `default:` arm throwing a bare `Internal Error!`. That throw is caught by
    `getSpriteData`, which logs it and returns SPRITE_GENERATION_FAILED - so the
    entity became a placeholder box and the console line named neither the
    entity nor the operator. Same shape as the `graphicsFn is not a function`
    problem CLAUDE.md already documents.

    #55 called these "not known to fire" and asked whether they are genuinely
    unreachable or merely unreached. They are reachable: the schema constrains
    `operation` to an enum, but validation here is lenient - an enum violation
    is a warning, and `stripUnknownPrototypes` only drops unknown *prototype
    names*, not unknown field values. So an operator outside the enum survives
    decode and reaches the switch, which is exactly what a future Factorio
    version adding an operation would produce. This spec builds that blueprint.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md.
*/

type Page = import('@playwright/test').Page

/** Not in the schema's enum and not in any switch - a stand-in for a future one. */
const UNKNOWN = '<=>'

const BLUEPRINT = encode({
    item: 'blueprint',
    version: version(2, 0, 55),
    icons: [{ index: 1, signal: { type: 'item', name: 'arithmetic-combinator' } }],
    entities: [
        {
            entity_number: 1,
            name: 'arithmetic-combinator',
            position: { x: 0.5, y: 1 },
            control_behavior: {
                arithmetic_conditions: {
                    first_signal: { type: 'item', name: 'iron-plate' },
                    second_constant: 1,
                    operation: UNKNOWN,
                    output_signal: { type: 'item', name: 'iron-plate' },
                },
            },
        },
    ],
})

async function loadAndCollectWarnings(page: Page): Promise<string[]> {
    const messages: string[] = []
    page.on('console', m => {
        if (m.type() === 'warning' || m.type() === 'error') messages.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        await t.loadBp(await t.getBlueprintOrBookFromSource(src))
    }, BLUEPRINT)
    return messages
}

test('an unknown combinator operator is named in the warning it produces', async ({ page }) => {
    /*
        The whole point of #55. Before it, the only thing reaching the console
        from this path was the literal string "Internal Error!" wrapped in
        getSpriteData's "Error generating sprites for ..." line - which named
        the entity by luck, and the cause not at all.

        Asserting the operator appears is what pins the improvement: the entity
        name was already in the wrapper, the operator never was.
    */
    const messages = await loadAndCollectWarnings(page)
    const spriteWarnings = messages.filter(m => m.includes('Error generating sprites'))

    expect(spriteWarnings.join(' | ')).toContain('arithmetic-combinator')
    expect(spriteWarnings.join(' | ')).toContain(UNKNOWN)
    expect(spriteWarnings.join(' | ')).not.toContain('Internal Error!')
})

test('the blueprint still loads, with the combinator as a placeholder', async ({ page }) => {
    /*
        The throw is caught, so an unknown operator costs one entity's sprites
        and nothing else - the load succeeds and the entity is still in the
        model. Worth pinning separately: a change that turned this into a hard
        failure would take the whole blueprint down, which is the distinction
        issues #46 and #54 were about.
    */
    await loadAndCollectWarnings(page)

    expect(await page.evaluate(() => window.__fbe_test.entityContainerCount())).toBe(1)
})
