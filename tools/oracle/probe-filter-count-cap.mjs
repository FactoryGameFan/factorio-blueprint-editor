/*
    Is `utility_constants.max_logistic_filter_count` (1000) a cap per entity or
    per section? The name does not say, and the editor models section 0 only, so
    the two readings give different answers for what `pasteSettings` may carry.

    Asked because #93 is about the editor guessing 30 filter slots for requester
    and buffer chests with nothing behind the number. Replacing one guess with
    another would not be an improvement.

    Two controls come first. A three-filter chest establishes the shape imports
    cleanly at all, and a chest holding the SAME item at three indices says
    whether cycling a short item list to reach 1000 is even measuring what it
    claims to - if the game collapses duplicates, every large case below is
    reporting dedupe rather than a cap.

    Usage: node tools/oracle/probe-filter-count-cap.mjs
*/
import { deflateSync } from 'node:zlib'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = factorioBin

const MOD = 'bp_filter_cap'
const DUMP = 'filter-cap-dump.json'
const version = (a, b, c, d = 0) => a * 2 ** 48 + b * 2 ** 32 + c * 2 ** 16 + d
const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`

/*
    Base-game items only. The mod directory is isolated and depends on `base`
    alone, so a Space Age name would fail for the wrong reason - it would look
    like a rejected filter count rather than an unknown item.
*/
const ITEMS = [
    'iron-plate',
    'copper-plate',
    'steel-plate',
    'iron-gear-wheel',
    'copper-cable',
    'electronic-circuit',
    'advanced-circuit',
    'processing-unit',
    'coal',
    'stone',
    'iron-ore',
    'copper-ore',
    'stone-brick',
    'concrete',
    'pipe',
    'pipe-to-ground',
    'transport-belt',
    'fast-transport-belt',
    'express-transport-belt',
    'underground-belt',
    'splitter',
    'inserter',
    'fast-inserter',
    'long-handed-inserter',
    'bulk-inserter',
    'burner-inserter',
    'small-electric-pole',
    'medium-electric-pole',
    'big-electric-pole',
    'substation',
    'assembling-machine-1',
    'assembling-machine-2',
    'assembling-machine-3',
    'electric-furnace',
    'steel-furnace',
    'stone-furnace',
    'radar',
    'accumulator',
    'solar-panel',
    'battery',
    'plastic-bar',
    'sulfur',
    'explosives',
    'rocket-fuel',
    'low-density-structure',
    'engine-unit',
    'electric-engine-unit',
    'firearm-magazine',
    'piercing-rounds-magazine',
    'grenade',
]

const filter = (index, name) => ({ index, name, quality: 'normal', comparator: '=', count: 1 })
/** n filters numbered from 1, cycling ITEMS. */
const filters = n => Array.from({ length: n }, (_, i) => filter(i + 1, ITEMS[i % ITEMS.length]))

/** A requester chest carrying the given sections, numbered from 1 (see #91). */
const chest = sections => ({
    item: 'blueprint',
    version: version(2, 0, 73),
    icons: [{ index: 1, signal: { type: 'item', name: 'requester-chest' } }],
    entities: [
        {
            entity_number: 1,
            name: 'requester-chest',
            position: { x: 0.5, y: 0.5 },
            request_filters: {
                sections: sections.map((f, i) => ({ index: i + 1, filters: f })),
            },
        },
    ],
})

const CASES = {
    'control: 3 distinct items, 1 section': chest([filters(3)]),
    'control: same item at 3 indices, 1 section': chest([
        [filter(1, 'iron-plate'), filter(2, 'iron-plate'), filter(3, 'iron-plate')],
    ]),
    '30 filters, 1 section (what the editor draws today)': chest([filters(30)]),
    '999 filters, 1 section': chest([filters(999)]),
    '1000 filters, 1 section (max_logistic_filter_count)': chest([filters(1000)]),
    '1001 filters, 1 section': chest([filters(1001)]),
    '2 sections x 600 = 1200 filters': chest([filters(600), filters(600)]),
    '2 sections x 1000 = 2000 filters': chest([filters(1000), filters(1000)]),
}

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Logistic filter count cap',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})

const luaCases = Object.entries(CASES)
    .map(([label, bp]) => `  {label = [==[${label}]==], bp = [==[${encode(bp)}]==]},`)
    .join('\n')

writeFileSync(
    join(modPath, 'control.lua'),
    `script.on_init(function()
  local cases = {
${luaCases}
  }
  local inv = game.create_inventory(1)
  local out = {}
  for _, c in ipairs(cases) do
    inv[1].set_stack{name = "blueprint"}
    local code = inv[1].import_stack(c.bp)
    local ents = inv[1].get_blueprint_entities()
    local counts = {}
    local names = {}
    if ents and ents[1] and ents[1].request_filters and ents[1].request_filters.sections then
      for i, s in ipairs(ents[1].request_filters.sections) do
        counts[i] = s.filters and #s.filters or 0
        -- highest index actually present, to catch a silent renumber
        local hi = 0
        if s.filters then
          for _, f in pairs(s.filters) do if f.index and f.index > hi then hi = f.index end end
        end
        names[i] = hi
      end
    end
    out[#out + 1] = {
      label = c.label,
      import_code = code,
      entity_count = ents and #ents or 0,
      section_filter_counts = counts,
      section_highest_index = names,
    }
  end
  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

const rows = JSON.parse(readFileSync(dumpPath, 'utf8'))
for (const r of rows) {
    const counts = Object.values(r.section_filter_counts ?? {})
    const hi = Object.values(r.section_highest_index ?? {})
    console.log(
        `code=${String(r.import_code).padStart(2)}  entities=${r.entity_count}  ` +
            `sections=[${counts.join(', ')}]  highestIndex=[${hi.join(', ')}]   ${r.label}`
    )
}
writeFileSync(join(work, 'rows.json'), JSON.stringify(rows, null, 2))
console.log(`\nraw: ${join(work, 'rows.json')}`)
