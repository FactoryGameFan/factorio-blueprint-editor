import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeBlueprint as encode, packVersion as version } from './helpers/encode-blueprint'

/*
    Which tiles the position grid hands to each rail, and therefore which tiles
    select it (issue #142).

    `PositionGrid` keys integer tiles from `getEntitySize`, and `getEntitySize`
    reads `e.tile_width || <computed from collision_box>`. Every rail currently
    has no `tile_width` - it is a **runtime** property of `LuaEntityPrototype`
    that does not exist at the data stage, so `data.json` cannot carry it and the
    exporter is not dropping it - so every rail footprint here is the computed
    fallback. The game's own numbers disagree for every curved type
    (`curved-rail-a` 2x4 against 2x6, `curved-rail-b` 2x2 against 2x5,
    `legacy-curved-rail` 4x8 against 4x4), which is what #142 was about.

    **The change this was the "before" picture for is not coming, and the
    numbers above are why it looked like it should.** #142 was measured in full
    (`tools/oracle/fixtures/entity-tile-size.json`, the first capture here taken
    on a 2.0.x binary) and the premise did not survive: `tile_width` is a
    **centring parity**, not a footprint - the runtime docs say it decides
    whether an entity's centre sits at a tile centre or a tile border - and for
    8 of the 9 entities where it disagrees with the editor, the published
    rectangle does not contain the entity's own collision box. Checked against
    `fixtures/rail-occupancy.json` before any code was written, adopting it
    makes agreement with measured occupancy worse in both directions over all 38
    orientations: occupied-but-not-keyed 180 -> 188, keyed-but-empty 96 -> 152.

    So this is now a fixed point guarding footprints that are staying put, which
    is the more useful thing for it to be. The footprint is not only a placement
    rule: `getEntityAtPosition` reads the same cells, so it decides what a click
    selects. A `legacy-curved-rail` going 4x4 -> 4x8 would double the area that
    selects it and `curved-rail-a` going 2x6 -> 2x4 would shrink it, and nothing
    else in the suite could see either - every other spec hovers an entity's
    **centre**, which selects it whatever its size. So a change to footprints
    would land with the suite green and the only symptom would be users finding
    rails harder or easier to click.

    A fixed point, not a refreshable snapshot. A diff here is a real change to
    what the editor selects and places, and wants reading cell by cell.

    Needs no pointer, no rendering and no viewport - it reads the grid straight
    off a decoded blueprint, the way `position-grid.spec.ts` does. That is worth
    keeping: it makes this the one piece of placement coverage that cannot go
    intermittent.
*/

const FIXTURE = join(__dirname, '__fixtures__', 'rail-footprints.json')

/** Every rail prototype the editor knows, plus two controls that are not rails. */
const RAILS = [
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
    'elevated-straight-rail',
    'elevated-half-diagonal-rail',
    'elevated-curved-rail-a',
    'elevated-curved-rail-b',
]

/*
    Controls. If a change to footprints touched everything rather than rails,
    these move too and say so - the same reason the elevated-rail fix in #136
    has a test involving no elevated rail at all.
*/
const CONTROLS = ['steel-chest', 'assembling-machine-2']

/** Cardinal and diagonal, which is where `getEntitySize` swaps width for height. */
const DIRECTIONS = [0, 2, 4, 6]

/** Far enough apart that no two footprints can reach each other's cells. */
const SPACING = 24

interface Placed {
    name: string
    direction: number
    entityNumber: number
}

const buildBlueprint = (): { source: string; placed: Placed[] } => {
    const entities: Record<string, unknown>[] = []
    const placed: Placed[] = []
    let n = 0
    for (const name of [...RAILS, ...CONTROLS]) {
        for (const direction of DIRECTIONS) {
            n++
            const col = n % 8
            const row = Math.floor(n / 8)
            entities.push({
                entity_number: n,
                name,
                position: { x: col * SPACING + 0.5, y: row * SPACING + 0.5 },
                direction,
            })
            placed.push({ name, direction, entityNumber: n })
        }
    }
    return {
        source: encode({ item: 'blueprint', version: version(2, 0, 55), entities }),
        placed,
    }
}

test('the cells each rail claims, and so the cells that select it', async ({ page }) => {
    const { source, placed } = buildBlueprint()

    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })

    const tally = await page.evaluate(
        async (args: { src: string; placed: Placed[]; reach: number }) => {
            const api = window.__fbe_test as any
            const bp = await api.getBlueprintOrBookFromSource(args.src)
            const grid = bp.entityPositionGrid
            const out: Record<string, string> = {}

            for (const p of args.placed) {
                const entity = bp.entities.get(p.entityNumber)
                if (entity === undefined) {
                    out[`${p.name}@${p.direction}`] = 'MISSING'
                    continue
                }
                const cells: string[] = []
                for (let dx = -args.reach; dx <= args.reach; dx++) {
                    for (let dy = -args.reach; dy <= args.reach; dy++) {
                        const at = grid.getEntityAtPosition({
                            x: Math.floor(entity.position.x) + dx,
                            y: Math.floor(entity.position.y) + dy,
                        })
                        if (at !== undefined && at.entityNumber === p.entityNumber) {
                            cells.push(`${dx},${dy}`)
                        }
                    }
                }
                out[`${p.name}@${p.direction}`] = cells.join(' ')
            }
            return out
        },
        { src: source, placed, reach: 6 }
    )

    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    expect(tally).toEqual(expected)
})
