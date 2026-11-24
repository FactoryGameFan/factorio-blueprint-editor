-- start util functions
local function table_merge(t1, t2)
    for k, v in pairs(t2) do
        t1[k] = v
    end
end

local function list_iter(t)
    local i = 0
    local n = #t
    return function()
        i = i + 1
        if i <= n then
            return t[i]
        end
    end
end

local function list_includes(t, v)
    for value in list_iter(t) do
        if value == v then
            return true
        end
    end
    return false
end

local function table_filter(t, blacklist)
    for key in pairs(t) do
        if list_includes(blacklist, key) then
            t[key] = nil
        end
    end
end

local function char_generator()
    local nextIndex = 0
    return function()
        local char = string.char(string.byte('a') + nextIndex)
        nextIndex = nextIndex + 1
        return char
    end
end

local function deep_copy(obj, seen)
    -- Handle non-tables and previously-seen tables.
    if type(obj) ~= 'table' then return obj end
    if seen and seen[obj] then return seen[obj] end

    -- New table; mark it as seen and copy recursively.
    local s = seen or {}
    local res = {}
    s[obj] = res
    for k, v in pairs(obj) do res[deep_copy(k, s)] = deep_copy(v, s) end
    return setmetatable(res, getmetatable(obj))
end

-- end util functions

local locale = require('locale')

local function localise(obj, typeArg)
    local function localiseTemplate(t)
        local template = locale[t[1]]
        local args = t[2]
        if type(args) == "string" then
            template = template:gsub('__1__', args)
        elseif args ~= nil then
            for i = 1, #args do
                template = template:gsub('__' .. i .. '__', locale[args[i]] or '')
            end
        end
        return template
    end

    if obj.localised_name ~= nil then
        obj.localised_name = localiseTemplate(obj.localised_name)
    else
        local str = locale[typeArg .. '-name.' .. obj.name]
        if str ~= nil then
            obj.localised_name = str
        else
            obj.localised_name = obj.name:gsub('^%l', string.upper):gsub('-', ' ')
        end
    end

    if obj.localised_description ~= nil then
        obj.localised_description = localiseTemplate(obj.localised_description)
    else
        local str = locale[typeArg .. '-description.' .. obj.name]
        if str ~= nil then
            obj.localised_description = str
        end
    end

    if obj.limitation_message_key ~= nil then
        local str = locale[typeArg .. '-limitation.' .. obj.limitation_message_key]
        if str ~= nil then
            obj.limitation_message = str
        end
        obj.limitation_message_key = nil
    end
end

local creativeEntities = {
    'loader',
    'fast-loader',
    'express-loader',
    'infinity-chest',
    'heat-interface',
    'infinity-pipe',
    'electric-energy-interface'
}

local output = {}

-- ITEMS
do
    local items = {}

    local itemPrototypes = {
        'item',
        'ammo',
        'capsule',
        'gun',
        'item-with-entity-data',
        'item-with-label',
        'item-with-inventory',
        'blueprint-book',
        'item-with-tags',
        'selection-tool',
        'blueprint',
        'copy-paste-tool',
        'deconstruction-item',
        'spidertron-remote',
        'upgrade-item',
        'module',
        'rail-planner',
        'space-platform-starter-pack',
        'tool',
        'armor',
        'repair-tool',
    }

    local getOrder = char_generator()

    for proto in list_iter(itemPrototypes) do
        if data.raw[proto] then
            for _, item in pairs(deep_copy(data.raw[proto])) do
                if list_includes(creativeEntities, item.name) then
                    item.subgroup = 'creative'
                    item.order = getOrder()
                end

                localise(item, 'item')
                items[item.name] = item
            end
        end
    end

    output.items = items
end

-- FLUIDS
do
    local fluids = {}

    for _, fluid in pairs(deep_copy(data.raw.fluid)) do
        localise(fluid, 'fluid')
        fluids[fluid.name] = fluid
    end

    output.fluids = fluids
end

-- SIGNALS
do
    local signals = {}

    for _, signal in pairs(deep_copy(data.raw['virtual-signal'])) do
        localise(signal, 'virtual-signal')
        signals[signal.name] = signal
    end

    output.signals = signals
end

-- RECIPES
do
    local recipes = {}

    for _, recipe in pairs(deep_copy(data.raw.recipe)) do
        if not list_includes(creativeEntities, recipe.name) then
            localise(recipe, 'recipe')
            recipes[recipe.name] = recipe
        end
    end

    output.recipes = recipes
