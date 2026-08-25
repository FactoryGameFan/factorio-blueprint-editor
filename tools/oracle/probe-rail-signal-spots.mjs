/*
    Issue #133 item 2, as rescoped to snapping. Before a table of legal signal
    positions can be hardcoded into the editor, it has to be the **complete**
    table, and the one in rail-placement.json may not be.

    That fixture swept a +/-3 tile window. Its `legacy-curved-rail` rows carry
    spots at offsets of 3.5, i.e. hard against the window edge, and report only
    2 or 3 spots where #133 claims 4 per rail. Either the game really does give
    that rail fewer, or the sweep clipped them. A table built on the second
    would send the editor's snapping to a subset of the legal positions and look
    like a placement bug, so this settles it before anything is generated.

    Method is the same as probe-rail-placement.mjs - place the rail, sweep
    position x direction for a signal, build each acceptance and read back where
    it landed so the snap collapses duplicates - with one addition:

      **Every orientation is swept twice, at two window sizes.** The control is
      that the wider window finds nothing the narrower one missed. If it does
      find more, the narrow answer was an artefact of the window and the whole
      of rail-placement.json's signal table is incomplete, not just the rows
      that look suspicious. That is a control about the apparatus rather than
      about the behaviour, which is the distinction the rail-on-rail probe got
      wrong the first time.

    Two further controls, both carried over because they earned their keep:

      - **Empty ground must give zero.** A rail signal needs an adjacent rail,
        so a sweep with no rail present has to come back empty. #95 measured 0
        of 2704, and a non-zero here would mean the sweep is measuring the tile.
      - **`manual`, never `blueprint_ghost`.** The ghost check skips rail
        adjacency entirely and answers 2704 of 2704 on bare grass.

    Usage: node tools/oracle/probe-rail-signal-spots.mjs
           node tools/oracle/probe-rail-signal-spots.mjs --write-fixture && vp check --fix
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN = factorioBin

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'rail-signal-spots.json')
const OLD_FIXTURE = join(HERE, 'fixtures', 'rail-placement.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_rail_signal_spots'
const DUMP = 'rail-signal-spots.json'

const RAILS = [
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
]

/** The narrow window is the one rail-placement.json used; the wide one is the control. */
const NARROW = 3
const WIDE = 7

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Every legal rail signal position, and whether the window clipped it',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {rows = {}, empty_ground = {}, errors = {}}

