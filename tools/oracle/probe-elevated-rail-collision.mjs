/*
    Issue #133, item 4. `PositionGrid.isAreaAvailable` does not name the four
    `elevated-*` rail types at all, so they fall to `default:`, set
    `otherEntities` and read as ordinary obstructions. Crossing over things on
    the ground is the entire point of an elevated rail, and the editor refuses
    it in both directions - an elevated rail pasted over a ground entity, and a
    ground entity hand-placed under an existing elevated rail.

    The #95 probe skipped these types because placing one needs rail supports,
    and it was asking a placement question. This one asks a **collision** one
    instead, which needs nothing placed:

      1. What is each rail type's `collision_mask`? An elevated rail's is
         `{elevated_rail}` alone in the 2.0.73 Lua
         (core/lualib/collision-mask-defaults.lua), so it should collide with
         nothing on the ground. This dumps the real masks so the editor's rule
         is written against the game rather than against a grep.

      2. Which prototypes carry `elevated_rail` in their own mask - that is, the
         complete list of things an elevated rail *does* collide with. Scattered
         across four files in the Lua (a `building_tall` helper, a per-type
         table entry for rail-ramp, and three individual prototypes), which is
         exactly the shape of list a grep gets subtly wrong.

    Controls, because a mask dump can lie in a way that is hard to see:

      - `straight-rail` must NOT carry `elevated_rail` and `elevated-straight-rail`
        must carry it and nothing else. If the two came back equal, the read is
        wrong and every conclusion below is void.
      - `rail-support` must NOT carry it. The editor's rule depends on this: a
        support holds an elevated rail up and therefore has to overlap one, so a
        support appearing in the collider list would mean the masks are not the
        whole story.
      - `rail-ramp` must carry it, as the one rail-family entity that does.

    And a **behavioural** control, because a mask is a claim about collision and
    the question is about placement. Section 3 builds an elevated rail for real
    and asks `can_place_entity` whether ground entities may sit under it,
    against a matching empty-ground control. Two ways this can come back
    unmeasurable rather than false, both recorded rather than guessed at:
    `create_entity` may refuse an elevated rail with no support beneath it, and
    `can_place_entity` for an elevated rail may answer false everywhere for the
    same reason - which is why the empty-ground control is what decides whether
    section 3 says anything at all.

    Usage: node tools/oracle/probe-elevated-rail-collision.mjs
           node tools/oracle/probe-elevated-rail-collision.mjs --write-fixture && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not, so a freshly written
    fixture fails `vp check` on formatting alone.
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
const FIXTURE = join(HERE, 'fixtures', 'elevated-rail-collision.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_elevated_rail_collision'
const DUMP = 'elevated-rail-collision.json'

/** The types the editor's own switch names, plus the ones this issue is about */
const NAMED = [
    'straight-rail',
    'curved-rail-a',
    'curved-rail-b',
    'half-diagonal-rail',
    'legacy-straight-rail',
    'legacy-curved-rail',
    'elevated-straight-rail',
    'elevated-curved-rail-a',
    'elevated-curved-rail-b',
    'elevated-half-diagonal-rail',
    'rail-support',
    'rail-ramp',
    'rail-signal',
    'rail-chain-signal',
    'gate',
    'wooden-chest',
    'transport-belt',
    'roboport',
    'rocket-silo',
    'cargo-bay',
    'big-electric-pole',
    'oil-refinery',
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
        title: 'What an elevated rail collides with',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base', 'elevated-rails', 'space-age'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {errors = {}, version = "", masks = {}, colliders = {}, behaviour = {}}

local function try(label, fn)
  local ok, err = pcall(fn)
  if not ok then out.errors[#out.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

local function mask_of(name)
  local p = prototypes.entity[name]
  if not p then return nil end
  local m = p.collision_mask
  local layers = {}
  for layer, on in pairs(m.layers) do if on then layers[#layers + 1] = layer end end
  table.sort(layers)
  return {
    type = p.type,
    layers = layers,
    not_colliding_with_itself = m.not_colliding_with_itself or false,
  }
end

script.on_init(function()
  out.version = "" .. script.active_mods.base

  -- Section 1: the masks of everything the editor's rail rules name.
  for _, name in pairs({${NAMED.map(n => `"${n}"`).join(', ')}}) do
    local m = mask_of(name)
    if m then out.masks[name] = m else out.errors[#out.errors + 1] = "no prototype: " .. name end
  end

  -- Section 2: every prototype carrying elevated_rail, i.e. the complete set of
  -- things an elevated rail collides with.
  try("sweep collision masks", function()
    for name, p in pairs(prototypes.entity) do
      local m = p.collision_mask
      if m and m.layers and m.layers.elevated_rail then
        out.colliders[#out.colliders + 1] = {name = name, type = p.type}
      end
    end
    table.sort(out.colliders, function(a, b) return a.name < b.name end)
  end)

  -- Section 3: the behavioural control. A mask is a claim about collision; the
  -- editor's question is about placement, so build one for real and ask.
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 6)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -60, 60 do
    for y = -30, 30 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-60, -30}, {60, 30}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  local b = out.behaviour

  -- 3a. Can an elevated rail even be created, with and without supports?
  try("create elevated rail without support", function()
    local e = surface.create_entity{
      name = "elevated-straight-rail", position = {0, 0},
      direction = defines.direction.east, force = force,
    }
    b.bare_elevated_created = e ~= nil and e.valid
    if e and e.valid then b.bare_elevated_position = {x = e.position.x, y = e.position.y} end
  end)

  -- 3b. With a support under it, which is how the game intends it.
  try("create rail support then elevated rail", function()
    local s = surface.create_entity{
      name = "rail-support", position = {20, 0},
      direction = defines.direction.east, force = force,
    }
    b.support_created = s ~= nil and s.valid
    if s and s.valid then b.support_position = {x = s.position.x, y = s.position.y} end
  end)

  -- 3c. The measurement. With an elevated rail standing, may ground entities go
  -- under it? Each answer is paired with the same question on empty ground, so
  -- a false that is really "not placeable anywhere" is visible as such.
  local elevated = surface.find_entities_filtered{name = "elevated-straight-rail"}[1]
  b.elevated_found = elevated ~= nil and elevated.valid
  if elevated and elevated.valid then
    local p = elevated.position
    b.elevated_at = {x = p.x, y = p.y}
    b.elevated_direction = elevated.direction
    b.under = {}
    for _, name in pairs({"wooden-chest", "transport-belt", "straight-rail", "rail-support", "rail-ramp", "roboport"}) do
      local under, control = false, false
      try("can_place " .. name, function()
        under = surface.can_place_entity{
          name = name, position = p, direction = defines.direction.north,
          force = force, build_check_type = defines.build_check_type.manual,
        }
        control = surface.can_place_entity{
          name = name, position = {p.x - 40, p.y}, direction = defines.direction.north,
          force = force, build_check_type = defines.build_check_type.manual,
        }
      end)
      b.under[#b.under + 1] = {name = name, under_elevated = under, on_empty_ground = control}
    end
  end

  -- 3d. The other direction: an elevated rail over ground entities. The control
  -- decides whether this says anything, since an elevated rail with no support
  -- may well be unplaceable everywhere.
  try("elevated rail over ground entities", function()
    local chest = surface.create_entity{name = "wooden-chest", position = {-40.5, 10.5}, force = force}
    b.ground_chest_created = chest ~= nil and chest.valid
    b.over = {}
    for _, dir in pairs({0, 2, 4, 6, 8, 10, 12, 14}) do
      local over = surface.can_place_entity{
        name = "elevated-straight-rail", position = {-40.5, 10.5}, direction = dir,
        force = force, build_check_type = defines.build_check_type.manual,
      }
      local control = surface.can_place_entity{
        name = "elevated-straight-rail", position = {-40.5, 20.5}, direction = dir,
        force = force, build_check_type = defines.build_check_type.manual,
      }
      b.over[#b.over + 1] = {direction = dir, over_chest = over, on_empty_ground = control}
    end
  end)

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
for (const e of Object.values(d.errors ?? {})) console.log(`! ${e}`)

const masks = d.masks ?? {}
const layersOf = name => (masks[name]?.layers ?? []).join(', ') || '(none)'

console.log(`\n=== binary: ${binaryLine}\n`)
console.log('=== collision masks ===')
for (const name of NAMED) {
    if (masks[name]) console.log(`  ${name.padEnd(28)} ${layersOf(name)}`)
}

const colliders = Object.values(d.colliders ?? {})
console.log(
    `\n=== carries elevated_rail, i.e. an elevated rail collides with it (${colliders.length}) ===`
)
for (const c of colliders) console.log(`  ${c.name.padEnd(28)} ${c.type}`)

// The controls. Each one can void a section rather than merely disagree.
const elevatedLayers = masks['elevated-straight-rail']?.layers ?? []
const groundLayers = masks['straight-rail']?.layers ?? []
const controls = [
    {
        label: 'elevated-straight-rail carries elevated_rail and nothing else',
        ok: elevatedLayers.length === 1 && elevatedLayers[0] === 'elevated_rail',
        got: layersOf('elevated-straight-rail'),
    },
    {
        label: 'straight-rail does not carry elevated_rail',
        ok: !groundLayers.includes('elevated_rail'),
        got: layersOf('straight-rail'),
    },
    {
        label: 'rail-support does not carry elevated_rail (it must overlap one)',
        ok: !(masks['rail-support']?.layers ?? []).includes('elevated_rail'),
        got: layersOf('rail-support'),
    },
    {
        label: 'rail-ramp does carry elevated_rail',
        ok: (masks['rail-ramp']?.layers ?? []).includes('elevated_rail'),
        got: layersOf('rail-ramp'),
    },
]
console.log('\n=== controls ===')
for (const c of controls)
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}\n       got: ${c.got}`)

const b = d.behaviour ?? {}
console.log('\n=== behavioural control ===')
console.log(`  elevated rail created without a support: ${b.bare_elevated_created ?? false}`)
console.log(`  rail support created: ${b.support_created ?? false}`)
console.log(`  an elevated rail is standing: ${b.elevated_found ?? false}`)
for (const u of Object.values(b.under ?? {})) {
    console.log(
        `  under an elevated rail: ${u.name.padEnd(16)} ${u.under_elevated} (empty ground: ${u.on_empty_ground})`
    )
}
const over = Object.values(b.over ?? {})
const overAccepted = over.filter(o => o.over_chest).length
const overControl = over.filter(o => o.on_empty_ground).length
console.log(
    `  an elevated rail over a chest: ${overAccepted}/${over.length} accepted, empty-ground control ${overControl}/${over.length}`
)
if (overControl === 0) {
    console.log(
        '  -> control at zero: an unsupported elevated rail is unplaceable, so this says nothing'
    )
}

const raw = join(work, 'elevated-rail-collision.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    const fixture = {
        question:
            'What does an elevated rail collide with, and does the game let ground entities sit under one?',
        issue: 133,
        probe: 'tools/oracle/probe-elevated-rail-collision.mjs',
        binary: binaryLine,
        versionCaveat:
            'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73 and the corpus declares nothing outside that range. Cross-checked against the Lua at the 2.0.73 tag of github.com/wube/factorio-data - core/lualib/collision-mask-defaults.lua gives the elevated rail types collision_mask = {layers={elevated_rail=true}} there too, so the masks below are not a 2.1-only shape.',
        versionDifferences: [
            'cargo-bay changed between the two. core/lualib/collision-mask-defaults.lua has ["cargo-bay"] = building_tall() at the 2.0.73 tag, which carries elevated_rail, and ["cargo-bay"] = building() at 2.1.12, which does not - so a cargo bay collides with an elevated rail on the version this editor targets and not on the version measured here. It is therefore absent from the colliders list below while being a collider at 2.0.73. Every other entry agrees across both. Checked by reading the definition site in each, not inferred from the dump.',
        ],
        measurementCaveats: [
            'A collision mask is a claim about collision, not about placement. The behaviour section builds an elevated rail and asks can_place_entity, and each answer is paired with the same question on empty ground - an elevated rail with no support under it is unplaceable everywhere, which would otherwise read as "the game refuses it over a chest".',
            'colliders is every entity prototype whose own mask carries elevated_rail, taken from the whole prototype table rather than from a list written in advance. The Lua scatters this across a building_tall helper, one per-type table entry and three individual prototypes, which is the shape of list a grep gets subtly wrong.',
            'The editor cannot place an elevated rail from the inventory at all - no item has one as its place_result, and the rail planner gives straight-rail. isAreaAvailable still sees them, through PaintBlueprintEntityContainer when a copied selection carrying elevated rails is pasted, and as an obstruction when anything is hand-placed under one.',
        ],
        controls: controls.map(c => ({ control: c.label, holds: c.ok, got: c.got })),
        masks: d.masks,
        colliders,
        behaviour: d.behaviour,
        errors: Object.values(d.errors ?? {}),
    }
    writeFileSync(FIXTURE, JSON.stringify(fixture, null, 4) + '\n')
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
