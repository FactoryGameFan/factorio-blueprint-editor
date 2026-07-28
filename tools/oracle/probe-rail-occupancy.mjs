/*
    Issue #133, item 1 - the structural one. `PositionGrid` keys integer tiles
    and gives a rail the rectangle `getEntitySize` computes from its bounding
    box. The issue says that over-reports, a curved rail being a curve inside a
    mostly empty rectangle, and asks for per-rail occupancy shapes instead.

    Before writing that, two things have to be true, and neither has been
    measured:

      1. **The rectangle itself has to be right.** The editor computes it from
         `collision_box`, which for a curved rail is an axis-aligned *bounding*
         box. The game publishes its own `tile_width`/`tile_height`, and the
         exporter emits those for only 3 of 155 entities, so the editor is
         computing what it could be reading. This records both side by side.

      2. **One shape per rail has to be enough.** The editor stores occupancy
         once, per entity, without knowing what will later be asked about it. So
         a single set of cells can only work if "is this cell blocked" has one
         answer regardless of what is being placed. Gates and signals are known
         to interact with rails specially, so this sweeps a chest, a gate and a
         signal over the same cells and compares. **If they disagree, item 1 as
         written is not implementable** - occupancy would have to be per pair,
         which is a truth table and not a shape, and the issue needs rewriting
         rather than working.

    Occupancy is defined operationally, the way the grid would use it: a cell is
    occupied if the game refuses a 1x1 entity centred on it while the rail
    stands and accepts the same on empty ground. That is the same question
    `isAreaAvailable` is asked, rather than a claim about collision boxes, and it
    needs no guess about how Factorio composes a curve out of boxes.

    Controls:

      1. **Empty ground.** Every cell in the window must be free for every
         reference entity with no rail present. A cell that is blocked anyway
         means terrain or a leftover entity is confounding the sweep, and the
         rail's own answer is unreadable.
      2. **A known answer.** A cardinal `straight-rail` fills its 2x2 completely
         - it is the one rail whose footprint nobody disputes - so the chest
         sweep must come back with exactly those 4 cells. If the calibration
         case is wrong, nothing else in the run is worth reading.
      3. **The reference entity has to collide with rails at all.** A chest on
         the rail's own centre must be refused. Otherwise a sweep of all-free
         cells would read as "the rail occupies nothing".

    Usage: node tools/oracle/probe-rail-occupancy.mjs
           node tools/oracle/probe-rail-occupancy.mjs --write-fixture && vp check --fix
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
const FIXTURE = join(HERE, 'fixtures', 'rail-occupancy.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_rail_occupancy'
const DUMP = 'rail-occupancy-dump.json'

const RAILS = [
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
]

/**
 * 1x1 probes. The chest is the ordinary case, the belt and the pole are there so
 * that a chest-versus-gate split cannot be mistaken for a chest-versus-everything
 * one, and the gate is the known special case.
 *
 * `rail-signal` is swept and then **excluded by its own control**, deliberately
 * rather than by being left out: it is refused on every cell of empty ground,
 * since a signal needs an adjacent rail to exist at all - #95 measured 0 of 2704
 * - so it cannot distinguish "this cell is occupied" from "there is no rail
 * next to this cell". Keeping it in the run records why no occupancy shape can
 * ever answer for signals, which is what items 2 and 3 of #133 are for.
 */
const REFERENCES = ['wooden-chest', 'gate', 'transport-belt', 'small-electric-pole', 'rail-signal']

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
        title: 'Which tiles a rail actually occupies',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {rails = {}, empty_ground = {}, errors = {}}

