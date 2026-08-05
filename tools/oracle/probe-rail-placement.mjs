/*
    Issue #95. `PositionGrid.isAreaAvailable` carries three rail TODOs, two of
    them blanket allowances (a signal may go on any rail, any rail may go on a
    signal) and one an unhandled prototype (`half-diagonal-rail` in the gate
    rules). The issue asks whether to enforce Factorio's real rules or to stay
    permissive on purpose. That is a decision about cost and consequence, so it
    wants measurements rather than reasoning.

    Three questions, three sections:

      1. Where may a rail signal actually sit relative to each 2.0 rail type?
         `LuaSurface.can_place_entity` is the ground truth for the exact check
         `isAreaAvailable` reimplements. Sweeping position x direction around a
         single rail gives the whole legal set, and its size is the size of the
         geometry Option B would have to model.

      2. What does the game say about a gate and a `half-diagonal-rail`, in both
         orders? The editor's gate rules were written for the pre-2.0
         straight/curved pair and currently answer "no" for half-diagonal by
         falling off the end. The straight-rail case is swept alongside as the
         control, since that one the editor does model and we know it allows.

      3. Does a blueprint carrying a signal where the editor would allow one -
         on top of the rail - survive a round trip through the game? Import
         code, what `get_blueprint_entities` gives back, and then the part that
         matters to a user: with the rest of the blueprint standing on real
         ground, will the game let that entity be built at all.

    Controls, because each section can lie:

      - Section 1 sweeps **empty ground** with no rail present. A rail signal is
        only placeable next to a rail, so that sweep must come back at zero. If
        it does not, the trues around a rail are measuring the tile and not the
        rail, and the whole section is void.

        This is the control that earned its keep. It came back **0 manual, 2704
        ghost**: `build_check_type.blueprint_ghost` does not check rail
        adjacency at all, so a signal ghost is legal on bare grass in the middle
        of nowhere. A first pass recorded a hit whenever *either* check passed
        and read the resulting flood as "signals go almost anywhere". Only
        `manual` answers the question this issue is about, so only `manual` hits
        are listed below; the ghost tally is kept as a count so the asymmetry
        stays visible.
      - Section 2 sweeps a **gate on empty ground**, which must come back at
        everything, for the opposite reason: a gate places anywhere, so a zero
        there would mean the sweep is broken rather than that gates and rails
        disagree.
      - Section 3 lays the **unmutated** blueprint on the same clean ground
        before the mutated one. Without it, a mutated blueprint the game refuses
        is indistinguishable from ground that was never buildable.

        This one earned its keep twice. It first ran as stamp-the-blueprint and
        revive-the-ghosts, and the cardinal gate-on-rail case - which the game
        supports, it is the rail-gate feature - lost an entity exactly like the
        illegal cases did. Reviving one of two overlapping ghosts destroys the
        other whether or not the arrangement is legal, so that was measuring
        ghost collision and not placement, and the whole of it was thrown away.
        Then, asking `can_place_entity` about the one direction the blueprint
        carried, the same control read as refused again - because the
        free-standing spot search had given the gate a direction parallel to the
        rail, which the game and this editor both refuse. Hence
        `placeable_dirs`: the question is which of the sixteen directions the
        game accepts, and the cardinal-versus-diagonal difference is 8 against 0.

    One more thing the first run caught: `create_entity` **snaps** a rail to the
    2-tile rail grid, so a rail requested at (-4,-4) lands at (-3,-3). Sweep
    offsets are taken from the created entity's own position, never from the
    requested one.

    Section 3 does not hand-write any coordinates. It places a rail, finds a
    spot for the mover the game itself accepts, captures that with
    `create_blueprint`, and then moves it onto the rail's own position through
    `set_blueprint_entities`. So the illegal case differs from the legal one in
    exactly one field, and no guess about the 2.0 rail grid can confound it.

    Usage: node tools/oracle/probe-rail-placement.mjs
           node tools/oracle/probe-rail-placement.mjs --write-fixture && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not, so a freshly written
    fixture fails `vp check` on whitespace alone.
*/
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

const MOD = 'bp_rail_placement'
const DUMP = 'rail-placement-dump.json'

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
        title: 'Where may a rail signal and a gate sit relative to a rail',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {sweeps = {}, roundtrips = {}, notes = {}}

