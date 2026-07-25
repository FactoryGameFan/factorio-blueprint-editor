import { test, expect } from '@playwright/test'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    Coverage net for spriteDataBuilder.ts, which is one draw_* function per entity
    type and by far the largest remaining block of strictNullChecks errors
    (issue #22).

    getSpriteData wraps every generator in a try/catch that logs
    "Error generating sprites for '<name>'" and returns SPRITE_GENERATION_FAILED,
    so a draw_* function that reads a prototype field the data does not have
    degrades to a missing sprite rather than a crash. That is deliberate - see the
    note at the top of spriteShape.ts - but it means a refactor can silently break
    a whole entity type and the editor will still look like it works.

    The curated blueprints in wormeyman-tests/ only contain the entity types their
    authors happened to use, so this builds a synthetic blueprint holding one of
    every entity in data.json, in several directions, and asserts which ones fail.

    The expected-failure list is a fixed point. An entry appearing means a draw_*
    function stopped working; an entry disappearing means one started working,
    which is good but should be a deliberate change rather than a silent one.
*/

/*
    Directions are 16ths, so 0/4/8/12 are the cardinals. Every entity can be asked
    to face a cardinal - non-rotatable ones ignore it - and the failure set is the
    same for all four as it is for direction 0 alone.

    Direction 2 is deliberately excluded. It is a diagonal only rails can take, and
    asking a splitter or a combinator to face it fails 39 more entity types. Those
    are artefacts of the synthetic blueprint rather than sprite bugs, since nothing
    can place them that way.
*/
const DIRECTIONS = [0, 4, 8, 12]

/**
 * Entity types that cannot produce sprites today, and so render as a missing
 * sprite. Not an accepted cost - each is a real gap - but they predate this test.
 *
 * The last five are not placeable in a real blueprint: three decorative logos, a
 * Fulgoran ruin and a hidden internal entity. big-mining-drill is the one that
 * matters, a Space Age entity a player can actually build.
 */
const EXPECTED_FAILURES: string[] = [
    'factorio-logo-11tiles',
    'factorio-logo-16tiles',
    'factorio-logo-22tiles',
    'fulgoran-ruin-attractor',
    'hidden-electric-energy-interface',
]

test('every entity type produces sprites', async ({ page }) => {
    const { source, names } = buildAllEntitiesBlueprint(DIRECTIONS)
    expect(names.length).toBeGreaterThan(100)

    // "Error generating sprites for 'foo' (type: bar):" - see getSpriteData
    const failedNames = new Set<string>()
    const otherWarnings: string[] = []
    const pageErrors: string[] = []

    page.on('pageerror', e => pageErrors.push(String(e)))
    page.on('console', msg => {
        const text = msg.text()
        const failed = /Error generating sprites for '([^']+)'/.exec(text)
        if (failed) {
            failedNames.add(failed[1])
            return
        }
        const missing = /Entity '([^']+)' not found in FD.entities/.exec(text)
        if (missing) {
            failedNames.add(missing[1])
            return
        }
        if (msg.type() === 'error') otherWarnings.push(text)
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
        () => {
            const el = document.getElementById('loadingScreen')
            return el !== null && !el.classList.contains('active')
        },
        { timeout: 60_000 }
    )

    const placed = await page.evaluate(async (bpStr: string) => {
        const api = (window as any).__fbe_test
        const bp = await api.getBlueprintOrBookFromSource(bpStr)
        await api.loadBp(bp)
        // distinct names that survived parsing and actually got rendered
        return [...new Set([...bp.entities.values()].map((e: any) => e.name))].length
    }, source)

    // give async sprite work a chance to log
    await page.waitForTimeout(3000)

    // the blueprint has to actually have placed the entities, or this proves nothing
    expect(placed).toBeGreaterThan(100)

    expect([...failedNames].sort()).toEqual([...EXPECTED_FAILURES].sort())
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    The synthetic blueprint spaces entities out so none of them touch, which means
    it never reaches the branches that look at neighbours - pipes picking a
    junction sprite, belts picking a corner, undergrounds pairing up. Those read
    the position grid and are a large part of the file, so the real bases have to
    carry that half of the coverage.
*/
test('real blueprints generate sprites without failures', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const failures: string[] = []
    page.on('console', msg => {
        const failed = /Error generating sprites for '([^']+)'/.exec(msg.text())
        if (failed && !EXPECTED_FAILURES.includes(failed[1])) {
            failures.push(failed[1])
        }
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
        () => {
            const el = document.getElementById('loadingScreen')
            return el !== null && !el.classList.contains('active')
        },
        { timeout: 60_000 }
    )

    for (const file of files) {
        const bpString = readBlueprintString(file.filePath)
        await page.evaluate(async (str: string) => {
            const api = (window as any).__fbe_test
            const bp = await api.getBlueprintOrBookFromSource(str)
            await api.loadBp(bp)
        }, bpString)
    }
    await page.waitForTimeout(2000)

    expect([...new Set(failures)].sort()).toEqual([])
})
