/*
    Issue #91, isolated. The first probe put all four cases in one blueprint,
    which showed the index-0 entities missing but could not attribute the single
    `import_stack` return code to any one of them. This imports one blueprint
    per case so every code and entity count stands alone.

    Usage: node tools/oracle/probe-section-index-cases.mjs
*/
import { deflateSync } from 'node:zlib'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = factorioBin

const MOD = 'bp_section_cases'
const DUMP = 'section-cases-dump.json'
const version = (a, b, c, d = 0) => a * 2 ** 48 + b * 2 ** 32 + c * 2 ** 16 + d
const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`

const F = { index: 1, name: 'iron-plate', quality: 'normal', comparator: '=', count: 7 }

const chest = section => ({
    item: 'blueprint',
    version: version(2, 0, 73),
    icons: [{ index: 1, signal: { type: 'item', name: 'storage-chest' } }],
    entities: [
        {
            entity_number: 1,
            name: 'storage-chest',
            position: { x: 0.5, y: 0.5 },
            request_filters: { sections: [section] },
        },
    ],
})
const combinator = section => ({
    item: 'blueprint',
    version: version(2, 0, 73),
    icons: [{ index: 1, signal: { type: 'item', name: 'constant-combinator' } }],
    entities: [
        {
            entity_number: 1,
            name: 'constant-combinator',
            position: { x: 0.5, y: 0.5 },
            control_behavior: { sections: { sections: [section] } },
        },
    ],
})

const CASES = {
    'chest section index 0, with filters': chest({ index: 0, filters: [F] }),
    'chest section index 1, with filters (control)': chest({ index: 1, filters: [F] }),
    'chest section index 2, with filters': chest({ index: 2, filters: [F] }),
    'chest section index 0, no filters': chest({ index: 0 }),
    'chest section index 1, no filters (control)': chest({ index: 1 }),
    'combinator section index 0, with filters': combinator({
        index: 0,
        filters: [{ ...F, type: 'item' }],
    }),
    'combinator section index 1, with filters (control)': combinator({
        index: 1,
        filters: [{ ...F, type: 'item' }],
    }),
}

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Blueprint section index cases',
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
    out[#out + 1] = {
      label = c.label,
      import_code = code,
      entity_count = ents and #ents or 0,
      entities = ents,
    }
  end
  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

for (const r of JSON.parse(readFileSync(dumpPath, 'utf8'))) {
    const sec =
        r.entities?.[0]?.request_filters?.sections?.[0] ??
        r.entities?.[0]?.control_behavior?.sections?.sections?.[0]
    console.log(
        `${String(r.import_code).padStart(2)}  entities=${r.entity_count}  ` +
            `section=${sec ? `index ${sec.index}, filters ${sec.filters ? sec.filters.length : 0}` : 'none'}` +
            `   ${r.label}`
    )
}
