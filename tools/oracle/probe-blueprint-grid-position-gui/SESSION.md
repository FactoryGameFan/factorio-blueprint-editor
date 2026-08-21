# Grid position session - follow along

Keep this open while you play. Reference and reasoning are in `README.md`;
this is just the steps.

Roughly 15 minutes. Nothing is lost if you quit early - every capture is
appended the moment you run it.

---

## 1. Start it

```fish
cargo run --quiet --manifest-path ~/GitHub/factorio-oracle/Cargo.toml -- run --probe ~/GitHub/factorio-blueprint-editor/tools/oracle/probe-blueprint-grid-position-gui/probe.json --work-dir /tmp/gridpos --factorio ~/GitHub/factorio-oracle/installs/factorio-2.0.77.app --version 2.0.77 >/tmp/gridpos-run.json
```

The game opens. There is no timeout - it lasts as long as you play.

**Before going further, confirm the mod actually loaded.** A `factorio_version`
mismatch skips it in silence and you would play a whole session capturing
nothing. You should see this in the chat log:

```
[grid-probe] Layout built, blueprint in your inventory, controls captured.
```

If you do not see it, quit and say so - do not carry on.

Press `~` for the console.

---

## 2. The steps

Do the thing, close the GUI, then type the command. Order matters.

- [ ] **Baseline.** Change nothing.

      /gp-cap untouched

- [ ] **Snap on.** Open the blueprint GUI. Tick **Snap to grid**. Close.

      /gp-cap snap-on

- [ ] **Grid position 3, 5.** Set **Grid position** X=3 Y=5. Close.

      /gp-cap gridpos-3-5

- [ ] **Grid position 8, 9.** Set **Grid position** X=8 Y=9. Close.

      /gp-cap gridpos-8-9

      This is the one that matters most. Setting a second value on top of the
      first is the only thing that tells an absolute target from a relative
      nudge. Do not skip it.

- [ ] **Grid position 0, 0.** Set **Grid position** back to X=0 Y=0. Close.

      /gp-cap gridpos-0-0

- [ ] **Absolute 2, 6.** Pick **Absolute**. Set its **own** X=2 Y=6 - the pair
      on the Absolute row, not the Grid position pair above it. Close.

      /gp-cap abs-2-6

- [ ] **Snap off.** Untick **Snap to grid**. Close.

      /gp-cap snap-off

- [ ] Quit the game.

---

## 3. Read the result

```fish
node ~/GitHub/factorio-blueprint-editor/tools/oracle/analyze-blueprint-grid-position-gui.mjs --run /tmp/gridpos-run.json --write-fixture
```

Exits non-zero if a control failed, in which case the numbers are void rather
than a finding.

`survivingReadings` is the answer. It lists the rules that match **every**
scored row.

| Result | Means |
| --- | --- |
| `["entityCentresAndTiles"]` | PR #243's formula is right as shipped |
| `["entityEdgesAndTiles"]` | right shape, wrong corner - it reads edges, not centres |
| `["entityCentresOnly"]` or `["entityEdgesOnly"]` | tiles do not count towards the corner |
| `[]` | all four candidates are wrong, and the real rule is not written down yet |
| `unmeasured ...` | no scored step was captured - check step 1 |

---

## Two things to watch for

**Note anything surprising with `/gp-note <text>`.** These are findings, not
noise.

The game validates this field and the editor does not, so expect at least one
refusal. Its locale carries three relevant strings:

- `__1__ is an invalid grid position value.`
- `Grid position value for this blueprint has to be multiple of __1__.`
- `Grid position and blueprint grid position coordinates need to be either all
  even or all odd.`

If X=3 Y=5 or X=8 Y=9 is refused for parity or multiples, **note it and use the
nearest value the game accepts**, then note what you actually used. A refusal is
worth more than a clean run: `BlueprintAlignment.ts` has no validation at all,
so the editor can already write a grid position the game will not take back.

**If the Grid position X/Y turn out not to be typeable**, the tooltip says the
field is set by shift + left-click in the preview instead. Use that to get as
close as you can, note the value you actually landed on, and carry on - the
analysis scores against what you record, not against what the step asked for.

---

## Other commands

| Command | Does |
| --- | --- |
| `/gp-note <text>` | record a note in the capture stream |
| `/gp-help` | reprint the steps in game |
| `/gp-reset` | rebuild the layout and re-run the controls, start over |
