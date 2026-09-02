/*
    Issue #91: does Factorio import a LogisticSection whose `index` is 0?

    Until #89 both pre-2.0 shape migrations in Blueprint.ts built their section
    with `index: 0`, where every section Factorio itself writes is numbered from
    1. Every reader in this editor is positional - `sections[0]` is the first
    array element, not the section whose index is 0 - so a 0 round-tripped here
    perfectly and could only ever be wrong in the game. This asks the game.

    Method is the sibling project's (FactorioMapWebUI/test/oracle): write a
    throwaway mod, run the real binary headless against an isolated config so it
    never touches the real install, have the mod dump JSON and `error()` out.
    The subsystem differs - this imports a blueprint string with
    `LuaItemStack.import_stack` and reads `get_blueprint_entities()` back, which
    is exactly the path a user takes pasting a string into the game.

    Usage: node tools/oracle/probe-section-index.mjs
*/
import { deflateSync } from 'node:zlib'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BIN = factorioBin

if (!existsSync(BIN)) {
    console.error(`No Factorio binary at ${BIN}. Set FACTORIO_BIN.`)
    process.exit(1)
}

const MOD = 'bp_section_probe'
const DUMP = 'section-index-dump.json'

/** How Factorio packs a version. 2.0.73, matching what this editor's corpus declares. */
const version = (main, major, minor, dev = 0) =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16 + dev

const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`

/* A logistic section and a combinator section, each at index 0 and again at
   index 1 as the control. If the game tolerates 0 the two halves come back
   alike; if it renumbers, the 0s come back as something else; if it drops the
   section, the 0 halves come back without one. */
const filter = { index: 1, name: 'iron-plate', quality: 'normal', comparator: '=', count: 7 }

const BP = encode({
    item: 'blueprint',
    version: version(2, 0, 73),
    icons: [{ index: 1, signal: { type: 'item', name: 'storage-chest' } }],
    entities: [
        {
            entity_number: 1,
            name: 'storage-chest',
            position: { x: 0.5, y: 0.5 },
            request_filters: { sections: [{ index: 0, filters: [filter] }] },
        },
        {
            entity_number: 2,
            name: 'storage-chest',
            position: { x: 2.5, y: 0.5 },
            request_filters: { sections: [{ index: 1, filters: [filter] }] },
        },
        {
            entity_number: 3,
            name: 'constant-combinator',
            position: { x: 4.5, y: 0.5 },
            control_behavior: {
                sections: { sections: [{ index: 0, filters: [{ ...filter, type: 'item' }] }] },
            },
        },
        {
            entity_number: 4,
            name: 'constant-combinator',
            position: { x: 6.5, y: 0.5 },
            control_behavior: {
                sections: { sections: [{ index: 1, filters: [{ ...filter, type: 'item' }] }] },
            },
        },
    ],
})

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Blueprint section index probe',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})

/* The blueprint string is embedded in a Lua long bracket so its base64 (which
   can contain + and /) survives verbatim. import_stack returns 0 on a clean
   import, 1 when it imported with errors, -1 when it failed outright - worth
   recording, since "dropped the section" and "refused the string" are
   different answers. */
writeFileSync(
    join(modPath, 'control.lua'),
    `script.on_init(function()
  local bp = [==[${BP}]==]
  local inv = game.create_inventory(1)
  inv[1].set_stack{name = "blueprint"}
  local code = inv[1].import_stack(bp)
  local out = {
    import_code = code,
    entities = inv[1].get_blueprint_entities(),
  }
  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
console.log(JSON.stringify({ binary: BIN, work, dump }, null, 2))
