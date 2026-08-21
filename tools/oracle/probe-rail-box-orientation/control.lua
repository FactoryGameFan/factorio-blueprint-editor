--[==[
Does a `half-diagonal-rail` actually have the collision box `data.json`
describes, at the orientation the grid-position probe's run 2 layout assumes?

This exists to de-risk that run before a person spends time on it. Run 2 puts a
half-diagonal rail at (20, 20) and predicts three distinct y readings from it -
centre 20, tile-footprint edge 19, collision-box edge 17.764 - and that spread
is the only thing separating "the corner is the footprint edge" from "the
corner is the collision box edge".

Those numbers come from `data.json`, which carries one box per prototype.
This header is a level-1 long comment on purpose. The box below is written in
Lua table notation, and a bare double-close-bracket inside an ordinary long
comment terminates it, so everything after it parses as code. Same family as
the backtick-in-a-template-literal trap the other probe carries, and note that
naming the level-1 terminator in this sentence would close this comment too -
which is exactly the mistake that cost the first two runs here.

`[[-0.75, -2.236], [0.75, 2.236]]`, tall and narrow. Half-diagonal rails exist
only at diagonal orientations, so a rail stored at a rotated direction has that
extent on x instead. Run 2 would then measure nothing and report no surviving
reading, which reads as "the rule is wrong" rather than "the instrument was
pointed sideways".

Nothing here needs a player, so it is a `create` run - docs/method.md, "ask the
cheapest question that settles the thing". The grid-position probe needs a
person only because its field has no scripting API; this question does not
touch that field.

Three things are recorded per direction, and the third is the one that matters:

  requested        what was asked for
  stored_direction what `entity.direction` reads back, since rails normalise
  bounding_box     the entity's **actual** world box, which is what rotates

`prototype_collision_box` is the control: it is the number the grid-position
analyzer's GEOMETRY table hardcodes, so if it disagrees with `data.json` the
exporter has drifted and the comparison is void rather than interesting.

Shaped after `factorio-oracle`'s own pumpjack-terminals example, which is the
working reference for a create-mode probe: generate the chunks first, because
the default generated area is small and (20, 20) sits near its edge, and let
`on_init` return normally after writing rather than raising the sentinel.
]==]

local function collect()
    local surface = game.surfaces[1]
    local force = game.forces.player
    local NAME = 'half-diagonal-rail'
    local POS = { x = 20, y = 20 }

    surface.request_to_generate_chunks({ 20, 20 }, 3)
    surface.force_generate_chunk_requests()

    local proto = prototypes.entity[NAME]
    local out = {
        question = 'what box does a half-diagonal-rail actually have, per direction',
        name = NAME,
        requested_position = POS,
        active_mods = script.active_mods,
        prototype_collision_box = proto.collision_box,
        prototype_tile_width = proto.tile_width,
        prototype_tile_height = proto.tile_height,
        directions = {},
        errors = {},
    }

    for dir = 0, 15 do
        local row = { requested_direction = dir }

        local ok, err = pcall(function()
            -- Clear first: a rail left from the previous direction would refuse
            -- the next one and turn a geometry answer into a collision answer.
            for _, e in pairs(surface.find_entities_filtered { area = { { 10, 10 }, { 30, 30 } } }) do
                if e.valid and e.type ~= 'character' then
                    e.destroy()
                end
            end

            local e = surface.create_entity {
                name = NAME,
                position = POS,
                direction = dir,
                force = force,
            }
            if not e then
                row.created = false
                return
            end
            row.created = true
            row.stored_direction = e.direction
            row.position = { x = e.position.x, y = e.position.y }
            local bb = e.bounding_box
            row.bounding_box = {
                left_top = { x = bb.left_top.x, y = bb.left_top.y },
                right_bottom = { x = bb.right_bottom.x, y = bb.right_bottom.y },
            }

            --[[
            What the *export* carries, which is the only thing the grid-position
            analyzer ever sees. It reads positions out of the blueprint string
            rather than off the entity, and a rail can sit at one direction in
            the world while serializing as another.
            ]]
            local inv = game.create_inventory(1)
            inv[1].set_stack { name = 'blueprint', count = 1 }
            inv[1].create_blueprint {
                surface = surface,
                force = force,
                area = { { 10, 10 }, { 30, 30 } },
                always_include_tiles = false,
            }
            row.exported = inv[1].get_blueprint_entities()
            inv.destroy()

            e.destroy()
        end)

        if not ok then
            row.error = tostring(err)
            out.errors[#out.errors + 1] = 'direction ' .. dir .. ': ' .. tostring(err)
        end
        out.directions[#out.directions + 1] = row
    end

    --[[
    Every entity's runtime collision box, so the per-rail finding above can be
    checked against the whole set rather than generalised from one prototype.
    The editor reads these из data.json, and if that file disagrees with the
    running game then every footprint the editor computes is suspect, not just
    this rail's.
    ]]
    out.all_collision_boxes = {}
    for name, ep in pairs(prototypes.entity) do
        local bb = ep.collision_box
        out.all_collision_boxes[name] = {
            bb.left_top.x,
            bb.left_top.y,
            bb.right_bottom.x,
            bb.right_bottom.y,
        }
    end

    helpers.write_file('oracle-dump.json', helpers.table_to_json(out), false)
end

script.on_init(collect)
