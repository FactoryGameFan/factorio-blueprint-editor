import { test, expect } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    PositionGrid is the spatial index behind entity placement, overlap rules and
    the neighbour lookups the sprite builder uses, and nothing exercised it. The
    blueprint-loading suite covers decode and render; this covers the query and
    mutation surface, against a real blueprint rather than a hand-built fixture,
    because the interesting invariant is one that only holds in a real one: the
    grid stores entity numbers and trusts every one of them to still resolve
    against bp.entities.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

// a mid-sized blueprint with enough variety to cover multi-cell and shared cells
const BLUEPRINT = 'EARN/power-blocks-v22-0-8.rev-1'

test('PositionGrid answers queries and stays consistent through a mutation', async ({ page }) => {
    const blueprint = discoverBlueprintFiles().find(f => f.name === BLUEPRINT)
    if (!blueprint) throw new Error(`test blueprint ${BLUEPRINT} not found in test-blueprints/`)

    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const bpString = readBlueprintString(blueprint.filePath)

    const result = await page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        let bp = await api.getBlueprintOrBookFromSource(str)
        if (bp.selectBlueprint) bp = bp.selectBlueprint(0)

        const grid = bp.entityPositionGrid
        const entities = [...bp.entities.values()]
        const first = entities[0]

        // Every entity must be findable at its own position. This also asserts the
        // grid/bp.entities invariant end to end: resolving a stored number that has
        // no entity behind it throws rather than returning undefined.
        const unfindable = entities.filter(
            (e: any) => grid.getEntityAtPosition(e.position) === undefined
        ).length

        const farAway = { x: 99999, y: 99999 }
        const firstArea = {
            x: first.position.x,
            y: first.position.y,
            w: first.size.x,
            h: first.size.y,
        }

        // remove/re-add must leave the cell exactly as it was
        const before = grid.getEntityAtPosition(first.position)?.entityNumber
        grid.removeTileData(first)
        const whileRemoved = grid.getEntityAtPosition(first.position)?.entityNumber
        grid.setTileData(first)
        const after = grid.getEntityAtPosition(first.position)?.entityNumber

        return {
            entityCount: entities.length,
            unfindable,
            emptyPositionIsUndefined: grid.getEntityAtPosition(farAway) === undefined,
            neighbours: grid.getNeighbourData(farAway),
            emptyAreaIsEmpty: grid.isAreaEmpty({ ...farAway, w: 3, h: 3 }),
            availableOnEmptySpace: grid.isAreaAvailable('wooden-chest', farAway),
            availableOnTopOfEntity: grid.isAreaAvailable('wooden-chest', first.position),
            surroundingAllResolve: grid
                .getSurroundingEntities(firstArea)
                .every((e: any) => e !== undefined),
            entitiesInAreaIncludesSelf: grid
                .getEntitiesInArea(firstArea)
                .some((e: any) => e.entityNumber === first.entityNumber),
            // an entity is never a fast-replace candidate for its own name
            fastReplaceOnSelf: grid.checkFastReplaceableGroup(
                first.name,
                first.direction,
                first.position
            ),
            rotatedMatchNumber: grid.checkSameEntityAndDifferentDirection(
                first.name,
                (first.direction + 4) % 16,
                first.position
            )?.entityNumber,
            firstNumber: first.entityNumber,
            before,
            whileRemoved,
            after,
        }
    }, bpString)

    expect(result.entityCount).toBeGreaterThan(100)
    expect(result.unfindable).toBe(0)

    // empty space reads as empty everywhere it is asked about
    expect(result.emptyPositionIsUndefined).toBe(true)
    expect(result.neighbours).toHaveLength(4)
    expect(result.neighbours.every((n: { entity?: unknown }) => n.entity === undefined)).toBe(true)
    expect(result.emptyAreaIsEmpty).toBe(true)
    expect(result.availableOnEmptySpace).toBe(true)

    // occupied space blocks placement and reports its occupants
    expect(result.availableOnTopOfEntity).toBe(false)
    expect(result.surroundingAllResolve).toBe(true)
    expect(result.entitiesInAreaIncludesSelf).toBe(true)

    expect(result.fastReplaceOnSelf).toBeUndefined()
    expect(result.rotatedMatchNumber).toBe(result.firstNumber)

    // the mutation round trip restores the cell
    expect(result.before).toBe(result.firstNumber)
    expect(result.whileRemoved).toBeUndefined()
    expect(result.after).toBe(result.firstNumber)

    expect(errors).toEqual([])
})
