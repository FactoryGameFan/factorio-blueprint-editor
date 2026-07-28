/*
    Turns tools/oracle/fixtures/rail-signal-spots.json into the table the editor
    ships, packages/editor/src/core/railSignalSpots.ts.

    A generator rather than a hand-typed constant because it is 152 numbers that
    came from the game, and the editor cannot read the fixture at runtime -
    nothing under tests/ or src/ may depend on tools/oracle, since CI stays
    offline. So the numbers get copied, and this is what makes the copy
    re-derivable instead of a transcription nobody dares touch.

    Run it after any recapture of that fixture:

        node tools/oracle/probe-rail-signal-spots.mjs --write-fixture
        node tools/oracle/generate-rail-signal-spots.mjs
        vp check --fix

    The generated file is committed. If it ever disagrees with a fresh run of
    this script, the fixture moved and the table did not.
*/
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const FIXTURE = join(HERE, 'fixtures', 'rail-signal-spots.json')
const OUT = join(REPO, 'packages', 'editor', 'src', 'core', 'railSignalSpots.ts')

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const vals = o => Object.values(o ?? {})

const rows = vals(fx.rows)
if (rows.length === 0) {
    console.error('!! the fixture has no rows')
    process.exit(1)
}

// rail-signal and rail-chain-signal agreed on every orientation when this was
// measured, so one table serves both. Re-checked here rather than assumed: a
// recapture that broke the agreement would otherwise be silently halved.
for (const row of rows) {
    const [a, b] = vals(row.signals)
    const key = s => `${s.dx},${s.dy},${s.dir}`
    const sa = new Set(vals(a.wide).map(key))
    const sb = new Set(vals(b.wide).map(key))
    if (sa.size !== sb.size || [...sa].some(k => !sb.has(k))) {
        console.error(
            `!! ${row.rail} dir ${row.direction}: rail-signal and rail-chain-signal no longer agree.`
        )
        console.error(
            '   The generated table assumes one set serves both. Fix that before regenerating.'
        )
        process.exit(1)
    }
}

const byRail = new Map()
let total = 0
for (const row of rows) {
    const sig = vals(row.signals).find(s => s.signal === 'rail-signal')
    const spots = vals(sig.wide)
        .map(s => ({ dx: s.dx, dy: s.dy, dir: s.dir }))
        /*
            Ordered by angle around the rail's own position, which is what the
            R key steps through - so a press moves to a spatially adjacent spot
            rather than across the track.

            It used to sort by dir, then dx, then dy, which is stable but not
            spatial: on a straight rail that groups the two left-hand spots
            together and then the two right-hand ones, so stepping from
            (1.5, 0.5) landed on (-1.5, -0.5) - the *diagonal* opposite, the one
            corner a user pointing at a rail is least likely to have meant.
            Measured in a browser rather than reasoned about; it reads as the
            signal teleporting.

            Ring order makes each step a neighbour: along the track, then across
            it, then back. Ties broken on radius and then the raw fields so a
            regeneration still produces no spurious diff.
        */
        .sort(
            (p, q) =>
                Math.atan2(p.dy, p.dx) - Math.atan2(q.dy, q.dx) ||
                Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy) ||
                p.dx - q.dx ||
                p.dy - q.dy ||
                p.dir - q.dir
        )
    if (!byRail.has(row.rail)) byRail.set(row.rail, new Map())
    byRail.get(row.rail).set(row.direction, spots)
    total += spots.length
}

const railNames = [...byRail.keys()].sort((a, b) => a.localeCompare(b))

let out = `/*
    Where a rail signal may legally sit, relative to a rail.

    GENERATED - do not edit by hand. Produced by
    tools/oracle/generate-rail-signal-spots.mjs from
    tools/oracle/fixtures/rail-signal-spots.json, which measured it against
    Factorio ${JSON.stringify(fx.binary).slice(1, -1)}.

    ${total} legal placements across ${rows.length} rail orientations: 4 per rail,
    5 on curved-rail-b, and only 2 on a legacy-straight-rail at a diagonal. Each
    spot is legal at exactly **one** direction, which is why snapping sets the
    signal's direction as well as its position.

    Offsets are from the rail's own position and are half-tile values, since a
    signal sits at a tile centre while a rail is anchored on a tile corner.

    The four elevated-* rail types are deliberately absent: placing one needs a
    rail support, so the probe could not sweep signals around them, and an absent
    rail simply gets no snapping rather than the wrong snapping.

    rail-signal and rail-chain-signal share this table - they agreed on every one
    of the ${rows.length} orientations measured, and the generator re-checks that
    before emitting.
*/

/** A legal signal placement, as an offset from the rail and the one direction it is legal at */
export interface IRailSignalSpot {
    readonly dx: number
    readonly dy: number
    readonly dir: number
}

/** Keyed by rail prototype name, then by the rail's direction */
export const RAIL_SIGNAL_SPOTS: Readonly<
    Record<string, Readonly<Record<number, readonly IRailSignalSpot[]>>>
> = {
`

for (const rail of railNames) {
    out += `    '${rail}': {\n`
    const dirs = [...byRail.get(rail).keys()].sort((a, b) => a - b)
    for (const dir of dirs) {
        const spots = byRail
            .get(rail)
            .get(dir)
            .map(s => `{ dx: ${s.dx}, dy: ${s.dy}, dir: ${s.dir} }`)
            .join(', ')
        out += `        ${dir}: [${spots}],\n`
    }
    out += `    },\n`
}

out += `}
`

writeFileSync(OUT, out)
console.log(`wrote ${OUT}`)
console.log(`  ${total} spots across ${rows.length} orientations, ${railNames.length} rail types`)
console.log('now run: vp check --fix')
