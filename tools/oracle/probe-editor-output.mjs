/*
    The end-to-end check for #91: does the real game accept a blueprint string
    this editor produced from a pre-2.0 blueprint?

    The per-case probe proved `index: 0` fails to import and `index: 1` does not.
    That is a fact about Factorio, not about us. This closes the loop against
    something outside our own test suite: take the editor's actual output for a
    blueprint whose migrations ran, hand it to the game, and read back what
    arrives.

    Reads the string from a file so the editor half stays in Playwright.
    Usage: node tools/oracle/probe-editor-output.mjs <file>
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join } from 'node:path'

const BIN = factorioBin
const src = readFileSync(process.argv[2] ?? '/tmp/fbe-migrated-output.txt', 'utf8').trim()

const MOD = 'bp_editor_output'
const DUMP = 'editor-output-dump.json'
const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Editor output probe',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})
writeFileSync(
    join(modPath, 'control.lua'),
    `script.on_init(function()
  local inv = game.create_inventory(1)
  inv[1].set_stack{name = "blueprint"}
  local code = inv[1].import_stack([==[${src}]==])
  helpers.write_file("${DUMP}", helpers.table_to_json({
    import_code = code,
    entities = inv[1].get_blueprint_entities(),
  }))
  error("DUMPED-OK")
end)
`
)
const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })
console.log(readFileSync(dumpPath, 'utf8'))