end

--ENTITIES
do
    local entities = {}

    local placeableEntityPrototypes = {
        'accumulator',
        'agricultural-tower',
        'artillery-turret',
        'asteroid-collector',
        -- 'asteroid',
        'beacon',
        'boiler',
        'burner-generator',
        'cargo-bay',
        'cargo-landing-pad',
        -- 'cargo-pod',
        -- 'character',
        'arithmetic-combinator',
        'decider-combinator',
        'selector-combinator',
        'constant-combinator',
        'container',
        'logistic-container',
        'infinity-container',
        'temporary-container',
        'assembling-machine',
        'rocket-silo',
        'furnace',
        'display-panel',
        'electric-energy-interface',
        'electric-pole',
        -- 'unit-spawner',
        -- 'capture-robot',
        -- 'combat-robot',
        -- 'construction-robot',
        -- 'logistic-robot',
        'fusion-generator',
        'fusion-reactor',
        'gate',
        'generator',
        'heat-interface',
        'heat-pipe',
        'inserter',
        'lab',
        'lamp',
        'land-mine',
        'lightning-attractor',
        'linked-container',
        'market',
        'mining-drill',
        'offshore-pump',
        'pipe',
        'infinity-pipe',
        'pipe-to-ground',
        -- 'player-port',
        'power-switch',
        'programmable-speaker',
        'proxy-container',
        'pump',
        'radar',
        'curved-rail-a',
        'elevated-curved-rail-a',
        'curved-rail-b',
        'elevated-curved-rail-b',
        'half-diagonal-rail',
        'elevated-half-diagonal-rail',
        'legacy-curved-rail',
        'legacy-straight-rail',
        'rail-ramp',
        'straight-rail',
        'elevated-straight-rail',
        'rail-chain-signal',
        'rail-signal',
        'rail-support',
        'reactor',
        'roboport',
        -- 'segment',
        -- 'segmented-unit',
        'simple-entity-with-owner',
        'simple-entity-with-force',
        'solar-panel',
        'space-platform-hub',
        -- 'spider-leg',
        -- 'spider-unit',
        'storage-tank',
        'thruster',
        'train-stop',
        'lane-splitter',
        'linked-belt',
        'loader-1x1',
        'loader',
        'splitter',
        'transport-belt',
        'underground-belt',
        'turret',
        'ammo-turret',
        'electric-turret',
        'fluid-turret',
        -- 'unit',
        'valve',
        -- 'car',
        'artillery-wagon',
        'cargo-wagon',
        'infinity-cargo-wagon',
        'fluid-wagon',
        'locomotive',
        -- 'spider-vehicle',
        'wall'
    }

    for proto in list_iter(placeableEntityPrototypes) do
        if data.raw[proto] then
            for _, entity in pairs(deep_copy(data.raw[proto])) do
                if not list_includes(entity.flags or {}, 'not-blueprintable') and
                    not list_includes(entity.flags or {}, 'breaths-air')
                then
                    localise(entity, 'entity')
                    entities[entity.name] = entity
                end
            end
        end
    end

    output.entities = entities
end

-- TILES
do
    local tiles = {}

    for _, tile in pairs(deep_copy(data.raw.tile)) do
        if tile.minable then
            localise(tile, 'tile')
            tiles[tile.name] = tile
        end
    end

    output.tiles = tiles
end

