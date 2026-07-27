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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`
const src = readFileSync(process.argv[2] ?? '/tmp/fbe-migrated-output.txt', 'utf8').trim()

const MOD = 'bp_editor_output'
const DUMP = 'editor-output-dump.json'
const work = mkdtempSync(join(tmpdir(), 'fbe-oracle-'))
const writeData = join(work, 'write-data')
const modPath = join(work, 'mods', `${MOD}_0.0.1`)
mkdirSync(writeData, { recursive: true })
mkdirSync(modPath, { recursive: true })

writeFileSync(
    join(modPath, 'info.json'),
    JSON.stringify({
        name: MOD,
        version: '0.0.1',
        title: 'Editor output probe',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)
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
        join(work, 'mods'),
        '--config',
        join(work, 'config.ini'),
    ],
    { encoding: 'utf8' }
)
const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error('No dump. tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-2500))
    process.exit(1)
}
console.log(readFileSync(dumpPath, 'utf8'))
