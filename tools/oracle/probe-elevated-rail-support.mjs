/*
    Issue #141. The editor accepts an elevated rail with nothing holding it up.
    Factorio does not - `can_place_entity` refused one *everywhere* in the #133
    item 4 probe, on bare ground and over a chest alike, which voided that
    probe's section 3. PR #136 settled the collision half (the four `elevated-*`
    types carry `collision_mask = {layers={elevated_rail=true}}` and nothing
    else) and explicitly left buildability open, because `rail-support` does
    **not** carry that layer - a support has to overlap the rail it holds - so
    the support relationship is not expressible as collision.

    The cheapest question first, per the README: is it a prototype field? It
    partly is. `RailSupportPrototype::support_range` is 11 on `rail-support` and
    `RailRampPrototype::support_range` is 9 on `rail-ramp`, identical at the
    2.0.73 and 2.1.12 tags of github.com/wube/factorio-data
    (elevated-rails/prototypes/entity/elevated-rails.lua:309 and :111). The
    prototype docs say only "Must be lower than 500 and at least 1" - no units,
    no geometry - and the runtime API exposes `LuaEntityPrototype.support_range`
    and nothing else about supports. So the number is readable off the table and
    the rule that consumes it is engine behaviour. That is what this measures.

    What it asks:

      1. `support_range` and the collision boxes across the rail family, so
         every number below is compared against the game's own.

      2. Which (position, orientation) makes a `rail-support` **functional**,
         and what it then permits. This is swept over both parities of both
         axes rather than assumed, which is the mistake that cost this probe a
         run: a support is not on the same 2-tile lattice as the rail it holds.
         Real exports put a north-south line of `elevated-straight-rail` on odd
         y and its supports on **even** y, between two rails - a support built
         at a rail's own coordinates supports nothing, and the profiles come
         back identical to having no support at all, which reads as "supports do
         not matter" rather than "the support is in the wrong place".

      3. The same for `rail-ramp`, the other thing carrying `support_range`.

      4. A **chain profile**. Build elevated rails outward with `create_entity`
         (which ignores buildability - the #136 finding this leans on) and
         record, at each step, what `can_place_entity` said *before* the rail was
         forced in. That gives accepted-versus-distance along a line rather than
         a single yes/no, so a reach limit is visible as the place the profile
         turns over, and a walk that halted on the first refusal could not see a
         second run of acceptances further out.

      5. Whether contiguity matters at all: with a functional support and no
         other elevated rail within 90 tiles, what is accepted over it?

      6. The **load-path test**, which is the finding. One spot, five tiles from
         one support, asked four times with nothing changing but which rails
         exist between the two. Distance cannot explain four different answers.

      7. The maximum spacing between two supports, asked twice - of a hand walk
         outward from one of them, and of a *finished* line with one rail
         knocked out at a time. The two give different numbers and the second is
         the one a blueprint is, since a blueprint can be built from both ends.

    Controls, in the README's sense - each can fail while the hypothesis holds:

      - **Rig**: a ground `straight-rail` is accepted on empty ground, and a
        `rail-support` and a `rail-ramp` are too. If these are false the
        surface, force or build_check_type is wrong and every zero below is
        meaningless. `build_check_type.manual` throughout, never
        `blueprint_ghost` - that one skips rail adjacency entirely.
      - **Rig**: `can_place_entity` refuses a spot `create_entity` has just
        filled and accepts it again once freed. Proves the call reads the world
        rather than answering from a prototype rule, which is the failure mode
        that would make every sweep below a constant.
      - **Voiding**: section 2 is readable only if some (parity, orientation)
        accepts something. All zeros means either supports do not work this way
        or `create_entity` cannot make a functional one, and the two are not
        distinguishable from the zeros - say unmeasured, do not read the zeros.
      - **Window**: sweeps run at two half-widths and "the wider one finds
        nothing new" is asserted. `probe-rail-placement.mjs` clipped
        `legacy-curved-rail` by sweeping +/-3 and nothing in its output looked
        wrong.
      - **Snapping**: every accepted triple is built for real and its position
        read back, so a raw acceptance count is reduced to distinct placements.
        16 raw acceptances around a ramp are 3 real rails.
      - **Teardown**: after a chain profile the rails are destroyed and the far
        spots re-asked. They must go back to refused.

    Usage: node tools/oracle/probe-elevated-rail-support.mjs
           node tools/oracle/probe-elevated-rail-support.mjs --write-fixture && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not.
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN = factorioBin

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'elevated-rail-support.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_elevated_rail_support'
const DUMP = 'elevated-rail-support.json'

/** Everything in the rail family, so support_range is read rather than assumed */
const RAIL_FAMILY = [
    'rail-support',
    'rail-ramp',
    'elevated-straight-rail',
    'elevated-half-diagonal-rail',
    'elevated-curved-rail-a',
    'elevated-curved-rail-b',
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
]

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'What holds an elevated rail up',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base', 'elevated-rails', 'space-age'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {
  errors = {}, version = "", proto = {}, rig = {},
  support_grid = {}, support_detail = {}, ramp_sweeps = {},
  baseline = {}, support_offsets = {}, contiguity = {}, load_path = {}, spacing = {},
}

