import { test, expect } from '@playwright/test'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { loadBlueprint, waitForEditor, OverlayTally } from './helpers/fbe-test-api'

/*
    Coverage net for OverlayContainer.createEntityInfo, ahead of clearing its 31
    strictNullChecks errors (issue #22).

    createEntityInfo builds the overlay drawn on top of an entity - the recipe
    icon, fluid arrows and their filter icons, module icons, filter icons,
    combinator signals, splitter priority arrows, the mining drill output arrow.
    Almost all of it is conditional on prototype fields the types mark optional
    (icon_draw_specification, module_slots, pipe_connections' direction vs
    positions), which is exactly what the refactor touches.

    Two failure modes need catching and they need different signals:

      - a read turned into a throw where the field is legitimately absent. The
        instance createEntityInfo wraps the static in a try/catch that warns and
        returns undefined, so this degrades to a missing overlay rather than a
        crash and nothing else in the suite notices. The tally calls the static
        directly, so a throw propagates and fails the test naming the entity.

      - a read turned into a silent skip, drawing fewer icons than before. That
        leaves no trace at all in logs, so the tally records child counts rather
        than just presence.

    Both fixtures are fixed points, not snapshots to regenerate. A diff means the
    overlay changed for that entity - review it as a behaviour change.
*/

/** Cardinals only, matching sprite-generation.spec.ts - see the note there. */
const DIRECTIONS = [0, 4, 8, 12]

type Page = import('@playwright/test').Page

async function tallyFor(page: Page, source: string): Promise<OverlayTally> {
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.overlayInfoTally())
}

/** Sorted distinct counts, dropping entities that never draw anything. */
function summarise(counts: Record<string, Iterable<number>>): Record<string, number[]> {
    return Object.fromEntries(
        Object.entries(counts)
            .map(([name, seen]) => [name, [...new Set(seen)].sort((a, b) => a - b)] as const)
            .filter(([, seen]) => seen.some(c => c !== -1))
            .sort(([a], [b]) => a.localeCompare(b))
    )
}

test('every entity draws the same info overlay it drew before', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const { source, names } = buildAllEntitiesBlueprint(DIRECTIONS)
    expect(names.length).toBeGreaterThan(100)

    /*
        Only entities that actually draw something are pinned. Most draw nothing -
        a chest has no overlay - and listing all ~155 would bury the interesting
        ones and churn whenever data.json gains an entity.
    */
    expect(summarise(await tallyFor(page, source))).toEqual(EXPECTED_SYNTHETIC)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/*
    The synthetic blueprint gives every entity default settings - no recipe, no
    modules, no filters, no splitter priority - so it only reaches the branches
    that depend on the prototype alone. The real bases are the only place the
    recipe, module, filter and combinator branches run at all, which is why both
    halves are needed here for the same reason they are in sprite-generation.
*/
test('real blueprints draw the same info overlays they drew before', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(String(e)))

    await waitForEditor(page)

    const combined: Record<string, Set<number>> = {}
    let entitiesSeen = 0

    for (const file of files) {
        const tally = await tallyFor(page, readBlueprintString(file.filePath))
        for (const [name, counts] of Object.entries(tally)) {
            entitiesSeen += counts.length
            for (const c of counts) (combined[name] ??= new Set()).add(c)
        }
    }

    expect(entitiesSeen).toBeGreaterThan(1000)
    expect(summarise(combined)).toEqual(EXPECTED_REAL)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
})

/**
 * Every entity in data.json, at default settings, in the four cardinal
 * directions. The counts are all 1 or 2 because with no recipe and no modules
 * the only branches reachable are the fluid connection arrows (boilers, engines,
 * valves, pumps), the combinator direction arrows, and the mining drill output
 * arrow.
 */
const EXPECTED_SYNTHETIC: Record<string, number[]> = {
    'arithmetic-combinator': [1],
    'big-mining-drill': [1],
    boiler: [2],
    'buffer-chest': [1],
    'burner-mining-drill': [1],
    'decider-combinator': [1],
    'electric-mining-drill': [1],
    'flamethrower-turret': [1],
    'fusion-generator': [2],
    'fusion-reactor': [2],
    'heat-exchanger': [2],
    'infinity-chest': [1],
    'infinity-pipe': [1],
    'offshore-pump': [1],
    'one-way-valve': [1],
    'overflow-valve': [1],
    pump: [1],
    pumpjack: [1],
    'requester-chest': [1],
    'selector-combinator': [1],
    'steam-engine': [2],
    'steam-turbine': [2],
    'storage-chest': [1],
    thruster: [2],
    'top-up-valve': [1],
}

/**
 * The real bases in test-blueprints/. This is the half that exercises the
 * settings-dependent branches: the crafting machines carry recipes (and so fluid
 * filter icons), the combinators carry signals, and fast-inserter and splitter
 * show both states - [-1, 1] means some are configured and some are not, which
 * is the discrimination that would be lost if a branch started skipping.
 */
const EXPECTED_REAL: Record<string, number[]> = {
    'arithmetic-combinator': [2],
    'assembling-machine-1': [-1, 1],
    'assembling-machine-2': [1, 3],
    'assembling-machine-3': [-1, 1, 2, 3, 4],
    biochamber: [2, 4],
    'buffer-chest': [1],
    'bulk-inserter': [-1, 1],
    'burner-inserter': [-1, 1],
    centrifuge: [2],
    'chemical-plant': [3, 4],
    'constant-combinator': [-1, 1],
    'cryogenic-plant': [4],
    'decider-combinator': [2],
    'display-panel': [-1, 1],
    'electric-furnace': [-1, 1],
    'electromagnetic-plant': [1, 2, 4],
    'express-splitter': [-1, 1],
    'fast-inserter': [-1, 1],
    foundry: [2, 4],
    'fusion-generator': [2],
    'fusion-reactor': [2],
    'heat-exchanger': [2],
    'infinity-chest': [-1, 1],
    'infinity-pipe': [1],
    inserter: [-1, 1],
    'long-handed-inserter': [-1, 1],
    'oil-refinery': [3, 4],
    pump: [1],
    recycler: [-1, 1],
    'requester-chest': [1],
    'rocket-silo': [1],
    splitter: [-1, 1],
    'stack-inserter': [-1, 1],
    'steam-turbine': [2],
    'storage-chest': [1],
    'turbo-splitter': [-1, 1],
}