local ALL_DIRS = {}
for d = 0, 15 do ALL_DIRS[#ALL_DIRS + 1] = d end

local function try(bucket, label, fn)
  local ok, err = pcall(fn)
  if not ok then bucket.errors[#bucket.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

local function clearArea(surface, cx, cy, r)
  for _, e in pairs(surface.find_entities_filtered{area = {{cx - r, cy - r}, {cx + r, cy + r}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
end

local function canPlace(surface, force, name, pos, dir, check)
  local res = false
  pcall(function()
    res = surface.can_place_entity{
      name = name, position = pos, direction = dir, force = force, build_check_type = check,
    }
  end)
  return res
end

-- First position on a 1-tile scan where the game accepts this entity, or nil.
-- Used so no rail coordinate in this probe is hand-written.
local function findSpot(surface, force, name, dir, cx, cy, r)
  for dx = -r, r do
    for dy = -r, r do
      local pos = {cx + dx, cy + dy}
      if canPlace(surface, force, name, pos, dir, defines.build_check_type.manual) then
        return pos
      end
    end
  end
  return nil
end

-- Every (offset, direction) at which the game accepts placeName by hand. The
-- ghost check is tallied alongside but never listed: the empty-ground control
-- shows it ignores rail adjacency, so it answers a different question.
local function sweep(surface, force, placeName, origin, radius, step)
  local hits, nManual, nGhost, total = {}, 0, 0, 0
  for _, d in ipairs(ALL_DIRS) do
    local dx = -radius
    while dx <= radius do
      local dy = -radius
      while dy <= radius do
        local pos = {origin[1] + dx, origin[2] + dy}
        local m = canPlace(surface, force, placeName, pos, d, defines.build_check_type.manual)
        local g = canPlace(surface, force, placeName, pos, d, defines.build_check_type.blueprint_ghost)
        total = total + 1
        if m then nManual = nManual + 1 end
        if g then nGhost = nGhost + 1 end
        if m and #hits < 3000 then
          hits[#hits + 1] = {dx = dx, dy = dy, dir = d}
        end
        dy = dy + step
      end
      dx = dx + step
    end
  end
  return {
    hits = hits, manual_count = nManual, ghost_count = nGhost,
    candidates = total, truncated = #hits >= 3000,
  }
end

-- The game snaps a placement, so several accepted (position, direction) triples
-- can be the same entity. Building each one and reading back where it actually
-- landed is what turns a sweep into a count of *distinct* legal spots, which is
-- the number that says how big a truth table Option B would need.
local function distinctSpots(surface, force, placeName, origin, hits)
  local seen, spots = {}, {}
  for _, h in ipairs(hits) do
    local ok, e = pcall(function()
      return surface.create_entity{
        name = placeName, position = {origin[1] + h.dx, origin[2] + h.dy},
        direction = h.dir, force = force,
      }
    end)
    if ok and e then
      local key = e.position.x .. "," .. e.position.y .. "," .. e.direction
      if not seen[key] then
        seen[key] = true
        spots[#spots + 1] = {
          dx = e.position.x - origin[1], dy = e.position.y - origin[2], dir = e.direction,
        }
      end
      e.destroy()
    end
  end
  return spots
end

local function entityRows(list)
  local o = {}
  for i, e in ipairs(list or {}) do
    o[i] = {name = e.name, x = e.position.x, y = e.position.y, direction = e.direction}
  end
  return o
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({40, 0}, 8)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -30, 110 do
    for y = -30, 30 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  clearArea(surface, 40, 0, 90)

  -- Which rail prototypes exist and which directions each accepts at all. The
  -- editor's switch names five rail types; this says which of them a 2.x game
  -- will place and in which orientations, rather than assuming.
  local RAILS = {"straight-rail", "half-diagonal-rail", "curved-rail-a", "curved-rail-b",
                 "legacy-straight-rail", "legacy-curved-rail"}
  local DISTINCT = {}
  -- Requested direction vs the direction and position the entity actually
  -- lands at. can_place_entity answered true for all sixteen on the first run,
  -- which is only meaningful alongside what the game then normalises them to.
  for _, name in ipairs(RAILS) do
    local row = {name = name, dirs = {}, errors = {}}
    row.in_prototypes = prototypes.entity[name] ~= nil
    local seen = {}
    DISTINCT[name] = {}
    for _, d in ipairs(ALL_DIRS) do
      clearArea(surface, 0, 0, 12)
      local spot = findSpot(surface, force, name, d, 0, 0, 4)
      if spot then
        local rec = {dir = d, asked_x = spot[1], asked_y = spot[2]}
        pcall(function()
          local e = surface.create_entity{name = name, position = spot, direction = d, force = force}
          if e then
            rec.got_x, rec.got_y, rec.got_dir = e.position.x, e.position.y, e.direction
            if not seen[e.direction] then
              seen[e.direction] = true
              DISTINCT[name][#DISTINCT[name] + 1] = e.direction
            end
          end
        end)
        row.dirs[#row.dirs + 1] = rec
      end
    end
    out.notes[#out.notes + 1] = row
  end

  ---------------------------------------------------------------- section 1 + 2
  -- placeName swept around an existing anchor. Anchor nil means empty ground,
  -- which is the control for both sections.
  local CASES = {
    {label = "CONTROL rail-signal on empty ground", anchor = nil, place = "rail-signal"},
    {label = "CONTROL gate on empty ground", anchor = nil, place = "gate"},
  }

  -- Every distinct orientation of every rail type, for both signal kinds. A
  -- first pass swept two of straight-rail's four orientations, one of
  -- half-diagonal-rail's four and one of each curved rail's eight, and
  -- generalised "no legal signal sits on the rail's own tiles" from that. The
  -- claim decides whether isAreaAvailable may refuse the placement outright, so
  -- it has to hold for every orientation the editor can classify - including
  -- the legacy pair, which its switch groups with the 2.0 rails.
  for _, name in ipairs(RAILS) do
    for _, d in ipairs(DISTINCT[name] or {}) do
      for _, sig in ipairs({"rail-signal", "rail-chain-signal"}) do
        CASES[#CASES + 1] = {
          label = sig .. " beside " .. name .. " dir " .. d,
          anchor = name, anchorDir = d, place = sig,
        }
      end
    end
  end

  -- Gates over every rail orientation, for the same reason as the signals: the
  -- :229 TODO asks what a gate does on a half-diagonal rail, and an answer from
  -- one orientation is not an answer.
  for _, name in ipairs(RAILS) do
    for _, d in ipairs(DISTINCT[name] or {}) do
      CASES[#CASES + 1] = {
        label = "gate over " .. name .. " dir " .. d,
        anchor = name, anchorDir = d, place = "gate",
      }
    end
  end

  -- And every rail type over a gate, the direction the editor refuses today.
  for _, name in ipairs(RAILS) do
    CASES[#CASES + 1] = {
      label = name .. " over a gate", anchor = "gate", anchorDir = 0, place = name, step = 1,
    }
  end

  local MORE = {
    {label = "rail-signal over a gate", anchor = "gate", anchorDir = 0, place = "rail-signal"},

    -- The differential for the second blanket allowance, "any rail may be
    -- dropped on a signal". A rail cannot be swept over a lone signal, since a
    -- signal needs a rail to exist at all. So sweep the neighbouring rail slots
    -- around one rail, with and without a signal beside it, and diff: whatever
    -- the second sweep loses is what the signal blocks.
    {label = "CONTROL straight-rail near a lone straight-rail", anchor = "straight-rail", anchorDir = 0, place = "straight-rail", step = 1},
    {label = "straight-rail near a straight-rail that has a signal", anchor = "straight-rail", anchorDir = 0, place = "straight-rail", step = 1, withSignal = true},
  }
  for _, c in ipairs(MORE) do CASES[#CASES + 1] = c end

  for _, c in ipairs(CASES) do
    local row = {label = c.label, place = c.place, anchor = c.anchor, anchor_dir = c.anchorDir, errors = {}}
    clearArea(surface, 0, 0, 12)

    local origin = {0, 0}
    local ok = true
    if c.anchor then
      ok = try(row, "find anchor spot", function()
        local spot = findSpot(surface, force, c.anchor, c.anchorDir, 0, 0, 4)
        if not spot then error("no placeable spot for " .. c.anchor .. " dir " .. c.anchorDir) end
        origin = spot
      end)
      if ok then
        ok = try(row, "create anchor", function()
          local e = surface.create_entity{name = c.anchor, position = origin, direction = c.anchorDir, force = force}
          if not e then error("create_entity returned nil") end
          -- Rails snap to the 2-tile grid, so offsets are taken from where the
          -- entity actually landed, not from where it was asked for.
          origin = {e.position.x, e.position.y}
          row.anchor_x, row.anchor_y = e.position.x, e.position.y
          row.anchor_got_dir = e.direction
          local p = prototypes.entity[c.anchor]
          row.anchor_tw, row.anchor_th = p.tile_width, p.tile_height
        end)
      end
      if ok and c.withSignal then
        ok = try(row, "create signal beside anchor", function()
          local found = false
          for _, d in ipairs(ALL_DIRS) do
            local dx = -3
            while dx <= 3 and not found do
              local dy = -3
              while dy <= 3 and not found do
                local p = {origin[1] + dx, origin[2] + dy}
                if canPlace(surface, force, "rail-signal", p, d, defines.build_check_type.manual) then
                  local e = surface.create_entity{name = "rail-signal", position = p, direction = d, force = force}
                  if e then
                    row.signal_x, row.signal_y, row.signal_dir = e.position.x, e.position.y, e.direction
                    found = true
                  end
                end
                dy = dy + 0.5
              end
              dx = dx + 0.5
            end
            if found then break end
          end
          if not found then error("no legal signal spot beside the anchor") end
        end)
      end
    end

    if ok then
      local res = sweep(surface, force, c.place, origin, 3, c.step or 0.5)
      row.hits = res.hits
      row.manual_count = res.manual_count
      row.ghost_count = res.ghost_count
      row.candidates = res.candidates
      row.truncated = res.truncated
      row.origin_x, row.origin_y = origin[1], origin[2]
      if #res.hits > 0 and #res.hits <= 120 then
        row.spots = distinctSpots(surface, force, c.place, origin, res.hits)
      end
    end

    out.sweeps[#out.sweeps + 1] = row
  end

  ---------------------------------------------------------------- section 3
  -- A legal rail + signal blueprint, mutated so the signal sits on the rail,
  -- then round tripped. The mutation is the only difference between the two.
  local inv = game.create_inventory(2)

  -- The mover is the entity dragged onto the rail. For a signal the legal control
  -- is the first spot the game accepts. For a gate every tile is acceptable, so
  -- the control is a fixed offset well clear of the rail - still legal, still a
  -- single-field mutation, and the "gate on a cardinal rail" case is the
  -- control for the diagonal one, since the game allows that and the editor
  -- models it.
  local ROUND = {
    {label = "rail-signal onto straight-rail dir 0", rail = "straight-rail", dir = 0, mover = "rail-signal"},
    {label = "rail-signal onto half-diagonal-rail dir 2", rail = "half-diagonal-rail", dir = 2, mover = "rail-signal"},
    {label = "rail-signal onto curved-rail-a dir 0", rail = "curved-rail-a", dir = 0, mover = "rail-signal"},
    {label = "CONTROL gate onto straight-rail dir 0, cardinal - the game allows this", rail = "straight-rail", dir = 0, mover = "gate"},
    {label = "gate onto straight-rail dir 2, diagonal - the game allows none", rail = "straight-rail", dir = 2, mover = "gate"},
    {label = "gate onto straight-rail dir 6, diagonal - the game allows none", rail = "straight-rail", dir = 6, mover = "gate"},
  }

  for _, c in ipairs(ROUND) do
    local row = {label = c.label, mover = c.mover, errors = {}}
    clearArea(surface, 0, 0, 12)

    local railPos, sigPos, sigDir
    local ok = try(row, "find rail spot", function()
      railPos = findSpot(surface, force, c.rail, c.dir, 0, 0, 4)
      if not railPos then error("no rail spot") end
    end)
    if ok then ok = try(row, "create rail", function()
      local e = surface.create_entity{name = c.rail, position = railPos, direction = c.dir, force = force}
      if not e then error("create_entity returned nil") end
      railPos = {e.position.x, e.position.y}
      row.rail_got_dir = e.direction
    end) end

    -- The first spot the game itself accepts the mover at. Not a guess.
    if ok then ok = try(row, "find mover spot", function()
      local found = false
      local startDx = c.mover == "gate" and 5 or -3
      for _, d in ipairs(ALL_DIRS) do
        local dx = startDx
        while dx <= 6 and not found do
          local dy = -3
          while dy <= 3 and not found do
            local p = {railPos[1] + dx, railPos[2] + dy}
            if canPlace(surface, force, c.mover, p, d, defines.build_check_type.manual) then
              sigPos, sigDir, found = p, d, true
            end
            dy = dy + 0.5
          end
          dx = dx + 0.5
        end
        if found then break end
      end
      if not found then error("no legal " .. c.mover .. " spot next to " .. c.rail) end
    end) end

    if ok then ok = try(row, "create mover", function()
      surface.create_entity{name = c.mover, position = sigPos, direction = sigDir, force = force}
    end) end

    if ok then
      row.legal_mover = {x = sigPos[1], y = sigPos[2], dir = sigDir}
      row.rail_pos = {x = railPos[1], y = railPos[2]}

      try(row, "capture legal", function()
        inv[1].set_stack{name = "blueprint"}
        inv[1].create_blueprint{surface = surface, force = force,
                                area = {{railPos[1] - 8, railPos[2] - 8}, {railPos[1] + 8, railPos[2] + 8}}}
        row.legal_entities = entityRows(inv[1].get_blueprint_entities())
        row.legal_string = inv[1].export_stack()
      end)

      -- Move the mover onto the rail's own position: what the editor allows.
      try(row, "mutate", function()
        local ents = inv[1].get_blueprint_entities()
        local railEnt
        for _, e in pairs(ents) do if e.name == c.rail then railEnt = e end end
        if not railEnt then error("no rail in captured blueprint") end
        for _, e in pairs(ents) do
          if e.name == c.mover then e.position = {x = railEnt.position.x, y = railEnt.position.y} end
        end
        inv[2].set_stack{name = "blueprint"}
        inv[2].set_blueprint_entities(ents)
        row.mutated_entities = entityRows(inv[2].get_blueprint_entities())
        row.mutated_string = inv[2].export_stack()
      end)

      -- Re-import the mutated string into a fresh stack, the way this editor's
      -- output would arrive.
      try(row, "reimport", function()
        inv[2].set_stack{name = "blueprint"}
        row.import_code = inv[2].import_stack(row.mutated_string)
        row.reimported_entities = entityRows(inv[2].get_blueprint_entities())
      end)

      -- Lay everything in the blueprint except the mover, for real, and then ask
      -- the game whether the mover may go where the blueprint says.
      --
      -- An earlier version stamped the blueprint and revived its ghosts instead.
      -- That measurement was discarded: reviving one of two overlapping ghosts
      -- destroys the other whether or not the arrangement is legal, and the
      -- cardinal gate-on-rail case - which the game does support - lost an
      -- entity exactly like the illegal ones. It was measuring ghost collision,
      -- not placement. can_place_entity with build_check_type.manual is the
      -- check isAreaAvailable reimplements, so it is the one to ask.
      local function layThenAsk(stack, at)
        clearArea(surface, at[1], at[2], 14)
        local ents = stack.get_blueprint_entities()
        local built, moverPos, moverDir = {}, nil, nil

        for _, e in pairs(ents) do
          local p = {at[1] + e.position.x, at[2] + e.position.y}
          if e.name == c.mover and moverPos == nil then
            moverPos, moverDir = p, e.direction or 0
          else
            local ok, ent = pcall(function()
              return surface.create_entity{
                name = e.name, position = p, direction = e.direction or 0, force = force,
              }
            end)
            if ok and ent then
              built[#built + 1] = {
                name = ent.name, x = ent.position.x - at[1], y = ent.position.y - at[2],
                direction = ent.direction,
              }
            else
              built[#built + 1] = {name = e.name, failed = true}
            end
          end
        end

        local res = {built = built}
        if moverPos then
          res.mover_at = {x = moverPos[1] - at[1], y = moverPos[2] - at[2], dir = moverDir}
          res.mover_placeable = canPlace(
            surface, force, c.mover, moverPos, moverDir, defines.build_check_type.manual
          )
          -- Every direction the game would accept at that exact position, not
          -- just the one the blueprint happens to carry. The single-direction
          -- question was the wrong one: the free-standing control spot gave the
          -- gate direction 0, which is parallel to a north-south rail and which
          -- both the game and this editor refuse, so a legal arrangement read
          -- as refused. What distinguishes cardinal from diagonal is whether
          -- *any* direction works.
          res.placeable_dirs = {}
          for _, d in ipairs(ALL_DIRS) do
            if canPlace(surface, force, c.mover, moverPos, d, defines.build_check_type.manual) then
              res.placeable_dirs[#res.placeable_dirs + 1] = d
            end
          end
        end
        return res
      end

      -- Control first: the unmutated blueprint, whose mover sits where the game
      -- itself put it. If this ever answers false the mutated case proves
      -- nothing, because the ground was never buildable.
      try(row, "lay legal", function()
        row.legal_result = layThenAsk(inv[1], {40, 0})
      end)

      try(row, "lay mutated", function()
        inv[2].set_stack{name = "blueprint"}
        inv[2].import_stack(row.mutated_string)
        row.mutated_result = layThenAsk(inv[2], {70, 0})
      end)
    end

    out.roundtrips[#out.roundtrips + 1] = row
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
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)

const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error(
        'No dump. Factorio tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000)
    )
    process.exit(1)
}

const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
const vals = o => Object.values(o ?? {})

/*
    The editor's own footprint rule, read from the same data.json the editor
    loads. Mirroring `getEntitySize` and `PositionGrid.processArea` rather than
    reading a bounding box out of the game is the point: the question is not
    what collides in Factorio, it is what `isAreaAvailable` sees on its integer
    tile grid.
*/
const FD = JSON.parse(
    readFileSync(
        join(
            dirname(fileURLToPath(import.meta.url)),
            '../../packages/exporter/data/output/data.json'
        ),
        'utf8'
    )
).entities

const entitySize = (name, dir = 0) => {
    const e = FD[name]
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

/** The tile rectangle PositionGrid would key, as [x0, y0, w, h]. */
const tileRect = (name, cx, cy, dir) => {
    const s = entitySize(name, dir)
    return [Math.round(cx - s.x / 2), Math.round(cy - s.y / 2), s.x, s.y]
}

const rectsOverlap = (a, b) =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

console.log('=== rail prototypes: requested direction -> what the game normalises it to')
for (const r of vals(dump.notes)) {
    const dirs = vals(r.dirs)
    const snap = new Map()
    for (const d of dirs) {
        const got = d.got_dir === undefined ? '(not created)' : String(d.got_dir)
        if (!snap.has(got)) snap.set(got, [])
        snap.get(got).push(d.dir)
    }
    console.log(
        `  ${r.name.padEnd(22)} in prototypes: ${String(r.in_prototypes).padEnd(5)} can_place says yes for ${dirs.length}/16`
    )
    for (const [got, asked] of [...snap].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`      asked ${asked.join(',').padEnd(30)} -> got direction ${got}`)
    }
    for (const e of vals(r.errors)) console.log(`      ! ${e}`)
}

console.log('\n=== can_place_entity sweeps, manual only (offsets from the anchor as created)')
const swept = new Map()
const sweepSummaries = []
for (const r of vals(dump.sweeps)) {
    console.log(`\n--- ${r.label}`)
    for (const e of vals(r.errors)) console.log(`    ! ${e}`)
    if (r.candidates === undefined) continue
    if (r.anchor_x !== undefined) {
        console.log(
            `    anchor ${r.anchor} at (${r.anchor_x},${r.anchor_y})` +
                (r.signal_x === undefined
                    ? ''
                    : `, signal at (${r.signal_x},${r.signal_y}) dir ${r.signal_dir}`)
        )
    }
    console.log(
        `    candidates ${r.candidates}   MANUAL-ok ${r.manual_count}   (ghost-ok ${r.ghost_count}, ignores rail adjacency)` +
            (r.truncated ? '   (list truncated)' : '')
    )

    const hits = vals(r.hits)
    swept.set(r.label, new Set(hits.map(h => `${h.dx},${h.dy},${h.dir}`)))

    const byOffset = new Map()
    for (const h of hits) {
        const k = `${h.dx},${h.dy}`
        if (!byOffset.has(k)) byOffset.set(k, [])
        byOffset.get(k).push(h.dir)
    }
    if (byOffset.size === 0) {
        console.log('    no legal manual placement anywhere in the swept area')
    } else if (byOffset.size > 30) {
        console.log(`    ${byOffset.size} distinct offsets (too many to list)`)
    } else {
        for (const [k, dirs] of [...byOffset].sort((a, b) => a[0].localeCompare(b[0]))) {
            console.log(`      offset ${k.padEnd(10)} dirs ${dirs.join(',')}`)
        }
    }
    /*
        The question both blanket allowances turn on, asked in the editor's own
        terms rather than the game's. `PositionGrid` is a map of integer tiles;
        `processArea` puts an entity's top left at round(centre - size/2) and it
        occupies size tiles from there. So the allowance at PositionGrid.ts:308
        fires exactly when the signal's tile falls inside the rail's tiles - and
        nowhere else, because a non-overlapping placement is already answered by
        the isAreaEmpty check above it.

        A collision-box test would answer a different question. Rail signals do
        not collide with rails at all, being on separate collision layers, so
        "do the boxes touch" is true in places the editor's grid calls empty.
    */
    const summary = {
        label: r.label,
        place: r.place,
        anchor: r.anchor ?? null,
        anchor_dir_asked: r.anchor_dir ?? null,
        anchor_dir_got: r.anchor_got_dir ?? null,
        anchor_position: r.anchor_x === undefined ? null : { x: r.anchor_x, y: r.anchor_y },
        extra_signal:
            r.signal_x === undefined ? null : { x: r.signal_x, y: r.signal_y, dir: r.signal_dir },
        candidates: r.candidates,
        manual_ok: r.manual_count,
        ghost_ok: r.ghost_count,
        truncated: r.truncated ?? false,
        spots: vals(r.spots),
        errors: vals(r.errors),
    }

    if (r.anchor && r.anchor_x !== undefined) {
        const anchorRect = tileRect(r.anchor, r.anchor_x, r.anchor_y, r.anchor_got_dir ?? 0)
        // Distinct spots where available; otherwise the raw accepted triples.
        const spots = vals(r.spots)
        const set = spots.length ? spots : hits
        const over = set.filter(h =>
            rectsOverlap(anchorRect, tileRect(r.place, r.anchor_x + h.dx, r.anchor_y + h.dy, h.dir))
        )
        if (spots.length) {
            console.log(
                `    distinct placements after the game's snapping: ${spots.length}  ` +
                    spots.map(s => `(${s.dx},${s.dy})d${s.dir}`).join(' ')
            )
        }
        console.log(
            `    >>> of those, TILES overlapping the anchor's (what isAreaAvailable sees): ${over.length} of ${set.length}` +
                (over.length
                    ? ` at ${[...new Set(over.map(h => `${h.dx},${h.dy}`))].join(' ')}`
                    : '   <- the editor permits this overlap and the game permits none of it')
        )
        summary.anchor_tile_rect = anchorRect
        summary.deduped = spots.length > 0
        summary.considered = set.length
        summary.tile_overlapping = over.length
        summary.tile_overlapping_offsets = [...new Set(over.map(h => `${h.dx},${h.dy}`))]
        // Which directions of the placed entity survive the overlap. For the
        // rail-over-a-gate sweeps this is the rail's own direction, which is
        // what says whether the cardinal-only rule that governs gates on
        // straight rails also governs rails laid over a gate.
        summary.tile_overlapping_dirs = [...new Set(over.map(h => h.dir))].sort((a, b) => a - b)
    }

    // The full hit list only where it is small enough to be worth keeping; the
    // gate sweeps run to thousands and their meaning is in the counts and the
    // overlap set above.
    if (hits.length <= 200) summary.hits = hits
    sweepSummaries.push(summary)
}

const lone = swept.get('CONTROL straight-rail near a lone straight-rail')
const withSig = swept.get('straight-rail near a straight-rail that has a signal')
let signalBlocksRails = null
if (lone && withSig) {
    const lost = [...lone].filter(k => !withSig.has(k))
    const gained = [...withSig].filter(k => !lone.has(k))
    console.log(
        `\n--- diff: a signal beside the rail costs ${lost.length} of ${lone.size} rail placements` +
            (gained.length ? ` (and gains ${gained.length}, which would be a bug)` : '')
    )
    const offs = [...new Set(lost.map(k => k.split(',').slice(0, 2).join(',')))]
    if (offs.length) console.log(`    blocked offsets: ${offs.join('  ')}`)
    signalBlocksRails = {
        without_signal: lone.size,
        with_signal: withSig.size,
        blocked: lost.length,
        gained: gained.length,
        blocked_offsets: offs,
    }
}

console.log('\n=== round trips: a signal moved onto the rail, then re-imported, built and revived')
const fmt = list =>
    vals(list)
        .map(e => `${e.name}@(${e.x},${e.y})d${e.direction ?? 0}`)
        .join(' ') || '(none)'
const showBuild = (label, b, mover) => {
    if (b === undefined) {
        console.log(`    ${label}: (not run)`)
        return
    }
    const built = vals(b.built)
        .map(e => (e.failed ? `${e.name}:FAILED` : `${e.name}@(${e.x},${e.y})`))
        .join(' ')
    const dirs = vals(b.placeable_dirs)
    console.log(
        `    ${label.padEnd(16)} laid ${built || '(nothing)'}  ->  ${mover} at (${
            b.mover_at?.x
        },${b.mover_at?.y}): d${b.mover_at?.dir} ${
            b.mover_placeable ? 'placeable' : 'refused'
        }, and of all 16 directions the game accepts ${
            dirs.length ? `${dirs.length}: ${dirs.join(',')}` : 'NONE'
        }`
    )
}
for (const r of vals(dump.roundtrips)) {
    console.log(`\n--- ${r.label}`)
    for (const e of vals(r.errors)) console.log(`    ! ${e}`)
    if (r.legal_mover) {
        console.log(
            `    rail at (${r.rail_pos.x},${r.rail_pos.y}) dir ${r.rail_got_dir}; first legal ${r.mover} spot (${r.legal_mover.x},${r.legal_mover.y}) dir ${r.legal_mover.dir}`
        )
    }
    console.log(`    legal blueprint:   ${fmt(r.legal_entities)}`)
    console.log(`    mutated blueprint: ${fmt(r.mutated_entities)}`)
    console.log(`    import_stack code: ${r.import_code}`)
    console.log(`    after re-import:   ${fmt(r.reimported_entities)}`)
    showBuild('CONTROL legal:', r.legal_result, r.mover)
    showBuild('mutated:', r.mutated_result, r.mover)
}

const raw = join(work, 'rail-placement-raw.json')
writeFileSync(raw, JSON.stringify(dump, null, 2))
console.log(`\nraw: ${raw}`)

/*
    Behind a flag on purpose. Every other capture here is a fixture that tests
    assert against, and a probe that rewrote its own fixture on every run would
    turn "the game changed" into "the fixture changed", which is the one thing
    the fixture policy exists to prevent.
*/
if (process.argv.includes('--write-fixture')) {
    const bin = spawnSync(BIN, ['--version'], { encoding: 'utf8' })
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rail-placement.json')
    writeFileSync(
        fixture,
        JSON.stringify(
            {
                question:
                    'Where may a rail signal and a gate sit relative to each 2.0 rail type, and what does the game do with a blueprint that puts a signal on a rail the way PositionGrid.isAreaAvailable permits?',
                issue: 95,
                probe: 'tools/oracle/probe-rail-placement.mjs',
                binary: (bin.stdout ?? '').split('\n')[0],
                versionCaveat:
                    'Captured on 2.1.12. This editor targets 2.0.45 to 2.0.73; the corpus itself ranges wider, 2.0.32 to 2.1.12, with two files declaring 2.1.12 (see tools/oracle/README.md). Rail placement rules are assumed stable across that whole range and were NOT measured on a 2.0.x binary.',
                measurementCaveats: [
                    'build_check_type.blueprint_ghost does not check rail adjacency - the empty-ground control returns 0 manual and 2704 ghost. Only the manual counts answer where a signal may go.',
                    'create_entity snaps rails to the 2-tile grid and signals to their own grid, so raw accepted (position, direction) triples over-count. The `spots` field on each sweep is the deduplicated set after snapping and is the number to read.',
                    "Tile overlap is computed on this side from packages/exporter/data/output/data.json, mirroring getEntitySize and PositionGrid.processArea, because the question is what the editor's integer tile grid sees rather than what collides in Factorio.",
                    'A stamp-and-revive measurement was tried and DISCARDED. Reviving one of two overlapping ghosts destroys the other whether or not the arrangement is legal - the cardinal gate-on-rail case, which the game supports, lost an entity exactly like the illegal ones. It measures ghost collision, not placement. The round trips lay the blueprint for real and then ask can_place_entity instead.',
                    'placeable_dirs on each round trip is the whole set of directions the game accepts at that position, not just the one the blueprint carries. Asking about a single direction gave a false negative on the control, whose free-standing gate faced parallel to the rail.',
                ],
                directionNormalisation: vals(dump.notes),
                sweeps: sweepSummaries,
                signalBlocksNeighbouringRails: signalBlocksRails,
                roundTrips: vals(dump.roundtrips),
            },
            null,
            4
        )
    )
    console.log(`fixture written: ${fixture}\nnow run: vp check --fix`)
}
