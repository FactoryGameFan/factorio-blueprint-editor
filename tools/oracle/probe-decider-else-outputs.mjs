/*
    What a decider combinator's `else_outputs` looks like in a blueprint string,
    and whether the game accepts one it did not write itself.

    Factorio 2.1.9 added "Decider combinator supports else-output" (changelog,
    30. 06. 2026). The editor's `blueprintSchema.json` was written against 2.0
    and sets `additionalProperties: false` on `decider_conditions`, so every 2.1
    blueprint holding a decider now fails validation on that one key.

    The runtime API says `else_outputs` is an array of `DeciderCombinatorOutput`,
    the same element type as `outputs`. That is the *Lua* concept, though, not
    the blueprint serialisation, and the two are allowed to differ - so this asks
    the game to export the string and reads the JSON back out.

    Four questions, each its own decider so an answer is attributable:

      no-else      Is the key written at all when the else branch is empty?
      one-else     What does a single else-output serialise as?
      else-copy    Does a copying else-output carry `networks` the way an
                   ordinary output does?
      two-else     Does a second entry appear in order?

    Plus one control that runs the other direction: hand the game a string this
    editor could have written - `else_outputs` present, everything else the
    same - and read `import_stack`'s code back. A non-zero code would mean the
    field is export-only and we must not re-emit it.
*/
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { inflateSync, deflateSync } from 'node:zlib'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const MOD = 'decider_else_outputs'
const DUMP = 'decider-else-outputs-dump.json'

const decodeBp = str =>
    JSON.parse(inflateSync(Buffer.from(str.slice(1), 'base64')).toString('utf8'))
const encodeBp = obj =>
    `0${deflateSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64')}`

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Decider else-output probe',
    author: 'oracle',
    // Derived rather than hardcoded: a mismatch against the binary's
    // major.minor makes the mod silently skipped and the run ends on "No dump".
    factorio_version: (() => {
        const out = spawnSync(factorioBin, ['--version'], { encoding: 'utf8' }).stdout ?? ''
        const m = /Version:\s*(\d+)\.(\d+)/.exec(out)
        if (!m) throw new Error(`could not read a version out of: ${out.slice(0, 200)}`)
        return `${m[1]}.${m[2]}`
    })(),
    dependencies: ['base'],
})

/*
    The control's input: a string this editor could have written - `else_outputs`
    present, everything else the same. Built here rather than captured from a
    case above, so it is our shape being tested and not the game's own output
    handed back to it.
*/
const REIMPORT = encodeBp({
    blueprint: {
        item: 'blueprint',
        version: 562954249175042,
        entities: [
            {
                entity_number: 1,
                name: 'decider-combinator',
                position: { x: 0.5, y: 0 },
                control_behavior: {
                    decider_conditions: {
                        conditions: [
                            {
                                first_signal: { type: 'virtual', name: 'signal-E' },
                                constant: 5,
                                comparator: '>',
                            },
                        ],
                        outputs: [
                            {
                                signal: { type: 'virtual', name: 'signal-check' },
                                copy_count_from_input: false,
                            },
                        ],
                        else_outputs: [
                            {
                                signal: { type: 'virtual', name: 'signal-red' },
                                copy_count_from_input: false,
                                constant: 7,
                            },
                        ],
                    },
                },
            },
        ],
    },
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {cases = {}, errors = {}}

local function try(label, fn)
  local ok, err = pcall(fn)
  if not ok then out.errors[#out.errors + 1] = label .. ": " .. tostring(err) end
end

local CASES = {
  {
    label = "no-else",
    params = {
      conditions = {{first_signal = {type = "virtual", name = "signal-A"}, constant = 5, comparator = ">"}},
      outputs = {{signal = {type = "virtual", name = "signal-check"}, copy_count_from_input = false}},
      else_outputs = {},
    },
  },
  {
    label = "one-else",
    params = {
      conditions = {{first_signal = {type = "virtual", name = "signal-B"}, constant = 5, comparator = ">"}},
      outputs = {{signal = {type = "virtual", name = "signal-check"}, copy_count_from_input = false}},
      else_outputs = {{signal = {type = "virtual", name = "signal-red"}, copy_count_from_input = false, constant = 7}},
    },
  },
  {
    label = "else-copy",
    params = {
      conditions = {{first_signal = {type = "virtual", name = "signal-C"}, constant = 5, comparator = ">"}},
      outputs = {{signal = {type = "virtual", name = "signal-check"}, copy_count_from_input = false}},
      else_outputs = {{signal = {type = "item", name = "iron-plate"}, copy_count_from_input = true, networks = {red = true, green = false}}},
    },
  },
  {
    label = "two-else",
    params = {
      conditions = {{first_signal = {type = "virtual", name = "signal-D"}, constant = 5, comparator = ">"}},
      outputs = {{signal = {type = "virtual", name = "signal-check"}, copy_count_from_input = false}},
      else_outputs = {
        {signal = {type = "virtual", name = "signal-green"}, copy_count_from_input = false, constant = 1},
        {signal = {type = "fluid", name = "water"}, copy_count_from_input = false, constant = 2},
      },
    },
  },
}

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 3)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -10, 40 do
    for y = -10, 10 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-10, -10}, {40, 10}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  local inv = game.create_inventory(1)

  for i, c in ipairs(CASES) do
    local x = (i - 1) * 8
    local rec = {label = c.label}
    try(c.label, function()
      local e = surface.create_entity{name = "decider-combinator", position = {x + 0.5, 0}, force = force}
      if not e then error("create_entity returned nil") end
      e.get_or_create_control_behavior().parameters = c.params
      rec.read_back = e.get_control_behavior().parameters
      inv[1].set_stack{name = "blueprint"}
      inv[1].create_blueprint{surface = surface, force = force, area = {{x - 2, -3}, {x + 3, 3}}}
      rec.entities = inv[1].get_blueprint_entities()
      rec.exported = inv[1].export_stack()
      e.destroy()
    end)
    out.cases[#out.cases + 1] = rec
  end

  -- Control, the other direction: a string the editor could have written.
  try("reimport", function()
    inv[1].set_stack{name = "blueprint"}
    out.reimport_code = inv[1].import_stack([==[${REIMPORT}]==])
    out.reimport_entities = inv[1].get_blueprint_entities()
  end)

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { text } = runProbe({ bin: factorioBin, work, writeData, modDir, dump: DUMP })
const dump = JSON.parse(text)

if (dump.errors?.length) console.log('ERRORS:', dump.errors)

for (const c of dump.cases) {
    const bp = c.exported ? decodeBp(c.exported) : undefined
    const dc = bp?.blueprint?.entities?.[0]?.control_behavior?.decider_conditions
    console.log(`\n=== ${c.label} ===`)
    console.log('  exported decider_conditions:', JSON.stringify(dc))
    console.log('  else_outputs key present in string:', dc ? 'else_outputs' in dc : 'no entity')
}

console.log('\n=== reimport control ===')
console.log('  import_stack code:', dump.reimport_code, '(0 = accepted)')
console.log('  entities read back:', JSON.stringify(dump.reimport_entities))
