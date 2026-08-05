/*
    Issue #133, item 5. Nine of the arms in `PositionGrid.isAreaAvailable` decide
    whether one rail may be laid across another, and **nothing has ever measured
    any of them**. #95 measured the signal and gate arms and left these alone;
    #134 fixed what #95 found and did not touch them.

    Stripped of the gate and signal conditions, what those nine arms say is:

        a rail may always be placed over another rail, EXCEPT over one of its own
        family at the same orientation

    where "family" is the straight / half-diagonal / curved grouping and
    "orientation" is compared as `direction % 8` for the straight and
    half-diagonal pairs and as full equality for curved. That is a guess written
    in 2019 for the pre-2.0 rail pair, inherited by the 2.0 types, and the one
    thing #95 proved about this file is that the straight/curved grouping does
    not survive contact with the game.

    The question, per ordered pair of (anchor type, anchor direction) and
    (placed type, placed direction): among the placements of the second whose
    **tiles overlap** the first's, how many does the game accept? Zero is the
    finding that matters. It is the same shape as the signal case #134 closed -
    if the game accepts none, then every `true` the editor answers for that pair
    is a blueprint entity that will not build back, and the arm should refuse.
    Any other number leaves the permissive answer defensible, because an integer
    tile grid cannot say which of the overlapping cells is the legal one.

    Tile overlap is computed on this side from data.json, mirroring
    `getEntitySize` and `PositionGrid.processArea`, because the question is what
    the editor's grid sees and not what collides in Factorio. Same choice, and
    the same reason, as probe-rail-placement.mjs.

    Controls, three of them, each able to void the run rather than merely
    disagree:

      1. **Empty ground per placed type.** A rail needs no adjacency, so a sweep
         with no anchor must come back with plenty of acceptances. Zero would
         mean the sweep is broken, not that rails cannot go anywhere - the
         opposite polarity to the signal control in probe-rail-placement.mjs,
         which must come back at zero, and worth stating because copying that
         probe's control wholesale would invert the test.
      2. **The anchor's own spot.** No rail may be placed exactly where an
         identical rail already stands, so the anchor's own (offset 0,0 at its
         own direction) must never appear in the accepted set. If it does, the
         sweep is reading a stale surface or the dedupe is collapsing the wrong
         placements, and every row is void.

         This started life as "a rail on an identical rail overlaps nowhere",
         which **failed** on every curved rail - 4 overlapping spots for each
         curved-rail-a orientation, 8 for each legacy-curved-rail. That is not a
         broken probe, it is the measurement: a curved rail's tile rectangle is
         mostly empty, so a second identical curved rail sits legally beside it
         with the two *rectangles* overlapping and the two *curves* not. The
         control had been written as a restatement of the hypothesis rather than
         a test of the apparatus, which is the trap the README's control rule is
         about - it can only invalidate the probe if it would still hold when
         the finding goes the other way.
      3. **Step size.** The sweep steps a whole tile, on the grounds that rails
         snap to the 2-tile grid so a finer step cannot reach a spot a coarse
         one misses. That is exactly the sort of assumption that quietly loses
         half the answer, so one pair is swept at both 1 and 0.5 and the distinct
         spot sets compared.

    Usage: node tools/oracle/probe-rail-on-rail.mjs
           node tools/oracle/probe-rail-on-rail.mjs --write-fixture && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not.
*/
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const FIXTURE = join(HERE, 'fixtures', 'rail-on-rail.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_rail_on_rail'
const DUMP = 'rail-on-rail-dump.json'

const RAILS = [
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
]

const work = mkdtempSync(join(tmpdir(), 'fbe-oracle-'))
const writeData = join(work, 'write-data')
const modDir = join(work, 'mods')
const modPath = join(modDir, `${MOD}_0.0.1`)
mkdirSync(writeData, { recursive: true })
mkdirSync(modPath, { recursive: true })

writeFileSync(
    join(modPath, 'info.json'),
    JSON.stringify({
        name: MOD,
        version: '0.0.1',
        title: 'Which rail may be laid across which',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {sweeps = {}, normalisation = {}, step_control = {}}

local ALL_DIRS = {}
for d = 0, 15 do ALL_DIRS[#ALL_DIRS + 1] = d end

local RAILS = {${RAILS.map(r => `"${r}"`).join(', ')}}

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

-- Every accepted (offset, direction), then deduplicated by building each one
-- and reading back where it landed. Rails snap to the 2-tile grid, so the raw
-- acceptances over-count real placements several times over.
local function sweepDistinct(surface, force, placeName, origin, radius, step, cap)
  local seen, spots, nManual, total = {}, {}, 0, 0
  for _, d in ipairs(ALL_DIRS) do
    local dx = -radius
    while dx <= radius do
      local dy = -radius
      while dy <= radius do
        total = total + 1
        local pos = {origin[1] + dx, origin[2] + dy}
        if canPlace(surface, force, placeName, pos, d) then
          nManual = nManual + 1
          if #spots < cap then
            local ok, e = pcall(function()
              return surface.create_entity{
                name = placeName, position = pos, direction = d, force = force,
              }
            end)
            if ok and e then
              local key = e.position.x .. "," .. e.position.y .. "," .. e.direction
              if not seen[key] then
                seen[key] = true
                spots[#spots + 1] = {
                  dx = e.position.x - origin[1],
                  dy = e.position.y - origin[2],
                  dir = e.direction,
                }
              end
              e.destroy()
            end
          end
        end
        dy = dy + step
      end
      dx = dx + step
    end
  end
  return {spots = spots, manual_count = nManual, candidates = total, truncated = #spots >= cap}
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

  -- Which orientations each rail type actually normalises to. Sixteen requested
  -- directions collapse to four, six or eight real ones, and sweeping the
  -- duplicates would trip the same over-counting the snap does.
  local DISTINCT = {}
  for _, name in ipairs(RAILS) do
    local row = {name = name, dirs = {}}
    local seen = {}
    DISTINCT[name] = {}
    for _, d in ipairs(ALL_DIRS) do
      clearArea(surface, 0, 0, 12)
      local spot = findSpot(surface, force, name, d, 0, 0, 4)
      if spot then
        pcall(function()
          local e = surface.create_entity{name = name, position = spot, direction = d, force = force}
          if e then
            row.dirs[#row.dirs + 1] = {asked = d, got = e.direction}
            if not seen[e.direction] then
              seen[e.direction] = true
              DISTINCT[name][#DISTINCT[name] + 1] = e.direction
            end
          end
        end)
      end
    end
    local p = prototypes.entity[name]
    row.tile_width, row.tile_height = p.tile_width, p.tile_height
    out.normalisation[#out.normalisation + 1] = row
  end

  -- The same question for the four elevated types, which #136 put into these
  -- same buckets and whose normalisation therefore decides the rule too. They
  -- need their own loop: can_place_entity refuses an elevated rail everywhere
  -- without a support beneath it, so findSpot finds nothing, while create_entity
  -- builds one regardless - which is enough to read the direction back.
  local ELEVATED = {"elevated-straight-rail", "elevated-half-diagonal-rail",
                    "elevated-curved-rail-a", "elevated-curved-rail-b"}
  for _, name in ipairs(ELEVATED) do
    local row = {name = name, dirs = {}, created_without_support = true}
    for _, d in ipairs(ALL_DIRS) do
      clearArea(surface, 0, 0, 12)
      pcall(function()
        local e = surface.create_entity{name = name, position = {0, 0}, direction = d, force = force}
        if e then
          row.dirs[#row.dirs + 1] = {asked = d, got = e.direction}
        end
      end)
    end
    local p = prototypes.entity[name]
    row.tile_width, row.tile_height = p.tile_width, p.tile_height
    out.normalisation[#out.normalisation + 1] = row
  end
  clearArea(surface, 0, 0, 20)

  local RADIUS, STEP, CAP = 6, 1, 600

  -- Control 1: empty ground, one per placed type. A rail needs no adjacency, so
  -- every one of these must come back well above zero.
  for _, place in ipairs(RAILS) do
    clearArea(surface, 0, 0, 20)
    local res = sweepDistinct(surface, force, place, {0, 0}, RADIUS, STEP, CAP)
    out.sweeps[#out.sweeps + 1] = {
      label = "CONTROL " .. place .. " on empty ground",
      anchor = nil, place = place,
      spots = res.spots, manual_count = res.manual_count,
      candidates = res.candidates, truncated = res.truncated,
    }
  end

  -- The measurement: every distinct orientation of every rail type, against
  -- every rail type. The placed type's own directions come out of the sweep,
  -- which covers all sixteen and dedupes to whatever the game normalises them
  -- to - so a pair is never generalised from one orientation of either side.
  for _, anchor in ipairs(RAILS) do
    for _, ad in ipairs(DISTINCT[anchor] or {}) do
      for _, place in ipairs(RAILS) do
        local row = {
          label = place .. " over " .. anchor .. " dir " .. ad,
          anchor = anchor, anchor_dir = ad, place = place, errors = {},
        }
        clearArea(surface, 0, 0, 20)
        local origin = {0, 0}
        local ok = false
        local spot = findSpot(surface, force, anchor, ad, 0, 0, 4)
        if spot then
          local created = surface.create_entity{
            name = anchor, position = spot, direction = ad, force = force,
          }
          if created then
            origin = {created.position.x, created.position.y}
            row.anchor_x, row.anchor_y = created.position.x, created.position.y
            row.anchor_got_dir = created.direction
            ok = true
          else
            row.errors[#row.errors + 1] = "create_entity returned nil"
          end
        else
          row.errors[#row.errors + 1] = "no placeable spot for the anchor"
        end

        if ok then
          local res = sweepDistinct(surface, force, place, origin, RADIUS, STEP, CAP)
          row.spots = res.spots
          row.manual_count = res.manual_count
          row.candidates = res.candidates
          row.truncated = res.truncated
        end
        out.sweeps[#out.sweeps + 1] = row
      end
    end
  end

  -- Control 3: does a whole-tile step miss anything a half-tile step finds?
  -- Rails snap to the 2-tile grid, which is the reason for stepping 1, and this
  -- is what makes that a measurement rather than an assumption.
  for _, pair in ipairs({{"straight-rail", 0, "straight-rail"}, {"curved-rail-a", 0, "half-diagonal-rail"}}) do
    clearArea(surface, 0, 0, 20)
    local spot = findSpot(surface, force, pair[1], pair[2], 0, 0, 4)
    if spot then
      local e = surface.create_entity{name = pair[1], position = spot, direction = pair[2], force = force}
      if e then
        local origin = {e.position.x, e.position.y}
        local coarse = sweepDistinct(surface, force, pair[3], origin, RADIUS, 1, CAP)
        local fine = sweepDistinct(surface, force, pair[3], origin, RADIUS, 0.5, CAP)
        out.step_control[#out.step_control + 1] = {
          anchor = pair[1], anchor_dir = pair[2], place = pair[3],
          coarse_spots = #coarse.spots, fine_spots = #fine.spots,
          coarse = coarse.spots, fine = fine.spots,
        }
      end
    end
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

writeFileSync(
    join(work, 'config.ini'),
    `[path]\nread-data=__PATH__executable__/../data\nwrite-data=${writeData}\n[general]\n[other]\n`
)

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()

console.log(`running ${binaryLine}...`)
const res = spawnSync(
    BIN,
    [
        '--create',
        join(work, 'p.zip'),
        '--mod-directory',
        modDir,
        '--config',
        join(work, 'config.ini'),
    ],
    { encoding: 'utf8' }
)

const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error(
        'No dump. Factorio tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000)
    )
    process.exit(1)
}

const d = JSON.parse(readFileSync(dumpPath, 'utf8'))

/* ------------------------------------------------------------------ overlap */
// Mirrors getEntitySize and PositionGrid.processArea, so the rectangles below
// are the ones the editor's grid holds and not the ones Factorio collides with.
const FD = JSON.parse(
    readFileSync(join(REPO, 'packages', 'exporter', 'data', 'output', 'data.json'), 'utf8')
)

// Transcribed from getEntitySize, including the curved rails' 2-way swap, which
// is not the rounding every other 8-way building uses. Same transcription as
// probe-rail-placement.mjs; if that one is ever found wrong, both move together.
const entitySize = (name, dir = 0) => {
    const e = FD.entities[name]
    const bb = e.collision_box
    const w = e.tile_width || Math.ceil(Math.abs(bb[0][0]) + Math.abs(bb[1][0]))
    const h = e.tile_height || Math.ceil(Math.abs(bb[0][1]) + Math.abs(bb[1][1]))
    if (w === h) return { x: w, y: h }
    const d =
        e.type === 'curved-rail-a' || e.type === 'curved-rail-b'
            ? Math.floor((dir % 8) / 4) * 4
            : (Math.round(dir / 4) * 4) % 16
    return d === 4 || d === 12 ? { x: h, y: w } : { x: w, y: h }
}

/** The tile rectangle PositionGrid would key, the way processArea computes it */
const rectOf = (name, direction, x, y) => {
    const s = entitySize(name, direction)
    return { x: Math.round(x - s.x / 2), y: Math.round(y - s.y / 2), w: s.x, h: s.y }
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/* ------------------------------------------------------- the editor's answer */
const FAMILY = name =>
    name === 'straight-rail' || name === 'legacy-straight-rail'
        ? 'straight'
        : name === 'half-diagonal-rail'
          ? 'halfDiagonal'
          : 'curved'

/**
 * The nine rail-versus-rail arms of isAreaAvailable with the gate and signal
 * conditions removed, since neither is present in any of these cases. Kept as a
 * flat transcription rather than a tidy one so it can be diffed against the
 * source by eye.
 *
 * `before` is the shape those arms had through #134: family-keyed, direction
 * compared as `% 8` for the straight and half-diagonal pair and as full
 * equality for curved, and the prototype name never looked at.
 */
const editorAllowsBefore = (anchorName, anchorDir, placeName, placeDir) => {
    const af = FAMILY(anchorName)
    const pf = FAMILY(placeName)
    const sameDir = anchorDir % 8 === placeDir % 8
    if (pf === 'straight' && af === 'straight') return !sameDir
    if (pf === 'halfDiagonal' && af === 'halfDiagonal') return !sameDir
    if (pf === 'curved' && af === 'straight') return true
    if (pf === 'halfDiagonal' && af === 'straight') return true
    if (pf === 'curved' && af === 'halfDiagonal') return true
    if (pf === 'straight' && af === 'halfDiagonal') return true
    if (pf === 'straight' && af === 'curved') return true
    if (pf === 'halfDiagonal' && af === 'curved') return true
    if (pf === 'curved' && af === 'curved') return anchorDir !== placeDir
    return false
}

/**
 * How many orientations the game actually keeps for each rail prototype, from
 * the normalisation section of this same run. Not uniform, which is why the
 * modulus cannot simply be dropped: straight-rail and half-diagonal-rail fold
 * mod 8 down to four, the three curved types keep all eight, and
 * legacy-straight-rail keeps **six** - it folds 8 to 0 and 12 to 4 while
 * leaving 10 and 14 distinct from 2 and 6.
 *
 * The even-direction cases are the measured ones and the only reachable ones,
 * since getPossibleRotations gives every rail [0,2,4,6,8,10,12,14]. The game
 * folds odd directions onto their even neighbours; this does not, and nothing
 * produces one.
 */
const normaliseRailDirection = (name, direction) => {
    switch (name) {
        case 'straight-rail':
        case 'half-diagonal-rail':
            return direction % 8
        case 'legacy-straight-rail':
            return direction % 4 === 0 ? direction % 8 : direction
        default:
            return direction
    }
}

const STRAIGHT = new Set(['straight-rail', 'legacy-straight-rail'])

/**
 * `after` is the proposed shape: refuse only where the rail already there
 * occupies the cells the new one wants.
 *
 * The first draft of this was "same prototype at the same normalised
 * orientation", on the grounds that the family grouping was only ever standing
 * in for the prototype. Checked against the rows below, it produced **four**
 * corruption-class rows - `legacy-straight-rail` dir 0 over `straight-rail` dir
 * 0 and dir 4, and the reverse, all of which the game accepts nowhere. The name
 * is not the discriminator. Two *cardinal* 2x2 rails fill their shared tiles
 * completely whichever prototypes they are, while the same pair at a *diagonal*
 * orientation leaves the rectangle mostly empty and the game accepts 4
 * overlapping placements. So the cross-prototype allowance is exactly the
 * diagonal one.
 */
const editorAllowsAfter = (anchorName, anchorDir, placeName, placeDir) => {
    const nd = normaliseRailDirection(placeName, placeDir)
    if (normaliseRailDirection(anchorName, anchorDir) !== nd) return true
    if (anchorName === placeName) return false
    return !(STRAIGHT.has(anchorName) && STRAIGHT.has(placeName) && nd % 4 === 0)
}

/* ---------------------------------------------------------------- summarise */
const controls = []
const emptyGround = {}
for (const s of Object.values(d.sweeps ?? {})) {
    if (!s.anchor) emptyGround[s.place] = Object.values(s.spots ?? {}).length
}

const rows = []
for (const s of Object.values(d.sweeps ?? {})) {
    if (!s.anchor || s.anchor_x === undefined) continue
    const anchorRect = rectOf(s.anchor, s.anchor_got_dir, s.anchor_x, s.anchor_y)
    const byDir = new Map()
    for (const spot of Object.values(s.spots ?? {})) {
        const r = rectOf(s.place, spot.dir, s.anchor_x + spot.dx, s.anchor_y + spot.dy)
        const key = spot.dir
        if (!byDir.has(key)) byDir.set(key, { total: 0, overlapping: 0, offsets: [] })
        const rec = byDir.get(key)
        rec.total++
        if (overlaps(anchorRect, r)) {
            rec.overlapping++
            if (rec.offsets.length < 4) rec.offsets.push(`${spot.dx},${spot.dy}`)
        }
    }
    for (const [dir, rec] of [...byDir.entries()].sort((a, b) => a[0] - b[0])) {
        rows.push({
            anchor: s.anchor,
            anchorDir: s.anchor_got_dir,
            place: s.place,
            placeDir: dir,
            legalSpots: rec.total,
            overlappingSpots: rec.overlapping,
            sampleOffsets: rec.offsets,
            gameAllowsOverlap: rec.overlapping > 0,
            editorAllowsBefore: editorAllowsBefore(s.anchor, s.anchor_got_dir, s.place, dir),
            editorAllowsAfter: editorAllowsAfter(s.anchor, s.anchor_got_dir, s.place, dir),
            truncated: s.truncated ?? false,
        })
    }
}

// A rail can only be produced at an even direction by the editor
// (getPossibleRotations gives every rail [0,2,4,6,8,10,12,14]), so a
// disagreement at an odd one is latent rather than live - the same distinction
// the #135 audit drew for the gate rules.
const reachable = r => r.anchorDir % 2 === 0 && r.placeDir % 2 === 0
const disagreements = rows.filter(r => r.gameAllowsOverlap !== r.editorAllowsBefore)
const liveDisagreements = disagreements.filter(reachable)
const refuseWorthy = rows.filter(r => r.editorAllowsBefore && !r.gameAllowsOverlap && reachable(r))

// The same two questions asked of the proposed arms. The second is the one that
// has to come back empty: it is the corruption class, an editor `true` for a
// pair the game accepts nowhere.
const stillRefused = rows.filter(r => !r.editorAllowsAfter && r.gameAllowsOverlap && reachable(r))
const newlyWrong = rows.filter(r => r.editorAllowsAfter && !r.gameAllowsOverlap && reachable(r))

console.log(`\n=== binary: ${binaryLine}`)
console.log(`\n=== control 1: distinct legal placements on empty ground ===`)
for (const [name, n] of Object.entries(emptyGround)) {
    console.log(`  ${n > 0 ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${n}`)
    controls.push({
        control: `${name} places somewhere on empty ground`,
        holds: n > 0,
        got: `${n} distinct spots`,
    })
}

console.log(`\n=== control 2: the anchor's own spot is never accepted ===`)
let ownSpotHits = 0
for (const s of Object.values(d.sweeps ?? {})) {
    if (!s.anchor || s.anchor_x === undefined || s.place !== s.anchor) continue
    for (const spot of Object.values(s.spots ?? {})) {
        if (spot.dx === 0 && spot.dy === 0 && spot.dir === s.anchor_got_dir) {
            ownSpotHits++
            console.log(`  FAIL ${s.anchor} dir ${s.anchor_got_dir} accepted its own position`)
        }
    }
}
console.log(
    `  ${ownSpotHits === 0 ? 'ok  ' : 'FAIL'} ${ownSpotHits} sweeps accepted the anchor's own spot`
)
controls.push({
    control: "no sweep accepts the anchor's own position and direction",
    holds: ownSpotHits === 0,
    got: `${ownSpotHits} such acceptances`,
})

console.log(`\n=== control 3: does a whole-tile step miss anything? ===`)
for (const c of Object.values(d.step_control ?? {})) {
    const ok = c.coarse_spots === c.fine_spots
    console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${c.place} around ${c.anchor} dir ${c.anchor_dir}: step 1 found ${c.coarse_spots}, step 0.5 found ${c.fine_spots}`
    )
    controls.push({
        control: `a whole-tile step finds every spot a half-tile step does (${c.place} around ${c.anchor})`,
        holds: ok,
        got: `${c.coarse_spots} vs ${c.fine_spots}`,
    })
}

console.log(
    `\n=== rows: ${rows.length}, disagreements: ${disagreements.length} (${liveDisagreements.length} at directions the editor can produce) ===`
)
console.log(
    `\n=== the editor allows, the game accepts no overlapping placement (${refuseWorthy.length}) ===`
)
for (const r of refuseWorthy) {
    console.log(
        `  ${r.place.padEnd(20)} dir ${String(r.placeDir).padStart(2)} over ${r.anchor.padEnd(20)} dir ${String(r.anchorDir).padStart(2)}   (${r.legalSpots} legal spots, none overlapping)`
    )
}

const refuseByPair = {}
for (const r of refuseWorthy) {
    const k = `${r.place} over ${r.anchor}`
    refuseByPair[k] = (refuseByPair[k] ?? 0) + 1
}
console.log(`\n=== grouped by prototype pair ===`)
for (const [k, n] of Object.entries(refuseByPair).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`)
}

// The other polarity - the editor refusing what the game accepts - is an
// annoyance rather than a corruption under this file's policy, but it is the
// whole of the disagreement here, so it gets listed rather than counted.
const overRefused = rows.filter(r => !r.editorAllowsBefore && r.gameAllowsOverlap && reachable(r))
const overByPair = {}
for (const r of overRefused) {
    const k = `${r.place} over ${r.anchor}`
    if (!overByPair[k]) overByPair[k] = { n: 0, dirs: [], spots: 0 }
    overByPair[k].n++
    overByPair[k].spots += r.overlappingSpots
    if (overByPair[k].dirs.length < 6) overByPair[k].dirs.push(`${r.placeDir}/${r.anchorDir}`)
}
console.log(
    `\n=== the editor refuses, the game accepts an overlapping placement (${overRefused.length}) ===`
)
for (const [k, v] of Object.entries(overByPair).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
        `  ${String(v.n).padStart(3)} rows, ${String(v.spots).padStart(4)} accepted spots  ${k.padEnd(46)} placed/anchor dirs ${v.dirs.join(' ')}`
    )
}

console.log(`\n=== the proposed arms: same prototype, same normalised orientation ===`)
console.log(`  over-refusals left: ${stillRefused.length} (was ${overRefused.length})`)
console.log(
    `  ${newlyWrong.length === 0 ? 'ok  ' : 'FAIL'} newly allowed where the game accepts nothing overlapping: ${newlyWrong.length}`
)
for (const r of newlyWrong.slice(0, 20)) {
    console.log(`       ${r.place} dir ${r.placeDir} over ${r.anchor} dir ${r.anchorDir}`)
}
const stillByPair = {}
for (const r of stillRefused) {
    const k = `${r.place} over ${r.anchor}`
    stillByPair[k] = (stillByPair[k] ?? 0) + 1
}
for (const [k, n] of Object.entries(stillByPair).sort((a, b) => b[1] - a[1])) {
    console.log(`       ${String(n).padStart(3)}  ${k}`)
}

const truncatedRows = rows.filter(r => r.truncated).length
if (truncatedRows > 0) console.log(`\n!! ${truncatedRows} rows came from a truncated sweep`)

const raw = join(work, 'rail-on-rail.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    const fixture = {
        question:
            'For each ordered pair of rail orientations, how many placements of the second overlap the first tiles and are still accepted by the game - and where does that disagree with the nine rail-versus-rail arms of isAreaAvailable?',
        issue: 133,
        probe: 'tools/oracle/probe-rail-on-rail.mjs',
        binary: binaryLine,
        versionCaveat:
            'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73; the corpus itself ranges wider, 2.0.32 to 2.1.12, with two files declaring 2.1.12 (see tools/oracle/README.md). Rail placement rules are assumed stable across that whole range and were NOT measured on a 2.0.x binary.',
        measurementCaveats: [
            'Tile overlap is computed on this side from packages/exporter/data/output/data.json, mirroring getEntitySize and PositionGrid.processArea, because the question is what the editor integer tile grid sees rather than what collides in Factorio.',
            'create_entity snaps rails to the 2-tile grid, so raw accepted (position, direction) triples over-count. Every spot below was built and read back, and the counts are of distinct placements after that.',
            'editorAllows is a transcription of the nine rail-versus-rail arms with the gate and signal conditions dropped, since neither is present in any of these cases. It is not the live function - a change to PositionGrid.ts does not change this fixture.',
            'A rail can only be produced at an even direction by the editor, since getPossibleRotations gives every rail [0,2,4,6,8,10,12,14]. Disagreements at odd directions are latent, not live, and are counted separately.',
            'One control was written wrong and DISCARDED: "a rail on an identical rail overlaps nowhere", which failed on every curved orientation - 4 overlapping spots per curved-rail-a orientation, 8 per legacy-curved-rail. That was the measurement, not a broken probe: a curved rail tile rectangle is mostly empty, so a second identical curved rail sits legally beside it with the rectangles overlapping and the curves not. A control has to be something that would still hold if the finding went the other way, and that one was a restatement of the hypothesis. Replaced with "the anchor own position is never accepted", which is about the apparatus.',
        ],
        controls,
        emptyGroundControl: emptyGround,
        stepControl: Object.values(d.step_control ?? {}).map(c => ({
            anchor: c.anchor,
            anchor_dir: c.anchor_dir,
            place: c.place,
            coarse_spots: c.coarse_spots,
            fine_spots: c.fine_spots,
        })),
        normalisation: d.normalisation,
        totals: {
            rows: rows.length,
            disagreements: disagreements.length,
            liveDisagreements: liveDisagreements.length,
            editorAllowsGameAcceptsNone: refuseWorthy.length,
            proposedOverRefusalsLeft: stillRefused.length,
            proposedNewlyWrong: newlyWrong.length,
        },
        // What is left after the proposed arms, and what the first draft of them
        // got wrong. Both derived from the rows below, so they move with the
        // transcription rather than with the measurement.
        proposedStillRefused: stillRefused,
        refuseWorthy,
        rows,
    }
    writeFileSync(FIXTURE, JSON.stringify(fixture, null, 4) + '\n')
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