local ALL_DIRS = {}
for d = 0, 15 do ALL_DIRS[#ALL_DIRS + 1] = d end

local RAILS = {${RAILS.map(r => `"${r}"`).join(', ')}}
local REFERENCES = {${REFERENCES.map(r => `"${r}"`).join(', ')}}
local WINDOW = 5

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

-- Which cells in the window refuse this 1x1, over every direction it can face.
-- A gate and a signal are directional and legal only at some facings, so a cell
-- counts as free if ANY direction is accepted there - the grid's question is
-- whether the cell can be built on at all, not whether one facing works.
local function occupancy(surface, force, refName, origin, window)
  local blocked, free = {}, {}
  for tx = -window, window do
    for ty = -window, window do
      local pos = {origin[1] + tx + 0.5, origin[2] + ty + 0.5}
      local ok = false
      for _, d in ipairs(ALL_DIRS) do
        if canPlace(surface, force, refName, pos, d) then ok = true break end
      end
      if ok then
        free[#free + 1] = {x = tx, y = ty}
      else
        blocked[#blocked + 1] = {x = tx, y = ty}
      end
    end
  end
  return {blocked = blocked, free_count = #free}
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

  -- Control 1: the same window with nothing in it. Every cell must be free for
  -- every reference, or the sweeps below are measuring the ground.
  for _, ref in ipairs(REFERENCES) do
    local res = occupancy(surface, force, ref, {0, 0}, WINDOW)
    out.empty_ground[#out.empty_ground + 1] = {
      reference = ref, blocked = res.blocked, free_count = res.free_count,
    }
  end

  for _, name in ipairs(RAILS) do
    local seen = {}
    for _, d in ipairs(ALL_DIRS) do
      clearArea(surface, 0, 0, 20)
      local spot = findSpot(surface, force, name, d, 0, 0, 4)
      if spot then
        local created = surface.create_entity{
          name = name, position = spot, direction = d, force = force,
        }
        if created and not seen[created.direction] then
          seen[created.direction] = true
          local p = prototypes.entity[name]
          local row = {
            name = name,
            direction = created.direction,
            asked_direction = d,
            position = {x = created.position.x, y = created.position.y},
            -- What the game itself says the footprint is, against what the
            -- editor computes from collision_box on the other side.
            tile_width = p.tile_width,
            tile_height = p.tile_height,
            collision_box = {
              {p.collision_box.left_top.x, p.collision_box.left_top.y},
              {p.collision_box.right_bottom.x, p.collision_box.right_bottom.y},
            },
            bounding_box = {
              {created.bounding_box.left_top.x - created.position.x,
               created.bounding_box.left_top.y - created.position.y},
              {created.bounding_box.right_bottom.x - created.position.x,
               created.bounding_box.right_bottom.y - created.position.y},
            },
            references = {},
          }
          pcall(function()
            local sb = created.secondary_bounding_box
            if sb then
              row.secondary_bounding_box = {
                {sb.left_top.x - created.position.x, sb.left_top.y - created.position.y},
                {sb.right_bottom.x - created.position.x, sb.right_bottom.y - created.position.y},
              }
            end
          end)

          for _, ref in ipairs(REFERENCES) do
            local res = occupancy(surface, force, ref, {created.position.x, created.position.y}, WINDOW)
            row.references[#row.references + 1] = {
              reference = ref, blocked = res.blocked, free_count = res.free_count,
            }
          end
          out.rails[#out.rails + 1] = row
        end
        if created and created.valid then created.destroy() end
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
const vals = o => Object.values(o ?? {})

/* The editor's own rectangle, from the same data.json it loads. */
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

/** The cells PositionGrid would key, relative to the entity's position. */
const editorCells = (name, dir, px, py) => {
    const s = entitySize(name, dir)
    const x0 = Math.round(px - s.x / 2)
    const y0 = Math.round(py - s.y / 2)
    const cells = new Set()
    for (let x = x0; x < x0 + s.x; x++) {
        for (let y = y0; y < y0 + s.y; y++) cells.add(`${x - Math.floor(px)},${y - Math.floor(py)}`)
    }
    return { cells, size: s }
}

const key = c => `${c.x},${c.y}`

/** Cells sort by x then y, so a listed set reads as a shape rather than as text */
const cellOrder = (a, b) => {
    const [ax, ay] = a.split(',').map(Number)
    const [bx, by] = b.split(',').map(Number)
    return ax - bx || ay - by
}

console.log(`\n=== binary: ${binaryLine}`)

/* ------------------------------------------------------------------ controls */
const controls = []
const usable = []
console.log('\n=== control 1: an empty window is free for every reference ===')
for (const e of vals(d.empty_ground)) {
    const n = vals(e.blocked).length
    if (n === 0) usable.push(e.reference)
    console.log(
        `  ${n === 0 ? 'ok  ' : 'VOID'} ${e.reference.padEnd(20)} ${n} blocked cells${n === 0 ? '' : ' - cannot tell occupancy from adjacency, excluded below'}`
    )
    controls.push({
        control: `an empty window is free for ${e.reference}`,
        holds: n === 0,
        got: `${n} blocked`,
    })
}

const rows = vals(d.rails)
const chestBlocked = row => {
    const r = vals(row.references).find(x => x.reference === 'wooden-chest')
    return new Set(vals(r?.blocked).map(key))
}

console.log('\n=== control 2: a cardinal straight-rail fills exactly its 2x2 ===')
for (const row of rows.filter(r => r.name === 'straight-rail' && r.direction % 4 === 0)) {
    const blocked = chestBlocked(row)
    const expected = new Set(['-1,-1', '-1,0', '0,-1', '0,0'])
    const ok = blocked.size === expected.size && [...expected].every(c => blocked.has(c))
    console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} dir ${row.direction}: ${blocked.size} cells [${[...blocked].sort(cellOrder).join(' ')}]`
    )
    controls.push({
        control: `a straight-rail at direction ${row.direction} blocks exactly its 2x2`,
        holds: ok,
        got: [...blocked].sort(cellOrder).join(' '),
    })
}

console.log('\n=== control 3: the references collide with rails at all ===')
for (const ref of usable) {
    const anyBlocked = rows.some(row => {
        const r = vals(row.references).find(x => x.reference === ref)
        return vals(r?.blocked).length > 0
    })
    console.log(`  ${anyBlocked ? 'ok  ' : 'FAIL'} ${ref} is blocked by at least one rail`)
    controls.push({
        control: `${ref} collides with rails at all`,
        holds: anyBlocked,
        got: anyBlocked ? 'blocked somewhere' : 'never blocked',
    })
}

/* --------------------------------------------------- do the references agree? */
console.log('\n=== does one occupancy set serve every reference? ===')
const disagreements = []
for (const row of rows) {
    const sets = {}
    for (const r of vals(row.references)) sets[r.reference] = new Set(vals(r.blocked).map(key))
    const base = sets['wooden-chest']
    for (const ref of usable) {
        if (ref === 'wooden-chest') continue
        const s = sets[ref]
        const onlyChest = [...base].filter(c => !s.has(c))
        const onlyRef = [...s].filter(c => !base.has(c))
        if (onlyChest.length || onlyRef.length) {
            disagreements.push({
                rail: row.name,
                direction: row.direction,
                reference: ref,
                blockedForChestNotFor: onlyChest.sort(cellOrder),
                blockedForRefNotForChest: onlyRef.sort(cellOrder),
            })
        }
    }
}
const byRef = {}
for (const x of disagreements) byRef[x.reference] = (byRef[x.reference] ?? 0) + 1
console.log(
    `  ${disagreements.length === 0 ? 'one shape per rail is enough' : 'NO - occupancy depends on what is being placed'}`
)
for (const [ref, n] of Object.entries(byRef)) {
    console.log(`    ${ref}: differs from the chest on ${n} of ${rows.length} orientations`)
}
for (const x of disagreements.slice(0, 6)) {
    console.log(
        `      ${x.rail} dir ${x.direction} vs ${x.reference}: chest-only [${x.blockedForChestNotFor.join(' ')}] ${x.reference}-only [${x.blockedForRefNotForChest.join(' ')}]`
    )
}

/* --------------------------------------------- the rectangle, game vs editor */
console.log(
    '\n=== footprint: what the game says, what the editor computes, what is actually blocked ==='
)
const footprints = []
for (const row of rows) {
    const blocked = chestBlocked(row)
    const { cells, size } = editorCells(row.name, row.direction, row.position.x, row.position.y)
    const missed = [...blocked].filter(c => !cells.has(c))
    const spare = [...cells].filter(c => !blocked.has(c))
    footprints.push({
        rail: row.name,
        direction: row.direction,
        gameTiles: `${row.tile_width}x${row.tile_height}`,
        editorTiles: `${size.x}x${size.y}`,
        blockedCells: blocked.size,
        editorCells: cells.size,
        occupiedButNotKeyed: missed.sort(cellOrder),
        keyedButEmpty: spare.sort(cellOrder),
    })
}
const seenRail = new Set()
for (const f of footprints) {
    const first = !seenRail.has(f.rail)
    seenRail.add(f.rail)
    if (!first && f.occupiedButNotKeyed.length === 0) continue
    console.log(
        `  ${f.rail.padEnd(22)} dir ${String(f.direction).padStart(2)}  game ${f.gameTiles.padEnd(5)} editor ${f.editorTiles.padEnd(5)}  really blocked ${String(f.blockedCells).padStart(2)}  keyed ${String(f.editorCells).padStart(2)}  MISSED ${f.occupiedButNotKeyed.length}  spare ${f.keyedButEmpty.length}`
    )
}

const totalMissed = footprints.filter(f => f.occupiedButNotKeyed.length > 0).length
console.log(
    `\n  ${totalMissed} of ${footprints.length} orientations block a cell the editor's rectangle does not key`
)

const raw = join(work, 'rail-occupancy.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    writeFileSync(
        FIXTURE,
        JSON.stringify(
            {
                question:
                    'Which integer tiles does each rail actually block, is the answer the same for everything that might be placed there, and does the editor rectangle contain it?',
                issue: 133,
                probe: 'tools/oracle/probe-rail-occupancy.mjs',
                binary: binaryLine,
                versionCaveat:
                    'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73 and the corpus declares nothing outside that range.',
                measurementCaveats: [
                    'Occupancy is operational, not geometric: a cell is blocked if the game refuses a 1x1 entity centred on it while the rail stands, and accepts the same on empty ground. That is the question isAreaAvailable is asked. It is not a claim about how Factorio composes a curve out of collision boxes.',
                    'A cell counts as free if ANY of the sixteen directions is accepted there, since a gate and a signal are directional and legal only at some facings while the grid question is whether the cell can be built on at all.',
                    'editorTiles is computed on this side from data.json, mirroring getEntitySize. Note the exporter emits tile_width/tile_height for only 3 of 155 entities, so the editor computes from collision_box where the game publishes a footprint - the two columns are there to be compared.',
                ],
                controls,
                // The sizes are most of the explanation: a rail's collision is
                // continuous, so which tiles it makes unbuildable depends on how
                // big the box being placed is. The gate is the exception that
                // size does not explain - it is smaller than the chest and yet
                // legal on all four cells of a cardinal straight rail, which is
                // the rail-gate rule rather than geometry.
                referenceBoxes: Object.fromEntries(REFERENCES.map(r => [r, FD[r]?.collision_box])),
                referenceAgreement: {
                    usableReferences: usable,
                    excludedByTheirOwnControl: REFERENCES.filter(r => !usable.includes(r)),
                    oneShapePerRailIsEnough: disagreements.length === 0,
                    disagreements,
                },
                footprints,
                rails: rows,
            },
            null,
            4
        ) + '\n'
    )
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