local ALL_DIRS = {}
for d = 0, 15 do ALL_DIRS[#ALL_DIRS + 1] = d end

local RAILS = {${RAILS.map(r => `"${r}"`).join(', ')}}
local SIGNALS = {"rail-signal", "rail-chain-signal"}

local function clearArea(surface, cx, cy, r)
  for _, e in pairs(surface.find_entities_filtered{area = {{cx - r, cy - r}, {cx + r, cy + r}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
end

local function canPlace(surface, force, name, pos, dir)
  local res = false
  pcall(function()
    res = surface.can_place_entity{
      name = name, position = pos, direction = dir, force = force,
      build_check_type = defines.build_check_type.manual,
    }
  end)
  return res
end

local function findSpot(surface, force, name, dir, cx, cy, r)
  for dx = -r, r do
    for dy = -r, r do
      local pos = {cx + dx, cy + dy}
      if canPlace(surface, force, name, pos, dir) then return pos end
    end
  end
  return nil
end

-- Distinct legal placements of placeName around origin. Each acceptance is
-- built and read back, because the signal grid collapses several requested
-- positions onto one real one.
local function distinctSpots(surface, force, placeName, origin, radius)
  local seen, spots, raw = {}, {}, 0
  for _, d in ipairs(ALL_DIRS) do
    local dx = -radius
    while dx <= radius do
      local dy = -radius
      while dy <= radius do
        local pos = {origin[1] + dx, origin[2] + dy}
        if canPlace(surface, force, placeName, pos, d) then
          raw = raw + 1
          local ok, e = pcall(function()
            return surface.create_entity{
              name = placeName, position = pos, direction = d, force = force,
            }
          end)
          if ok and e then
            local k = e.position.x .. "," .. e.position.y .. "," .. e.direction
            if not seen[k] then
              seen[k] = true
              spots[#spots + 1] = {
                dx = e.position.x - origin[1],
                dy = e.position.y - origin[2],
                dir = e.direction,
              }
            end
            e.destroy()
          end
        end
        dy = dy + 0.5
      end
      dx = dx + 0.5
    end
  end
  return {spots = spots, raw = raw}
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 8)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -40, 40 do
    for y = -40, 40 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  clearArea(surface, 0, 0, 40)

  -- Control: no rail, no legal signal position, at the wide window.
  for _, sig in ipairs(SIGNALS) do
    local res = distinctSpots(surface, force, sig, {0, 0}, ${WIDE})
    out.empty_ground[#out.empty_ground + 1] = {signal = sig, spots = #res.spots, raw = res.raw}
  end

  for _, name in ipairs(RAILS) do
    local seenDir = {}
    for _, d in ipairs(ALL_DIRS) do
      clearArea(surface, 0, 0, 24)
      local spot = findSpot(surface, force, name, d, 0, 0, 4)
      if spot then
        local rail = surface.create_entity{name = name, position = spot, direction = d, force = force}
        if rail and not seenDir[rail.direction] then
          seenDir[rail.direction] = true
          local origin = {rail.position.x, rail.position.y}
          local row = {
            rail = name,
            direction = rail.direction,
            position = {x = origin[1], y = origin[2]},
            signals = {},
          }
          for _, sig in ipairs(SIGNALS) do
            local narrow = distinctSpots(surface, force, sig, origin, ${NARROW})
            local wide = distinctSpots(surface, force, sig, origin, ${WIDE})
            row.signals[#row.signals + 1] = {
              signal = sig,
              narrow_count = #narrow.spots,
              wide_count = #wide.spots,
              narrow = narrow.spots,
              wide = wide.spots,
            }
          end
          out.rows[#out.rows + 1] = row
        end
        if rail and rail.valid then rail.destroy() end
      end
    end
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()
console.log(`running ${binaryLine}...`)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

const d = JSON.parse(readFileSync(dumpPath, 'utf8'))
const vals = o => Object.values(o ?? {})
const key = s => `${s.dx},${s.dy},${s.dir}`

const controls = []
console.log('\n=== control: a signal has no legal position with no rail present ===')
for (const e of vals(d.empty_ground)) {
    const ok = e.spots === 0
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${e.signal.padEnd(18)} ${e.spots} spots (${e.raw} raw)`)
    controls.push({
        control: `${e.signal} has no legal position on empty ground`,
        holds: ok,
        got: `${e.spots} spots`,
    })
}

console.log('\n=== control: does a wider window find spots the narrow one missed? ===')
let clipped = 0
const clippedRows = []
for (const row of vals(d.rows)) {
    for (const s of vals(row.signals)) {
        const narrow = new Set(vals(s.narrow).map(key))
        const wide = vals(s.wide).map(key)
        const missed = wide.filter(k => !narrow.has(k))
        if (missed.length) {
            clipped++
            clippedRows.push({
                rail: row.rail,
                direction: row.direction,
                signal: s.signal,
                narrow: s.narrow_count,
                wide: s.wide_count,
                missedByNarrowWindow: missed,
            })
        }
    }
}
console.log(
    `  ${clipped === 0 ? 'ok   the +/-3 window was sufficient' : `FAIL ${clipped} of ${vals(d.rows).length * 2} sweeps found more at +/-${WIDE}`}`
)
for (const c of clippedRows.slice(0, 12)) {
    console.log(
        `       ${c.rail.padEnd(22)} dir ${String(c.direction).padStart(2)} ${c.signal.padEnd(18)} ${c.narrow} -> ${c.wide}   missed ${c.missedByNarrowWindow.join(' ')}`
    )
}
controls.push({
    control: `a +/-${WIDE} window finds nothing a +/-${NARROW} window missed`,
    holds: clipped === 0,
    got: `${clipped} sweeps grew`,
})

console.log('\n=== the complete table ===')
let total = 0
for (const row of vals(d.rows)) {
    const sig = vals(row.signals).find(s => s.signal === 'rail-signal')
    total += sig.wide_count
    console.log(
        `  ${row.rail.padEnd(22)} dir ${String(row.direction).padStart(2)}  ${sig.wide_count} spots  ${vals(
            sig.wide
        )
            .map(s => `(${s.dx},${s.dy})@${s.dir}`)
            .join(' ')}`
    )
}
console.log(
    `\n  ${total} legal rail-signal placements across ${vals(d.rows).length} rail orientations`
)

// Do the two signal kinds still agree once the window is wide?
let differ = 0
for (const row of vals(d.rows)) {
    const [a, b] = vals(row.signals)
    const sa = new Set(vals(a.wide).map(key))
    const sb = new Set(vals(b.wide).map(key))
    if (sa.size !== sb.size || [...sa].some(k => !sb.has(k))) {
        differ++
        console.log(`  !! ${row.rail} dir ${row.direction}: signal and chain signal differ`)
    }
}
console.log(
    `  rail-signal and rail-chain-signal agree on ${vals(d.rows).length - differ} of ${vals(d.rows).length} orientations`
)

/*
    The check this run exists to make safe. `canHoldASignalOnItsTiles` in
    PositionGrid.ts refuses a signal on the tiles of a straight-rail, a
    half-diagonal-rail and a legacy-curved-rail, and that rule was derived from
    the clipped measurement above. Recomputing the overlap against the complete
    table says whether it survives - a rule that forbids a placement the game
    allows is the corruption class in reverse, and would be a live bug.
*/
const REPO = join(HERE, '..', '..')
const FD = JSON.parse(
    readFileSync(join(REPO, 'packages', 'exporter', 'data', 'output', 'data.json'), 'utf8')
).entities

const entitySize = (name, dir = 0) => {
    const e = FD[name]
    const bb = e.collision_box
    const w = e.tile_width || Math.ceil(Math.abs(bb[0][0]) + Math.abs(bb[1][0]))
    const h = e.tile_height || Math.ceil(Math.abs(bb[0][1]) + Math.abs(bb[1][1]))
    if (w === h) return { x: w, y: h }
    const dd =
        e.type === 'curved-rail-a' || e.type === 'curved-rail-b'
            ? Math.floor((dir % 8) / 4) * 4
            : (Math.round(dir / 4) * 4) % 16
    return dd === 4 || dd === 12 ? { x: h, y: w } : { x: w, y: h }
}
const tileRect = (name, cx, cy, dir) => {
    const s = entitySize(name, dir)
    return [Math.round(cx - s.x / 2), Math.round(cy - s.y / 2), s.x, s.y]
}
const rectsOverlap = (a, b) =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

// The live rule, transcribed from PositionGrid.ts
const canHoldASignalOnItsTiles = (name, direction) => {
    if (name === 'legacy-straight-rail') return direction % 4 !== 0
    return !(
        name === 'straight-rail' ||
        name === 'half-diagonal-rail' ||
        name === 'legacy-curved-rail'
    )
}

console.log('\n=== does canHoldASignalOnItsTiles still hold against the complete table? ===')
const overlapRows = []
for (const row of vals(d.rows)) {
    const sig = vals(row.signals).find(s => s.signal === 'rail-signal')
    const railRect = tileRect(row.rail, row.position.x, row.position.y, row.direction)
    const overlapping = vals(sig.wide).filter(s => {
        const r = tileRect('rail-signal', row.position.x + s.dx, row.position.y + s.dy, s.dir)
        return rectsOverlap(railRect, r)
    })
    const editorSaysCanHold = canHoldASignalOnItsTiles(row.rail, row.direction)
    const gameSaysCanHold = overlapping.length > 0
    overlapRows.push({
        rail: row.rail,
        direction: row.direction,
        spots: sig.wide_count,
        overlappingItsOwnTiles: overlapping.length,
        editorAllowsASignalOnItsTiles: editorSaysCanHold,
        agrees: editorSaysCanHold === gameSaysCanHold,
    })
}
const wrong = overlapRows.filter(r => !r.agrees)
console.log(
    `  ${wrong.length === 0 ? 'ok   agrees on all ' + overlapRows.length + ' orientations' : `FAIL ${wrong.length} disagree`}`
)
for (const r of wrong) {
    console.log(
        `       ${r.rail} dir ${r.direction}: editor says ${r.editorAllowsASignalOnItsTiles}, game has ${r.overlappingItsOwnTiles} overlapping`
    )
}
controls.push({
    control: 'canHoldASignalOnItsTiles agrees with the complete spot table',
    holds: wrong.length === 0,
    got: `${wrong.length} disagreements of ${overlapRows.length}`,
})

// And against what is already committed.
const old = JSON.parse(readFileSync(OLD_FIXTURE, 'utf8'))
const oldByKey = {}
for (const s of vals(old.sweeps)) {
    if (!s.anchor || s.place !== 'rail-signal' || s.anchor === 'gate') continue
    oldByKey[`${s.anchor}|${s.anchor_dir_got ?? s.anchor_dir_asked}`] = vals(s.spots).length
}
let grew = 0
for (const row of vals(d.rows)) {
    const sig = vals(row.signals).find(s => s.signal === 'rail-signal')
    const before = oldByKey[`${row.rail}|${row.direction}`]
    if (before !== undefined && before !== sig.wide_count) {
        grew++
        console.log(
            `  rail-placement.json says ${before} for ${row.rail} dir ${row.direction}, this run says ${sig.wide_count}`
        )
    }
}
console.log(
    `\n  ${grew === 0 ? 'agrees with rail-placement.json everywhere' : `${grew} orientations disagree with rail-placement.json`}`
)

const raw = join(work, 'rail-signal-spots.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    writeFileSync(
        FIXTURE,
        JSON.stringify(
            {
                question:
                    'What is the complete set of legal rail signal positions around every rail orientation, and was the +/-3 window in rail-placement.json wide enough to have found all of them?',
                issue: 133,
                probe: 'tools/oracle/probe-rail-signal-spots.mjs',
                binary: binaryLine,
                versionCaveat:
                    'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73; the corpus itself ranges wider, 2.0.32 to 2.1.12, with two files declaring 2.1.12 (see tools/oracle/README.md).',
                measurementCaveats: [
                    'Every orientation is swept twice, at +/-3 and +/-7, and the control is that the wider window finds nothing the narrower one missed. Without it a table built from this would silently be a subset of the legal positions - which is the specific risk that prompted the run, since rail-placement.json reports spots at offsets of 3.5 against a +/-3 window.',
                    'Each acceptance is built and read back, because the signal grid collapses several requested positions onto one real placement. The counts are of distinct placements after that.',
                    'build_check_type is manual throughout. blueprint_ghost skips rail adjacency and answers yes on bare grass.',
                ],
                controls,
                clippedByNarrowWindow: clippedRows,
                rows: vals(d.rows),
            },
            null,
            4
        ) + '\n'
    )
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
