--[[
What does the blueprint GUI's "Grid position" field actually do to an
exported blueprint string?

Why this probe is interactive, which is the expensive choice and was checked
before being made. Measured against 2.0.77's own `doc-html/runtime-api.json`:
`LuaItemCommon` exposes exactly three blueprint snapping attributes -
`blueprint_snap_to_grid`, `blueprint_absolute_snapping` and
`blueprint_position_relative_to_grid` - and none of them is this field.
`create_blueprint` takes no anchor parameter either. The game's own tooltip
(`core.cfg:2335`) says the field is set by shift + left-click in the preview.
So there is no script that can set it, and a person has to.

Why it is worth measuring at all. `tools/oracle/fixtures/blueprint-grid-
position.json` already asked "does a blueprint's grid position move its
entities" and answered no, scoring the premise 0 of 2 with `entitiesMovedOn: 0`.
That capture set `blueprint_position_relative_to_grid`. The game's own locale
separates the two concepts in one line - `core.cfg:274`, "Grid position and
blueprint grid position coordinates need to be either all even or all odd" -
so the earlier fixture measured the neighbouring field, not this one. Its
answer is not wrong; it is about something else.

The rival readings this has to separate, decided before the run rather than
after it (docs/method.md, "which hypotheses a probe value can separate is part
of the question"):

  H1  Setting Grid position to T shifts the exported content so that
      -floor(min position over entities and tiles) == T, and writes no
      snapping field. This is what packages/editor/src/core/Blueprint.ts
      ships today.
  H2  Grid position does not move anything and writes
      `position-relative-to-grid`.
  H3  It writes some field the editor does not currently decode.
  H4  It moves everything by exactly (-T.x, -T.y). This was PR #222's original
      premise.

H1 and H4 agree whenever the content's minimum corner already sits at the
origin, so the layout below deliberately does not start there, and the session
asks for a second change on top of a first: only a non-zero starting corner and
a repeated change separate "an absolute target" from "a relative nudge".
]]

local OUT = 'grid-position-gui.jsonl'

local function emit(row)
    row.tick = game.tick
    helpers.write_file(OUT, helpers.table_to_json(row) .. '\n', true)
end

--[[
One capture separates three readings of "the minimum corner" at once, by
putting each question on a different axis:

  x-min is decided by the 3x3 assembling machine. Its centre sits at 10.5 and
        its left edge at 9.0, which floor to different integers, so a formula
        reading centres and one reading edges cannot agree. The editor's
        getGridPositionDisplay() reads centres and says so in its own comment,
        noting that every case measured so far used 1x1 entities where the two
        coincide. This is that untested case.
  y-min is decided by a tile at y=10, six tiles above anything else, so
        whether tiles count towards the corner at all is visible rather than
        assumed. The editor's formula includes them.

docs/method.md: a probe entity is part of the question, not a neutral
instrument.
]]
local LAYOUT = {
    entities = {
        { name = 'assembling-machine-1', position = { x = 10.5, y = 20.5 } },
        { name = 'wooden-chest', position = { x = 20.5, y = 20.5 } },
        { name = 'wooden-chest', position = { x = 20.5, y = 26.5 } },
    },
    tiles = {
        { x = 14, y = 10 },
        { x = 15, y = 10 },
        { x = 14, y = 11 },
        { x = 15, y = 11 },
    },
    tile_name = 'stone-path',
}

local AREA = { { 0, 0 }, { 40, 40 } }

local function build_layout(player)
    local surface = player.surface
    -- Clear first, so the blueprint holds the layout and nothing the map
    -- generator happened to put in the same square.
    for _, e in pairs(surface.find_entities_filtered { area = AREA }) do
        if e.valid and e.type ~= 'character' then
            e.destroy()
        end
    end

    local tiles = {}
    for _, t in pairs(LAYOUT.tiles) do
        tiles[#tiles + 1] = { name = LAYOUT.tile_name, position = { t.x, t.y } }
    end
    surface.set_tiles(tiles)

    for _, e in pairs(LAYOUT.entities) do
        surface.create_entity {
            name = e.name,
            position = e.position,
            force = player.force,
        }
    end
end

local function fill_blueprint(stack, player)
    stack.create_blueprint {
        surface = player.surface,
        force = player.force,
        area = AREA,
        always_include_tiles = true,
    }
end

--[[
Finds the blueprint the person is working with. Searches the cursor first,
because the GUI is opened on a held blueprint as often as on one in a slot,
and `is_blueprint_setup()` keeps an empty spare from being picked up instead.
]]
local function find_bp(player)
    local cursor = player.cursor_stack
    if cursor and cursor.valid_for_read and cursor.is_blueprint and cursor.is_blueprint_setup() then
        return cursor
    end
    local inv = player.get_main_inventory()
    for i = 1, #inv do
        local s = inv[i]
        if s.valid_for_read and s.is_blueprint and s.is_blueprint_setup() then
            return s
        end
    end
    return nil
end

--[[
`tag` marks who set the state being captured. docs/method.md: a script-set
value is not a measured one, and must be excluded by tag rather than by value,
or the controls below join the sample they exist to validate.
]]
local function capture(player, label, tag, stack)
    local bp = stack or find_bp(player)
    if not bp then
        player.print('[grid-probe] no set-up blueprint found - is one in your inventory?')
        return false
    end

    emit {
        kind = 'capture',
        label = label,
        tag = tag,
        snap_to_grid = bp.blueprint_snap_to_grid,
        absolute_snapping = bp.blueprint_absolute_snapping,
        position_relative_to_grid = bp.blueprint_position_relative_to_grid,
        entities = bp.get_blueprint_entities(),
        tiles = bp.get_blueprint_tiles(),
        export = bp.export_stack(),
    }
    player.print('[grid-probe] captured: ' .. label)
    return true
end

--[[
The three scripted controls. They run on their own scratch blueprint so that
nothing here disturbs the one the person is about to edit.

Each is here because it can fail while the hypothesis holds, which is the bar
docs/method.md sets and the bar PR #222's null-result cases did not clear:

  instrument-repeat   Two captures with nothing changed in between. If these
                      ever differ, every "the coordinates moved" row below is
                      worthless, because export is not deterministic.
  positive-shift      The script moves the blueprint's contents by a known
                      amount through set_blueprint_entities. These coordinates
                      *have* to differ. Without it, "nothing moved" is not
                      evidence of anything - it is equally what reading the
                      same field twice looks like.
  rival-field         The script sets `blueprint_position_relative_to_grid`,
                      the field the earlier fixture measured, on this same rig.
                      That is what makes the two fields comparable rather than
                      merely asserted to be different: if the human-driven Grid
                      position rows and these rows move the same numbers, the
                      two are one field after all and H2 is back.
]]
local function run_controls(player)
    local inv = player.get_main_inventory()
    inv.insert { name = 'blueprint', count = 1 }

    local scratch = nil
    for i = 1, #inv do
        local s = inv[i]
        if s.valid_for_read and s.is_blueprint and not s.is_blueprint_setup() then
            scratch = s
            break
        end
    end
    if not scratch then
        player.print('[grid-probe] could not get a scratch blueprint for the controls')
        return
    end

    fill_blueprint(scratch, player)

    capture(player, 'control-instrument-repeat-1', 'script', scratch)
    capture(player, 'control-instrument-repeat-2', 'script', scratch)

    local entities = scratch.get_blueprint_entities()
    if entities then
        for _, e in pairs(entities) do
            e.position.x = e.position.x - 3
            e.position.y = e.position.y - 4
        end
        scratch.set_blueprint_entities(entities)
        capture(player, 'control-positive-shift', 'script', scratch)
    end

    -- Rebuild rather than shifting back: set_blueprint_entities drops the
    -- tiles, so restoring by arithmetic would leave a different blueprint
    -- under the same name.
    fill_blueprint(scratch, player)
    scratch.blueprint_snap_to_grid = { x = 4, y = 4 }
    scratch.blueprint_absolute_snapping = true
    scratch.blueprint_position_relative_to_grid = { x = 3, y = 5 }
    capture(player, 'control-rival-field', 'script', scratch)

    scratch.clear()
    player.print('[grid-probe] controls done (4 rows)')
end

local INSTRUCTIONS = {
    '',
    '[grid-probe] Layout built, blueprint in your inventory, controls captured.',
    '',
    'For each step: do the thing in the blueprint GUI, close it, then run the',
    'capture command shown. Order matters - later steps build on earlier ones.',
    '',
    '  1. /gp-cap untouched',
    '  2. Open the blueprint GUI. Tick "Snap to grid". Close.  /gp-cap snap-on',
    '  3. Set Grid position to X=3 Y=5 (shift+left-click in the preview, or',
    '     type it). Close.                                    /gp-cap gridpos-3-5',
    '  4. Set Grid position to X=8 Y=9. Close.                 /gp-cap gridpos-8-9',
    '     (This is the step that separates an absolute target from a nudge.)',
    '  5. Set Grid position back to X=0 Y=0. Close.            /gp-cap gridpos-0-0',
    '  6. Pick "Absolute". Set its own X/Y to X=2 Y=6. Close.  /gp-cap abs-2-6',
    '  7. Untick "Snap to grid". Close.                        /gp-cap snap-off',
    '',
    'Use /gp-note <text> if anything surprises you - a value the game refused,',
    'a field that reset itself, a parity warning. Those are findings.',
    'Use /gp-reset to rebuild the layout and start over.',
    '',
}

local function announce(player)
    for _, line in pairs(INSTRUCTIONS) do
        player.print(line)
    end
end

local function setup(player)
    build_layout(player)

    local inv = player.get_main_inventory()
    inv.insert { name = 'blueprint', count = 1 }
    local bp = nil
    for i = 1, #inv do
        local s = inv[i]
        if s.valid_for_read and s.is_blueprint and not s.is_blueprint_setup() then
            bp = s
            break
        end
    end
    if not bp then
        player.print('[grid-probe] could not get a blueprint')
        return
    end
    fill_blueprint(bp, player)

    emit {
        kind = 'setup',
        layout = LAYOUT,
        area = AREA,
        -- Recorded so the analysis never has to guess what was on the ground,
        -- and so a rebuilt session is comparable with an earlier one.
        active_mods = script.active_mods,
    }

    run_controls(player)
    announce(player)
end

commands.add_command('gp-cap', 'Capture the blueprint state under a label', function(cmd)
    local player = game.get_player(cmd.player_index)
    if not player then
        return
    end
    local label = cmd.parameter
    if not label or label == '' then
        player.print('[grid-probe] usage: /gp-cap <label>')
        return
    end
    capture(player, label, 'human')
end)

commands.add_command('gp-note', 'Record a note in the capture stream', function(cmd)
    local player = game.get_player(cmd.player_index)
    if not player then
        return
    end
    emit { kind = 'note', text = cmd.parameter or '', tag = 'human' }
    player.print('[grid-probe] noted')
end)

commands.add_command('gp-reset', 'Rebuild the layout and re-run the controls', function(cmd)
    local player = game.get_player(cmd.player_index)
    if not player then
        return
    end
    emit { kind = 'reset' }
    setup(player)
end)

commands.add_command('gp-help', 'Print the session instructions again', function(cmd)
    local player = game.get_player(cmd.player_index)
    if player then
        announce(player)
    end
end)

script.on_event(defines.events.on_player_created, function(event)
    local player = game.get_player(event.player_index)
    if not player then
        return
    end
    -- Freeplay drops the player into a cutscene on some versions; leaving it
    -- first means the GUI and the console are both reachable straight away.
    if player.controller_type == defines.controllers.cutscene then
        player.exit_cutscene()
    end
    setup(player)
end)