local function try(label, fn)
  local ok, err = pcall(fn)
  if not ok then out.errors[#out.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

local surface, force

local function clear(r)
  for _, e in pairs(surface.find_entities_filtered{area = {{-r, -r}, {r, r}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
end

local function can(name, x, y, dir)
  return surface.can_place_entity{
    name = name, position = {x, y}, direction = dir,
    force = force, build_check_type = defines.build_check_type.manual,
  }
end

local RAIL_DIRS = {0, 2, 4, 6, 8, 10, 12, 14}
local ALL_ELEVATED = {
  "elevated-straight-rail", "elevated-half-diagonal-rail",
  "elevated-curved-rail-a", "elevated-curved-rail-b",
}

-- Sweep every offset in a square window around (ax, ay) at 1-tile steps.
local function sweep(ax, ay, half, names, dirs)
  local acc, n = {}, 0
  for dx = -half, half do
    for dy = -half, half do
      for _, nm in pairs(names) do
        for _, d in pairs(dirs) do
          n = n + 1
          if can(nm, ax + dx, ay + dy, d) then
            acc[#acc + 1] = {dx = dx, dy = dy, name = nm, dir = d}
          end
        end
      end
    end
  end
  return acc, n
end

-- Entities snap, so a raw acceptance is not a placement. Build each accepted
-- triple, read the position and direction back, and keep the distinct ones.
local function distinct(ax, ay, acc)
  local seen, out_list = {}, {}
  for _, a in pairs(acc) do
    local e = surface.create_entity{
      name = a.name, position = {ax + a.dx, ay + a.dy}, direction = a.dir, force = force,
    }
    if e and e.valid then
      local k = a.name .. "@" .. e.position.x .. "," .. e.position.y .. "/" .. e.direction
      if not seen[k] then
        seen[k] = true
        out_list[#out_list + 1] = {
          name = a.name, dx = e.position.x - ax, dy = e.position.y - ay, dir = e.direction,
        }
      end
      e.destroy()
    end
  end
  return out_list
end

script.on_init(function()
  out.version = "" .. script.active_mods.base

  -- Section 1: the prototype read. The cheapest question that settles anything.
  for _, name in pairs({${RAIL_FAMILY.map(n => `"${n}"`).join(', ')}}) do
    local p = prototypes.entity[name]
    if p then
      out.proto[name] = {
        type = p.type,
        support_range = p.support_range,
        collision_box = {
          left_top = {x = p.collision_box.left_top.x, y = p.collision_box.left_top.y},
          right_bottom = {x = p.collision_box.right_bottom.x, y = p.collision_box.right_bottom.y},
        },
      }
    else
      out.errors[#out.errors + 1] = "no prototype: " .. name
    end
  end

  surface = game.surfaces[1]
  force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 12)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -140, 140 do
    for y = -140, 140 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  clear(150)

  -- Section 2: rig controls.
  try("rig controls", function()
    local r = out.rig
    r.ground_rail_on_empty = 0
    for _, d in pairs(RAIL_DIRS) do
      if can("straight-rail", 0, 0, d) then r.ground_rail_on_empty = r.ground_rail_on_empty + 1 end
    end
    r.support_on_empty = can("rail-support", 0, 0, 0)
    r.ramp_on_empty = can("rail-ramp", 0, 0, 0)
    r.elevated_on_empty = 0
    for _, d in pairs(RAIL_DIRS) do
      if can("elevated-straight-rail", 0, 0, d) then r.elevated_on_empty = r.elevated_on_empty + 1 end
    end
    local chest = surface.create_entity{name = "wooden-chest", position = {60.5, 60.5}, force = force}
    r.occupied_spot_refused = chest ~= nil and chest.valid and (can("wooden-chest", 60.5, 60.5, 0) == false)
    if chest and chest.valid then chest.destroy() end
    r.freed_spot_accepted = can("wooden-chest", 60.5, 60.5, 0)
  end)

  local HALF, WIDE = 14, 22

  -- Section 3: which (parity, orientation) makes a lone rail-support
  -- functional? Both parities of both axes, all 16 orientations, nothing else
  -- on the surface. A support that supports nothing and a support in the wrong
  -- place are indistinguishable from a single position, which is what makes
  -- the parity sweep load-bearing rather than thorough.
  for px = 0, 1 do
    for py = 0, 1 do
      for supportDir = 0, 15 do
        try("support grid " .. px .. "," .. py .. " dir " .. supportDir, function()
          clear(150)
          local s = surface.create_entity{
            name = "rail-support", position = {px, py}, direction = supportDir, force = force,
          }
          if not (s and s.valid) then
            out.support_grid[#out.support_grid + 1] =
              {px = px, py = py, dir = supportDir, created = false}
            return
          end
          local ax, ay = s.position.x, s.position.y
          local acc, n = sweep(ax, ay, HALF, ALL_ELEVATED, RAIL_DIRS)
          out.support_grid[#out.support_grid + 1] = {
            px = px, py = py, dir = supportDir, created = true,
            actual_direction = s.direction, position = {x = ax, y = ay},
            swept = n, raw_accepted = #acc,
          }
        end)
      end
    end
  end

  -- Section 3b: for the orientations that worked, the distinct spots and the
  -- window control. Run separately so the grid scan above stays cheap.
  local functional = {}
  for _, r in pairs(out.support_grid) do
    if r.created and r.raw_accepted and r.raw_accepted > 0 then functional[#functional + 1] = r end
  end
  out.functional_count = #functional
  for _, r in pairs(functional) do
    try("support detail " .. r.px .. "," .. r.py .. " dir " .. r.dir, function()
      clear(150)
      local s = surface.create_entity{
        name = "rail-support", position = {r.px, r.py}, direction = r.dir, force = force,
      }
      local ax, ay = s.position.x, s.position.y
      local acc = sweep(ax, ay, HALF, ALL_ELEVATED, RAIL_DIRS)
      local row = {
        px = r.px, py = r.py, dir = r.dir, actual_direction = s.direction,
        position = {x = ax, y = ay}, raw_accepted = #acc, spots = distinct(ax, ay, acc),
      }
      if #out.support_detail == 0 then
        local wideAcc, wn = sweep(ax, ay, WIDE, ALL_ELEVATED, RAIL_DIRS)
        row.wide_half = WIDE
        row.wide_swept = wn
        row.wide_raw_accepted = #wideAcc
      end
      out.support_detail[#out.support_detail + 1] = row
    end)
  end

  -- Section 4: one rail-ramp, every orientation.
  for rampDir = 0, 15 do
    try("ramp sweep dir " .. rampDir, function()
      clear(150)
      local r = surface.create_entity{
        name = "rail-ramp", position = {0, 0}, direction = rampDir, force = force,
      }
      if not (r and r.valid) then
        out.ramp_sweeps[#out.ramp_sweeps + 1] = {dir = rampDir, created = false}
        return
      end
      local ax, ay = r.position.x, r.position.y
      local acc, n = sweep(ax, ay, HALF, ALL_ELEVATED, RAIL_DIRS)
      local row = {
        dir = rampDir, created = true, actual_direction = r.direction,
        position = {x = ax, y = ay}, swept = n, raw_accepted = #acc,
        spots = distinct(ax, ay, acc),
      }
      if rampDir == 0 then
        local wideAcc, wn = sweep(ax, ay, WIDE, ALL_ELEVATED, RAIL_DIRS)
        row.wide_half = WIDE
        row.wide_swept = wn
        row.wide_raw_accepted = #wideAcc
      end
      out.ramp_sweeps[#out.ramp_sweeps + 1] = row
    end)
  end

  ---------------------------------------------------------------------------
  -- The chain profile. A ramp at direction 0 puts its elevated end to the
  -- north, so the chain runs in -y at rail direction 0, stepping 2 tiles.
  --
  -- At each step: ask can_place_entity FIRST, record it, then force the rail in
  -- with create_entity regardless.
  ---------------------------------------------------------------------------
  local STEPS = 40

  local function first_rail_position(ramp)
    for dy = -14, -1 do
      for dx = -2, 2 do
        if can("elevated-straight-rail", ramp.position.x + dx, ramp.position.y + dy, 0) then
          local e = surface.create_entity{
            name = "elevated-straight-rail",
            position = {ramp.position.x + dx, ramp.position.y + dy}, direction = 0, force = force,
          }
          if e and e.valid then
            local p = {x = e.position.x, y = e.position.y}
            e.destroy()
            return p
          end
        end
      end
    end
    return nil
  end

  local function profile(supportSpecs)
    clear(150)
    local ramp = surface.create_entity{
      name = "rail-ramp", position = {0, 0}, direction = 0, force = force,
    }
    local first = first_rail_position(ramp)
    if not first then return {void = true, reason = "no first rail off the ramp"} end
    local placed = {}
    for _, sp in pairs(supportSpecs or {}) do
      local s = surface.create_entity{
        name = "rail-support", position = {first.x + (sp.dx or 0), first.y + sp.dy},
        direction = sp.dir, force = force,
      }
      placed[#placed + 1] = s and s.valid
        and {x = s.position.x, y = s.position.y, dir = s.direction} or false
    end
    local steps = {}
    for i = 0, STEPS - 1 do
      local x, y = first.x, first.y - 2 * i
      local ok = can("elevated-straight-rail", x, y, 0)
      steps[#steps + 1] = {i = i, y = y, accepted = ok}
      surface.create_entity{
        name = "elevated-straight-rail", position = {x, y}, direction = 0, force = force,
      }
    end
    for _, e in pairs(surface.find_entities_filtered{name = "elevated-straight-rail"}) do e.destroy() end
    local after = {}
    for i = 0, STEPS - 1 do
      after[#after + 1] = {i = i, accepted = can("elevated-straight-rail", first.x, first.y - 2 * i, 0)}
    end
    return {
      ramp_position = {x = ramp.position.x, y = ramp.position.y},
      first_rail = first, supports = placed, steps = steps, after_teardown = after,
    }
  end

  local function lastAccepted(p)
    local last, n = -1, 0
    for _, s in pairs(p.steps or {}) do
      if s.accepted then n = n + 1 end
      if s.accepted and s.i > last then last = s.i end
    end
    return last, n
  end

  -- Section 5a: the baseline. A ramp and nothing else.
  try("baseline profile", function()
    out.baseline = profile({})
    local last, n = lastAccepted(out.baseline)
    out.baseline.last_accepted = last
    out.baseline.accepted = n
  end)

  -- Section 5b: one support, at every whole-tile offset along the line and at
  -- every orientation. The offset sweep is what the earlier run of this probe
  -- got wrong by only trying rail coordinates.
  for dy = -1, -30, -1 do
    for supportDir = 0, 15 do
      try("support offset " .. dy .. " dir " .. supportDir, function()
        local p = profile({{dy = dy, dir = supportDir}})
        local last, n = lastAccepted(p)
        if n > (out.baseline.accepted or 0) or last > (out.baseline.last_accepted or -1) then
          local teardown = 0
          for _, s in pairs(p.after_teardown or {}) do if s.accepted then teardown = teardown + 1 end end
          out.support_offsets[#out.support_offsets + 1] = {
            support_dy = dy, support_dir = supportDir, support = (p.supports or {})[1],
            last_accepted = last, accepted = n, still_accepted_after_teardown = teardown,
            steps = p.steps,
          }
        end
      end)
    end
  end

  -- Section 6: does contiguity matter? A support 90 tiles from anything, with
  -- no other elevated rail on the surface at all. The position has to carry the
  -- parity section 3 measured - a support asked for at an arbitrary coordinate
  -- lands somewhere that supports nothing, and the zero then reads as "a lone
  -- support permits nothing" rather than "the support is in the wrong place".
  try("contiguity", function()
    local fun = nil
    for _, r in pairs(out.support_grid) do
      if r.created and r.raw_accepted and r.raw_accepted > 0 and r.dir == 0 then fun = r break end
    end
    if not fun then out.contiguity.void = true return end
    clear(150)
    local s = surface.create_entity{
      name = "rail-support", position = {90 + fun.px, 90 + fun.py}, direction = fun.dir, force = force,
    }
    out.contiguity.asked = {x = 90 + fun.px, y = 90 + fun.py, dir = fun.dir}
    out.contiguity.support = s and s.valid and {x = s.position.x, y = s.position.y} or false
    if not (s and s.valid) then out.contiguity.void = true return end
    local acc = sweep(s.position.x, s.position.y, 14, ALL_ELEVATED, RAIL_DIRS)
    out.contiguity.raw_accepted = #acc
    out.contiguity.spots = distinct(s.position.x, s.position.y, acc)
  end)

  -- Section 7: the load-path test, and the whole answer to "can a tile grid
  -- express this". Four questions about ONE spot, five tiles from a support
  -- that is well within its range the entire time, with only the rails between
  -- them changing. Distance alone cannot explain a different answer to any two
  -- of them.
  try("load path", function()
    clear(150)
    local lp = out.load_path
    local s = surface.create_entity{name = "rail-support", position = {1, 0}, direction = 0, force = force}
    lp.support = s and s.valid and {x = s.position.x, y = s.position.y, dir = s.direction} or false
    if not (s and s.valid) then lp.void = true return end
    local sx, sy = s.position.x, s.position.y

    -- (a) the rail resting directly on the support
    lp.on_the_support = can("elevated-straight-rail", sx, sy - 1, 0)
    -- (b) five tiles out, nothing between: within range, no load path
    lp.five_out_nothing_between = can("elevated-straight-rail", sx, sy - 5, 0)
    -- (c) the same spot once the two rails between it and the support exist
    local r1 = surface.create_entity{name = "elevated-straight-rail", position = {sx, sy - 1}, direction = 0, force = force}
    local r3 = surface.create_entity{name = "elevated-straight-rail", position = {sx, sy - 3}, direction = 0, force = force}
    lp.built_between = (r1 ~= nil and r1.valid) and (r3 ~= nil and r3.valid)
    lp.five_out_with_path = can("elevated-straight-rail", sx, sy - 5, 0)
    -- (d) knock out the middle rail only - same distance, broken path
    if r3 and r3.valid then r3.destroy() end
    lp.five_out_path_broken = can("elevated-straight-rail", sx, sy - 5, 0)
    -- and put it back, so the difference is not something about destroying
    surface.create_entity{name = "elevated-straight-rail", position = {sx, sy - 3}, direction = 0, force = force}
    lp.five_out_path_restored = can("elevated-straight-rail", sx, sy - 5, 0)
  end)

  -- Section 8: the maximum spacing between two supports that still leaves an
  -- unbroken buildable line. No ramp - two supports in an empty field, the
  -- chain walked from the first one's own rail outward.
  try("spacing", function()
    out.spacing.runs = {}
    for gap = 2, 30, 2 do
      clear(150)
      local s1 = surface.create_entity{name = "rail-support", position = {1, 0}, direction = 0, force = force}
      local s2 = surface.create_entity{name = "rail-support", position = {1, -gap}, direction = 0, force = force}
      if s1 and s1.valid and s2 and s2.valid then
        local steps, run = {}, 0
        local n = math.floor(gap / 2) + 6
        for i = 0, n do
          local y = s1.position.y - 1 - 2 * i
          local ok = can("elevated-straight-rail", s1.position.x, y, 0)
          steps[#steps + 1] = {i = i, y = y, accepted = ok}
          if i == run and ok then run = run + 1 end
          surface.create_entity{
            name = "elevated-straight-rail", position = {s1.position.x, y}, direction = 0, force = force,
          }
        end
        -- the span is complete when the unbroken run reaches the second support's
        -- own rail, which sits at gap/2 steps past the first support's
        out.spacing.runs[#out.spacing.runs + 1] = {
          gap = gap,
          s1 = {x = s1.position.x, y = s1.position.y},
          s2 = {x = s2.position.x, y = s2.position.y},
          steps_to_reach_second = math.floor(gap / 2),
          unbroken_run = run,
          span_complete = run > math.floor(gap / 2),
          steps = steps,
        }
      end
    end
  end)

  -- Section 9: the same spacing question asked of a *finished* line rather than
  -- of a hand walk, which is the number the editor actually needs. Section 8
  -- walks outward from one support and so measures how far one build direction
  -- gets; a blueprint is a finished configuration and can be built from both
  -- ends. Force every rail of the span in, then knock out one at a time and ask
  -- whether it may be rebuilt. All accepted means the configuration is legal.
  try("static span", function()
    out.static_span = {}
    for gap = 2, 30, 2 do
      clear(150)
      local s1 = surface.create_entity{name = "rail-support", position = {1, 0}, direction = 0, force = force}
      local s2 = surface.create_entity{name = "rail-support", position = {1, -gap}, direction = 0, force = force}
      if s1 and s1.valid and s2 and s2.valid then
        local ys = {}
        for y = s1.position.y - 1, s2.position.y + 1, -2 do
          ys[#ys + 1] = y
          surface.create_entity{
            name = "elevated-straight-rail", position = {s1.position.x, y}, direction = 0, force = force,
          }
        end
        local refused = {}
        for _, y in pairs(ys) do
          local r = surface.find_entities_filtered{
            name = "elevated-straight-rail", position = {s1.position.x, y},
          }[1]
          if r and r.valid then r.destroy() end
          if not can("elevated-straight-rail", s1.position.x, y, 0) then refused[#refused + 1] = y end
          surface.create_entity{
            name = "elevated-straight-rail", position = {s1.position.x, y}, direction = 0, force = force,
          }
        end
        out.static_span[#out.static_span + 1] = {
          gap = gap, rails = #ys, refused = refused, legal = #refused == 0,
        }
      end
    end
  end)

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()

const { dumpPath } = runProbe({
    bin: BIN,
    work,
    writeData,
    modDir,
    dump: DUMP,
    maxBuffer: 64 * 1024 * 1024,
})

const d = JSON.parse(readFileSync(dumpPath, 'utf8'))
const list = v => (v === undefined || v === null ? [] : Object.values(v))
for (const e of list(d.errors)) console.log(`! ${e}`)

console.log(`\n=== binary: ${binaryLine}\n`)

console.log('=== support_range, read off the prototype table ===')
for (const [name, p] of Object.entries(d.proto ?? {})) {
    console.log(
        `  ${name.padEnd(30)} support_range=${String(p.support_range ?? '(none)').padEnd(6)} ` +
            `collision_box ${p.collision_box.left_top.x},${p.collision_box.left_top.y} .. ${p.collision_box.right_bottom.x},${p.collision_box.right_bottom.y}`
    )
}

const rig = d.rig ?? {}
console.log('\n=== rig controls ===')
console.log(`  ground straight-rail on empty ground:   ${rig.ground_rail_on_empty}/8 directions`)
console.log(`  rail-support on empty ground:           ${rig.support_on_empty}`)
console.log(`  rail-ramp on empty ground:              ${rig.ramp_on_empty}`)
console.log(`  elevated-straight-rail on empty ground: ${rig.elevated_on_empty}/8 directions`)
console.log(`  a spot create_entity filled is refused: ${rig.occupied_spot_refused}`)
console.log(`  the same spot once freed is accepted:   ${rig.freed_spot_accepted}`)

console.log('\n=== a lone rail-support: which parity and orientation is functional? ===')
for (const r of list(d.support_grid)) {
    if (r.raw_accepted > 0)
        console.log(
            `  asked (${r.px},${r.py}) dir ${String(r.dir).padStart(2)} -> built at ${r.position.x},${r.position.y} dir ${r.actual_direction}: ${r.raw_accepted} raw accepted`
        )
}
console.log(`  functional combinations: ${d.functional_count} of ${list(d.support_grid).length}`)

console.log('\n=== what a functional support permits ===')
for (const r of list(d.support_detail)) {
    const byName = {}
    for (const s of list(r.spots)) byName[s.name] = (byName[s.name] ?? 0) + 1
    console.log(
        `  support at ${r.position.x},${r.position.y} dir ${r.actual_direction}: ${r.raw_accepted} raw / ${list(r.spots).length} distinct  ` +
            Object.entries(byName)
                .map(([n, c]) => `${n.replace('elevated-', '')}x${c}`)
                .join(' ') +
            (r.wide_half
                ? `  [window control: half=${r.wide_half} gave ${r.wide_raw_accepted} raw vs ${r.raw_accepted}]`
                : '')
    )
    for (const s of list(r.spots))
        console.log(
            `        ${s.name.padEnd(28)} offset ${String(s.dx).padStart(3)},${String(s.dy).padStart(3)} dir ${s.dir}`
        )
}

console.log('\n=== one rail-ramp alone ===')
for (const r of list(d.ramp_sweeps)) {
    if (!r.created) {
        console.log(`  dir ${String(r.dir).padStart(2)}: NOT CREATED`)
        continue
    }
    console.log(
        `  dir ${String(r.dir).padStart(2)} (actual ${r.actual_direction}) at ${r.position.x},${r.position.y}: ${r.raw_accepted} raw / ${list(r.spots).length} distinct` +
            (r.wide_half
                ? `  [window control: half=${r.wide_half} gave ${r.wide_raw_accepted} raw]`
                : '')
    )
    for (const s of list(r.spots))
        console.log(
            `        ${s.name.padEnd(28)} offset ${String(s.dx).padStart(3)},${String(s.dy).padStart(3)} dir ${s.dir}`
        )
}

const profileLine = steps =>
    list(steps)
        .map(s => (s.accepted ? '#' : '.'))
        .join('')

console.log('\n=== chain profile from a ramp, no support ===')
const b = d.baseline ?? {}
if (b.void) console.log(`  VOID: ${b.reason}`)
else {
    console.log(
        `  ramp at ${b.ramp_position.x},${b.ramp_position.y}; first rail at ${b.first_rail.x},${b.first_rail.y}`
    )
    console.log(`    ${profileLine(b.steps)}`)
    console.log(
        `  last accepted step ${b.last_accepted} (= ${2 * b.last_accepted} tiles past the first rail, ` +
            `${Math.abs(b.first_rail.y - 2 * b.last_accepted - b.ramp_position.y)} from the ramp's own position)`
    )
    const td = list(b.after_teardown).filter(t => t.accepted).length
    console.log(
        `  teardown control: ${td} of ${list(b.after_teardown).length} still accepted once the rails go`
    )
}

console.log('\n=== support offsets that extend the line (only improvements listed) ===')
for (const r of list(d.support_offsets)) {
    console.log(
        `  support dy ${String(r.support_dy).padStart(3)} dir ${String(r.support_dir).padStart(2)} -> built at ${r.support ? `${r.support.x},${r.support.y} dir ${r.support.dir}` : 'FAILED'}: ` +
            `last accepted ${String(r.last_accepted).padStart(2)}, ${String(r.accepted).padStart(2)} accepted, teardown ${r.still_accepted_after_teardown}   ${profileLine(r.steps)}`
    )
}
if (list(d.support_offsets).length === 0)
    console.log('  none - no support offset or orientation improved on the ramp alone')

const c = d.contiguity ?? {}
console.log('\n=== a lone support, nothing else within 90 tiles ===')
if (c.void) console.log('  VOID: no functional support to test with')
else {
    console.log(
        `  asked at ${c.asked.x},${c.asked.y} dir ${c.asked.dir}, built at ${c.support ? `${c.support.x},${c.support.y}` : '?'}: ${c.raw_accepted} raw / ${list(c.spots).length} distinct`
    )
    for (const s of list(c.spots))
        console.log(
            `        ${s.name.padEnd(28)} offset ${String(s.dx).padStart(3)},${String(s.dy).padStart(3)} dir ${s.dir}`
        )
}

const lp = d.load_path ?? {}
console.log('\n=== the load-path test: one spot, 5 tiles from a support, four states ===')
if (lp.void) console.log('  VOID: the support was not created')
else {
    console.log(`  support at ${lp.support.x},${lp.support.y} dir ${lp.support.dir}`)
    console.log(`  a rail resting on the support:                    ${lp.on_the_support}`)
    console.log(
        `  5 tiles out, nothing between:                     ${lp.five_out_nothing_between}`
    )
    console.log(`  5 tiles out, the two rails between it built:      ${lp.five_out_with_path}`)
    console.log(`  5 tiles out, the middle rail knocked out:         ${lp.five_out_path_broken}`)
    console.log(`  5 tiles out, the middle rail put back:            ${lp.five_out_path_restored}`)
}

const sp = d.spacing ?? {}
console.log('\n=== two supports: the maximum spacing that leaves an unbroken line ===')
for (const r of list(sp.runs))
    console.log(
        `  gap ${String(r.gap).padStart(2)} tiles: unbroken run ${String(r.unbroken_run).padStart(2)} of the ${r.steps_to_reach_second} steps needed -> span complete: ${r.span_complete}`
    )

console.log('\n=== the same span asked of a finished line, one rail knocked out at a time ===')
for (const r of list(d.static_span))
    console.log(
        `  gap ${String(r.gap).padStart(2)} tiles, ${String(r.rails).padStart(2)} rails: legal ${String(r.legal).padEnd(5)} ` +
            (list(r.refused).length ? `refused at y=${list(r.refused).join(',')}` : '')
    )

const raw = join(work, 'elevated-rail-support.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    const fixture = {
        question:
            'What does Factorio require for an elevated rail to be buildable, and can an integer-tile grid express it?',
        issue: 141,
        probe: 'tools/oracle/probe-elevated-rail-support.mjs',
        binary: binaryLine,
        versionCaveat:
            'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73. support_range is 11 on rail-support and 9 on rail-ramp at both the 2.0.73 and the 2.1.12 tags of github.com/wube/factorio-data (elevated-rails/prototypes/entity/elevated-rails.lua:309 and :111), and the elevated collision masks are unchanged there too, so the numbers transfer. The rule that consumes them is engine behaviour and was measured only on 2.1.12.',
        measurementCaveats: [
            'build_check_type is manual throughout. blueprint_ghost skips rail adjacency entirely and would read as "anything goes anywhere" - see the #95 note in the README.',
            'Every chain step forces its rail in with create_entity after asking, so the output is an accepted-versus-distance profile rather than a walk that halts on the first refusal. create_entity ignoring buildability is the #136 finding this leans on.',
            'Raw acceptances are reduced to distinct placements by building each one and reading the position back.',
            'A rail-support is not on the same 2-tile lattice as the rail it holds - a north-south line of elevated-straight-rail sits on odd y and its supports on even y. An earlier run of this probe placed supports at rail coordinates, got profiles identical to no support at all, and would have concluded that supports do not participate. Both parities of both axes are swept for that reason.',
            'The spacing question has two answers and they differ. A hand walk outward from one support reaches 12 tiles; a finished line, which is what a blueprint is, is legal to 20 because it can be built from both ends. The corpus agrees with the second - real exports space their supports exactly 20 apart.',
        ],
        corpusCrossCheck: {
            note: 'Computed from wormeyman-tests/, not from the game. Recorded here because it is what decides whether the measured rule is implementable in this editor, and it is not derivable from the capture above.',
            blueprintsWithElevatedRails: 71,
            elevatedRails: 5922,
            withNoSupportOrRampInTheirOwnBlueprint: 0,
            worstEuclideanDistanceToTheNearestSupportOrRamp: 13,
            orderSensitivity:
                'isAreaAvailable sees only what is already on the grid, and PaintBlueprintContainer places a pasted selection in the source blueprint entity order. Real exports interleave supports after the rails they hold, so a "a support is already placed within R tiles" rule refuses legal pastes at every R: 1005 rails in 71 of 71 blueprints at R=11, 226 in 57 at R=18, and still 38 in 27 at R=1000, which is the degenerate rule "any support at all has been placed yet". No radius fixes it; only placing supports and ramps in a first pass would.',
        },
        proto: d.proto,
        rig: d.rig,
        supportGrid: d.support_grid,
        functionalCount: d.functional_count,
        supportDetail: d.support_detail,
        rampSweeps: d.ramp_sweeps,
        baseline: d.baseline,
        supportOffsets: d.support_offsets,
        contiguity: d.contiguity,
        loadPath: d.load_path,
        spacing: d.spacing,
        staticSpan: d.static_span,
        errors: list(d.errors),
    }
    writeFileSync(FIXTURE, JSON.stringify(fixture, null, 4) + '\n')
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