-- SPACE LOCATIONS AND QUALITIES
-- Only what is needed to draw their icons (#652). A blueprint's own icon, or a
-- book's, can be a planet or a quality, and `[planet=...]` / `[quality=...]`
-- rich text names the same prototypes. The starmap art, map generation and
-- every gameplay multiplier are left out on purpose: none of it is drawn.
do
    local iconFields = {
        'type',
        'name',
        'icon',
        'icon_size',
        'icons',
        'order',
        'subgroup',
        'hidden',
        'localised_name'
    }

    -- The engine's own placeholders for a name it cannot resolve. They draw
    -- the "unknown" icon, which nothing in a blueprint asks for.
    local placeholders = {
        'space-location-unknown',
        'quality-unknown'
    }

    local function pick(proto, typeArg)
        local copy = deep_copy(proto)
        localise(copy, typeArg)
        local picked = {}
        for _, field in pairs(iconFields) do
            picked[field] = copy[field]
        end
        return picked
    end

    -- A signal of type `space-location` names either a planet or a plain
    -- space location, so both go in one table, told apart by `type`.
    local spaceLocations = {}
    for _, protoType in pairs({ 'planet', 'space-location' }) do
        for _, proto in pairs(data.raw[protoType] or {}) do
            if not list_includes(placeholders, proto.name) then
                spaceLocations[proto.name] = pick(proto, 'space-location')
            end
        end
    end
    output.spaceLocations = spaceLocations

    local qualities = {}
    for _, proto in pairs(data.raw.quality or {}) do
        if not list_includes(placeholders, proto.name) then
            qualities[proto.name] = pick(proto, 'quality')
        end
    end
    output.qualities = qualities
end

-- INVENTORY LAYOUT
do
    local inventoryLayout = {}

    local groupBlacklist = {
        'environment',
        'enemies',
        'effects',
        'tiles',
        'other'
    }

    local function comp_func(a, b)
        return a.order < b.order
    end

    local subgroups = {
        creative = {
            name = 'creative',
            group = 'creative',
            order = 'z',
            items = {}
        }
    }

    for _, subgroup in pairs(deep_copy(data.raw['item-subgroup'])) do
        subgroups[subgroup.name] = {
            name = subgroup.name,
            group = subgroup.group,
            order = subgroup.order,
            items = {}
        }
    end

    local function addEntriesToSubroups(t, defaultSubgroup)
        for _, entry in pairs(t) do
            local subgroup = entry.subgroup or defaultSubgroup
            if subgroup ~= nil and entry.order ~= nil and subgroups[subgroup] ~= nil then
                -- some fluid recipes are missing their icon and order
                -- local fluid = data.raw.fluid[entry.name] or {}
                table.insert(subgroups[subgroup].items, {
                    name = entry.name,
                    icon = entry.icon, -- or fluid.icon,
                    icons = entry.icons,
                    icon_size = entry.icon_size,
                    order = entry.order -- or fluid.order
                })
            end
        end
    end

    addEntriesToSubroups(output.items)
    addEntriesToSubroups(deep_copy(data.raw.recipe))
    addEntriesToSubroups(deep_copy(data.raw.fluid), 'fluid')
    addEntriesToSubroups(deep_copy(data.raw['virtual-signal']))

    local infinityChest = output.items['infinity-chest']
    local groups = {
        creative = {
            name = 'creative',
            icon = infinityChest.icon,
            icons = infinityChest.icons,
            icon_size = infinityChest.icon_size,
            order = 'z',
            subgroups = {}
        }
    }

    for _, group in pairs(deep_copy(data.raw['item-group'])) do
        if not list_includes(groupBlacklist, group.name) then
            groups[group.name] = {
                name = group.name,
                icon = group.icon,
                icons = group.icons,
                icon_size = group.icon_size,
                order = group.order,
                subgroups = {}
            }
        end
    end

    for _, subgroup in pairs(subgroups) do
        if groups[subgroup.group] ~= nil and #subgroup.items ~= 0 then
            table.sort(subgroup.items, comp_func)
            table.insert(groups[subgroup.group].subgroups, subgroup)
        end
    end

    for _, group in pairs(groups) do
        localise(group, 'item-group')
        table.sort(group.subgroups, comp_func)
        table.insert(inventoryLayout, group)
    end

    table.sort(inventoryLayout, comp_func)

    output.inventoryLayout = inventoryLayout
end

-- UTILITY SPRITES
do
    output.utilitySprites = data.raw['utility-sprites'].default
end

-- UTILITY CONSTANTS
do
    output.utilityConstants = data.raw['utility-constants'].default
end

-- GUI STYLE
do
    output.guiStyle = data.raw['gui-style'].default
end

-- DEFINES
do
    output.defines = defines
end

-- PASSTROUGH OUTPUT DATA
do
    local serialized = serpent.dump(output)

    -- workaround Factorio's limitation of 200 characters per string
    -- by splitting the serialized data into chunks and embedding it
    -- into dummy entities

    local function embed_data(key, value)
        data:extend({ {
            type = "simple-entity",
            name = key,
            icon = "-",
            icon_size = 1,
            picture = {
                filename = "-",
                width = 1,
                height = 1
            },
            localised_name = value
        } })
    end

    local l = string.len(serialized)
    local total_parts = 0
    for i = 1, l, 200 do
        total_parts = total_parts + 1
        embed_data('FBE-DATA-' .. tostring(total_parts), string.sub(serialized, i, i + 199))
    end

    embed_data('FBE-DATA-COUNT', tostring(total_parts))
end
