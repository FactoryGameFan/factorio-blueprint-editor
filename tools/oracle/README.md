# Factorio oracle

Asks the real game what it does, so a behaviour this editor reimplements can be
checked against Factorio rather than against our own assumptions.

Method borrowed from the sibling project at
`/Users/ericjohnson/GitHub/FactorioMapWebUI/test/oracle/`, which uses it for the
map generator's noise functions. The subsystem differs - that one routes a
`noise-expression` and samples tile properties, this one imports a blueprint
string with `LuaItemStack.import_stack` and reads `get_blueprint_entities()` back

- but the shape is the same: write a throwaway mod, run the binary headless
  against an isolated config so it never touches the real install, have the mod
  dump JSON and `error()` out.

## Order of attack

This is the part that saves time, and it is not "open a disassembler":

1. **`factorio-data` first.** Most behaviour is Lua shipped in the clear at
   github.com/wube/factorio-data, one git tag per release. Grep for the
   **definition site** (`name *= *"<thing>"`), not a bare name, which matches
   every caller. Check out the tag matching what you target - this editor's
   corpus is 2.0.45 to 2.0.73, not 2.1.
2. **Then the oracle** - this directory. Use it for anything the Lua does not
   answer because it is engine behaviour: import rules, validation, numeric
   primitives.
3. **Only then the binary**, which ships unstripped, for the short list of
   genuinely compiled things. Nothing here has needed it yet.

## Scripts

| Script                          | What it asks                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `probe-section-index.mjs`       | First pass at #91, all cases in one blueprint                                 |
| `probe-section-index-cases.mjs` | The same, one blueprint per case so each import code is attributable          |
| `probe-editor-output.mjs`       | Imports a string from a file - used to feed the game this editor's own output |

```sh
node tools/oracle/probe-section-index-cases.mjs
node tools/oracle/probe-editor-output.mjs /tmp/some-blueprint.txt
```

Needs a local Factorio. Found via `FACTORIO_BIN`, else the macOS Steam default.
Nothing in `tests/` depends on these - the committed fixtures do the asserting,
so CI stays offline.

## Gotchas, each of which cost a run

- **`helpers.write_file` / `helpers.table_to_json`**, not `game.*`. They moved in
  2.1 and the old names are gone.
- **`factorio_version` must be `"2.1"`** in the mod's `info.json` for a 2.1.x
  game, or the mod is silently skipped and no dump appears.
- **Embed the blueprint string in a Lua long bracket** (`[==[ ... ]==]`) so its
  base64 survives verbatim.
- **`error("DUMPED-OK")` makes Factorio exit non-zero.** That is success. Key off
  the dump file existing, never the exit code.
- **Blueprint import needs no `--map-gen-settings`.** The sibling's noise oracle
  does; this one does not, since nothing is being generated.
- **One case per blueprint string.** The first probe put four cases in one
  string and got a single `import_stack` code of -1 for the lot, which could not
  be attributed - and worse, entities _did_ come back, so -1 looked like it might
  mean something other than what it does. Splitting them made the answer obvious.

## Fixture policy

Capture once, commit the JSON with its provenance, assert offline. Copied from
the sibling repo, and the reasons are theirs:

- **Never hand-edit a fixture to make a test pass.** A mismatch is a finding.
- **Version-stamp every capture.** Steam updates the binary without asking.

`fixtures/section-index.json` records what was asked, what came back, the exact
binary it came from, and - importantly - that the only Factorio on this machine
is **2.1.12 while this editor targets 2.0.45 to 2.0.73**. The behaviour is
assumed stable across that range and was not measured on a 2.0.x binary.
`factorio.com/download/archive/` has every release if that ever needs settling.

## Scope

Behavioural reverse-engineering for interoperability - understanding what the
game computes so this editor can agree with it. Not extracting or redistributing
game code or assets. Keep it that way.
