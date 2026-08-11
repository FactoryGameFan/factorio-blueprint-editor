/*
    Issue #206. The editor's wheel zoom has no floor, a soft ceiling and an
    asymmetric step; the design (docs/superpowers/specs/2026-08-10-zoom-levels-design.md)
    settles a fixed ladder whose endpoints come from the game rather than from
    reasoning. This is the probe that measures them.

    Unlike every other probe here, this one **needs a LuaPlayer**. Zoom is a
    property of a player's controller, not of a prototype or a surface, so
    `--create` cannot reach it: a created map has nobody in it. That forces two
    departures from the established shape, and both are the point rather than
    an inconvenience:

      - it runs the **graphics client** with `--load-scenario base/freeplay`,
        so a player exists and a real controller is active
      - it does not `error("DUMPED-OK")` its way out. The automated half writes
        its dump and then **stays running**, because the second half needs a
        human at the wheel.

    What it asks:

      1. The character controller's `zoom_limits`, read directly. Three fields,
         not two: `closest`, `furthest`, and `furthest_game_view` - the last
         being the zoom past which the engine renders **chart (map) view**
         instead of the world. The editor has no map view, so the limit that
         corresponds to its floor is `furthest_game_view`, not `furthest`. The
         design was written before this field was known and says the range has
         two ends; it has three.

      2. The same range measured a second, independent way: write a zoom far
         outside the limits and read it back. The docs say writes outside the
         limits are always valid while reads are clamped, so the readback is
         the true bound. **The two must agree.** A disagreement is the finding,
         not a number to average.

      3. Where the game view actually gives way to chart view, swept
         empirically over ~100 geometric steps while reading `render_mode`.
         That is a third instrument, and it checks (1)'s `furthest_game_view`
         against observed rendering rather than against the same table it came
         from.

      4. **The ladder itself**, by sampling `player.zoom` every tick while a
         human scrolls from one end of the range to the other. This is the part
         no headless run can do, and it is what makes the shipped ratio a
         measurement instead of a taste. #211 exists because the design assumed
         this was out of reach without a logging mod; this is that logging mod.

      5. `god` and `spectator` limits on demand (`/zoomcontrollers`), because
         limits are per controller type and "like the game" means the character
         controller. Recording the others says whether the number chosen is the
         one a player actually experiences.

    Controls, in the README's sense - each can fail while the hypothesis holds:

      - **Instrument**: the direct read (1) and the write-readback (2) are two
        independent routes to one quantity. Agreement is not guaranteed by
        construction; the readback goes through the engine's clamp while the
        read goes through the limits table.
      - **Instrument**: the scroll capture must find more than one distinct
        zoom. A single value looks exactly like a correct single value, and is
        what a wheel that never reached the game (window unfocused, cursor over
        a GUI) produces.
      - **Cross-instrument**: the endpoints of the hand-scrolled ladder must
        equal the limits measured headlessly. This is the control the design
        named for #211 - two instruments, neither derived from the other,
        checking each other.
      - **Coordinate**: `display_scale` and `display_resolution` are recorded,
        because the design's claim that the units already agree (32 px per tile
        at zoom 1, both here and in the editor) is only exact at scale 1, and a
        `distance`-form limit is defined against the window's aspect ratio
        rather than being a zoom number at all.
      - **Voiding**: if no player with a character controller is ever obtained,
        the run says so and records nothing. Zeros from a missing player read
        exactly like a measured zero, which is the elevated-rail lesson.

    In the game, once it says it is ready:

           /zoomoffladder [value]   set a zoom that is on no rung, then scroll ONE notch
           /zoomcontrollers         record god and spectator limits
           /zoomdone                flush and report; then quit however you like

    Usage:
           # one command: sets up, launches the game, waits, then analyses
           FACTORIO_BIN="$HOME/Downloads/factorio_space_age_mac_2_0_77.app/Contents/MacOS/factorio" \
             node tools/oracle/probe-zoom-limits.mjs --work /tmp/zoom-1

           # re-read one session's dumps without relaunching
           node tools/oracle/probe-zoom-limits.mjs --work /tmp/zoom-1 --analyze

           # several sessions as one capture, which is how the fixture was taken.
           # Use a FRESH dir per launch - the sample log is appended to, so reusing
           # one silently interleaves two sittings into a single tick timeline.
           node tools/oracle/probe-zoom-limits.mjs --analyze --write-fixture \
             --sessions /tmp/zoom-1,/tmp/zoom-2,/tmp/zoom-3 && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not.
*/
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'zoom-limits.json')

const flag = name => {
    const i = process.argv.indexOf(name)
    return i === -1 ? undefined : process.argv[i + 1]
}
const WRITE_FIXTURE = process.argv.includes('--write-fixture')
const ANALYZE_ONLY = process.argv.includes('--analyze')
const RAW_OUT = flag('--raw-out')

const MOD = 'bp_zoom_limits'
const DUMP_HEADLESS = 'zoom-headless.json'
const DUMP_SAMPLES = 'zoom-samples.jsonl'
const DUMP_CONTROLLERS = 'zoom-controllers.jsonl'

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()
const binaryVersion = (binaryLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1)
if (binaryVersion.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(binaryLine)}`)
    process.exit(1)
}
/*
    Derived, not hardcoded. A mod declaring 2.1 against a 2.0.x binary is
    skipped in silence and the run ends with no dump and nothing naming why.
*/
const MOD_FACTORIO_VERSION = `${binaryVersion[0]}.${binaryVersion[1]}`

const work = flag('--work') ?? mkdtempSync(join(tmpdir(), 'fbe-zoom-'))
const writeData = join(work, 'write-data')
const modDir = join(work, 'mods')
const modPath = join(modDir, `${MOD}_0.0.1`)
const outDir = join(writeData, 'script-output')

if (!ANALYZE_ONLY) {
    mkdirSync(outDir, { recursive: true })
    mkdirSync(modPath, { recursive: true })

    writeFileSync(
        join(modPath, 'info.json'),
        JSON.stringify({
            name: MOD,
            version: '0.0.1',
            title: 'What zoom range and what per-notch step does the game use',
            author: 'oracle',
            factorio_version: MOD_FACTORIO_VERSION,
            dependencies: ['base'],
        })
    )

    /*
        State lives in file-local Lua rather than in `storage` on purpose: a
        probe session is one uninterrupted play session, nothing is loaded from
        a save, and every measurement is appended to disk the moment it is
        taken. So a hard quit at any point loses nothing, which is what makes
        it safe to let a human end the session however they like.
    */
    writeFileSync(
        join(modPath, 'control.lua'),
        `
local SWEEP_POINTS = 100
local SWEEP_TICKS = 2      -- render_mode follows a rendered frame, not a set

local phase = "wait"
local player = nil
local headless = {controls = {}, sweep = {}, notes = {}}
local sweepValues, sweepIdx, sweepWait = {}, 1, 0
local lastZoom = nil
local sampleCount = 0
local savedCharacter = nil

local function spec(s)
  if s == nil then return nil end
  return {zoom = s.zoom, distance = s.distance, max_distance = s.max_distance}
end

local function limitsOf(p)
  local zl = p.zoom_limits
  if zl == nil then return nil end
  return {
    closest = spec(zl.closest),
    furthest = spec(zl.furthest),
    furthest_game_view = spec(zl.furthest_game_view),
  }
end

local function appendSample(tag)
  local line = helpers.table_to_json({
    t = game.tick,
    z = player.zoom,
    rm = tostring(player.render_mode),
    ct = tostring(player.controller_type),
    tag = tag,
  })
  helpers.write_file("${DUMP_SAMPLES}", line .. "\\n", true)
  sampleCount = sampleCount + 1
end

local function say(msg)
  player.print(msg)
  log("[zoom-probe] " .. msg)
end

script.on_event(defines.events.on_tick, function()
  if phase == "done" then return end

  if player == nil then
    player = game.players[1]
    if player == nil then return end
  end

  -- A cutscene is its own controller with its own zoom. Freeplay opens in one.
  if player.controller_type == defines.controllers.cutscene then
    player.exit_cutscene()
    return
  end

  if phase == "wait" then
    if player.controller_type ~= defines.controllers.character then
      -- Not voided yet: freeplay takes a few ticks to hand over the character.
      if game.tick > 600 then
        headless.voided = "no character controller after 600 ticks; controller_type was "
          .. tostring(player.controller_type)
        helpers.write_file("${DUMP_HEADLESS}", helpers.table_to_json(headless))
        phase = "done"
      end
      return
    end

    headless.binary_mods = {}
    for name, v in pairs(script.active_mods) do headless.binary_mods[name] = v end
    headless.controller_type = tostring(player.controller_type)
    headless.display_resolution = {
      width = player.display_resolution.width,
      height = player.display_resolution.height,
    }
    headless.display_scale = player.display_scale
    headless.zoom_at_start = player.zoom
    -- (1) direct read
    headless.limits_read = limitsOf(player)

    -- (2) write far outside, read back: the engine clamps reads.
    player.zoom = 1000000
    phase = "readback_closest"
    return
  end

  if phase == "readback_closest" then
    headless.readback_closest = player.zoom
    player.zoom = 0.000001
    phase = "readback_furthest"
    return
  end

  if phase == "readback_furthest" then
    headless.readback_furthest = player.zoom

    -- (3) geometric sweep, reading render_mode, to find the game/chart edge.
    local lo, hi = headless.readback_furthest, headless.readback_closest
    if lo > 0 and hi > lo then
      local ratio = (hi / lo) ^ (1 / (SWEEP_POINTS - 1))
      for i = 1, SWEEP_POINTS do
        sweepValues[i] = lo * ratio ^ (i - 1)
      end
    else
      headless.notes[#headless.notes + 1] =
        "sweep skipped: readback range was not positive and increasing"
    end
    sweepIdx = 1
    sweepWait = 0
    phase = "sweep"
    player.zoom = sweepValues[1] or 1
    return
  end

  if phase == "sweep" then
    if sweepIdx > #sweepValues then
      player.zoom = 1
      helpers.write_file("${DUMP_HEADLESS}", helpers.table_to_json(headless))
      phase = "live"
      lastZoom = nil
      say("--------------------------------------------------")
      say("Zoom probe ready. The headless half is written.")
      say("Now SCROLL: all the way IN to the stop, then all the")
      say("way OUT to the stop, one notch at a time if you can.")
      say("Then type /zoomdone   (and /zoomcontrollers if asked).")
      say("--------------------------------------------------")
      return
    end
    sweepWait = sweepWait + 1
    if sweepWait >= SWEEP_TICKS then
      sweepWait = 0
      headless.sweep[#headless.sweep + 1] = {
        requested = sweepValues[sweepIdx],
        actual = player.zoom,
        rm = tostring(player.render_mode),
      }
      sweepIdx = sweepIdx + 1
      if sweepValues[sweepIdx] then player.zoom = sweepValues[sweepIdx] end
    end
    return
  end

  if phase == "live" then
    local z = player.zoom
    if z ~= lastZoom then
      lastZoom = z
      appendSample("live")
    end
  end
end)

commands.add_command("zoomoffladder", "Start a notch from between two rungs", function(cmd)
  if player == nil then return end
  --[[
      The one thing a plain scroll capture cannot show. The game always sits on
      a rung, so an ordinary capture is consistent with every rule that agrees
      on rungs. The editor is on no rung most of the time, because
      centerViewPort computes a continuous fit from the blueprint's bounds on
      every load, so this is the case it lives in.

      Three rules survive that far, and which pair a start value separates
      depends on where in the gap it sits. Between the rungs 0.820335 and
      0.905724:

        relative      multiply where you are by 2^(1/7)
        nearest+step  snap to the NEAREST rung, then move one index
        directional   move to the next rung in the direction of travel

      From 0.83 (below the gap's midpoint of 0.863) a notch IN separates only
      relative (0.9164) from the other two (0.9057, agreeing). To separate the
      remaining pair the start has to be ABOVE the midpoint, or the notch has
      to go the other way:

        0.89 IN  : nearest+step 1.0      directional 0.905724
        0.83 OUT : nearest+step 0.742997 directional 0.820335

      Hence the parameter. A value is not a neutral instrument here - it decides
      which hypotheses the run can tell apart at all.
  ]]
  local v = tonumber(cmd.parameter) or 0.83
  player.zoom = v
  appendSample("offladder-set")
  say("Zoom set to " .. v .. ". Now scroll exactly ONE notch, then say which way.")
end)

commands.add_command("zoomdone", "Flush the zoom capture and report", function()
  if player == nil then return end
  helpers.write_file(
    "zoom-done.json",
    helpers.table_to_json({samples = sampleCount, tick = game.tick, zoom = player.zoom})
  )
  say("Captured " .. sampleCount .. " zoom samples. Safe to quit the game now.")
  say("Optional: /zoomcontrollers records god and spectator limits too.")
end)

commands.add_command("zoomcontrollers", "Record limits for other controllers", function()
  if player == nil then return end
  savedCharacter = player.character
  for _, name in pairs({"god", "spectator"}) do
    local ok, err = pcall(function()
      player.set_controller({type = defines.controllers[name]})
      local rec = {controller = name, limits = limitsOf(player)}
      player.zoom = 1000000
      rec.readback_closest_same_tick = player.zoom
      player.zoom = 0.000001
      rec.readback_furthest_same_tick = player.zoom
      player.zoom = 1
      helpers.write_file("${DUMP_CONTROLLERS}", helpers.table_to_json(rec) .. "\\n", true)
    end)
    if not ok then
      helpers.write_file(
        "${DUMP_CONTROLLERS}",
        helpers.table_to_json({controller = name, error = tostring(err)}) .. "\\n",
        true
      )
    end
  end
  if savedCharacter and savedCharacter.valid then
    player.set_controller({type = defines.controllers.character, character = savedCharacter})
  end
  say("Recorded god and spectator limits; back on the character controller.")
end)
`
    )

    writeFileSync(
        join(work, 'config.ini'),
        `[path]\nread-data=__PATH__executable__/../data\nwrite-data=${writeData}\n[general]\n[other]\n`
    )

    console.log(`=== binary: ${binaryLine} (mod declared factorio_version ${MOD_FACTORIO_VERSION})`)
    console.log(`=== work dir: ${work}`)
    console.log('=== launching the graphics client; this probe needs a real player.\n')

    spawnSync(
        BIN,
        [
            '--load-scenario',
            'base/freeplay',
            '--mod-directory',
            modDir,
            '--config',
            join(work, 'config.ini'),
        ],
        { encoding: 'utf8', stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
    )
}

/* ------------------------------------------------------------------ *
 * Analysis                                                            *
 * ------------------------------------------------------------------ */

/*
    A human at the wheel cannot do everything in one sitting, and asking them to
    is how a run ends with the interesting half missing. So the analysis reads
    **several** session directories and treats them as one capture.

    That is not only a convenience: four independent launches reporting the same
    limits is a control the single-session shape cannot express, and it is the
    one that would catch a limit that moved because of the window rather than
    because of the game.
*/
const jsonl = p =>
    existsSync(p)
        ? readFileSync(p, 'utf8')
              .split('\n')
              .filter(l => l.trim())
              .map(l => JSON.parse(l))
        : []

const readSession = dir => {
    const so = join(dir, 'write-data', 'script-output')
    const hp = join(so, DUMP_HEADLESS)
    if (!existsSync(hp)) return { dir, missing: true }
    return {
        dir,
        headless: JSON.parse(readFileSync(hp, 'utf8')),
        samples: jsonl(join(so, DUMP_SAMPLES)),
        controllers: jsonl(join(so, DUMP_CONTROLLERS)),
    }
}

const sessionDirs = (flag('--sessions') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
const sessions = (sessionDirs.length ? sessionDirs : [work]).map(readSession)

const missing = sessions.filter(s => s.missing)
if (missing.length === sessions.length) {
    console.error(
        `No headless dump in any of: ${sessions.map(s => s.dir).join(', ')}\n` +
            `Mod declared factorio_version ${MOD_FACTORIO_VERSION} against ${binaryLine}.\n` +
            'If the game never reached a character controller, the run is voided rather than zero.'
    )
    process.exit(1)
}
for (const m of missing) console.log(`! session skipped, no dump: ${m.dir}`)

const good = sessions.filter(s => !s.missing)
const voided = good.filter(s => s.headless.voided)
for (const v of voided) console.log(`! session VOIDED: ${v.dir} - ${v.headless.voided}`)
const usable = good.filter(s => !s.headless.voided)
if (!usable.length) {
    console.error('\n!!! every session voided. Recording nothing; zeros are not a finding.')
    process.exit(1)
}

const H = usable[0].headless
const list = v => (v === undefined || v === null ? [] : Object.values(v))
const samples = usable.flatMap((s, i) => s.samples.map(x => ({ ...x, session: i })))
const controllers = usable.flatMap(s => s.controllers)

console.log(`\n=== binary: ${binaryLine}`)
console.log(
    `=== sessions: ${usable.length} (${usable.map(s => s.dir.split('/').pop()).join(', ')})`
)
console.log(
    `=== mods: ${Object.entries(H.binary_mods ?? {})
        .map(([n, v]) => `${n} ${v}`)
        .join(', ')}`
)
console.log(
    `=== display: ${H.display_resolution?.width}x${H.display_resolution?.height} at scale ${H.display_scale}`
)
for (const n of list(H.notes)) console.log(`! ${n}`)

/*
    Cross-session control. Each session measured the limits independently, on
    its own launch. They must agree - and this can genuinely fail, since the
    floor is computed from the window, so a resized window between runs makes
    it fail for a reason that is about the instrument rather than the game.
*/
if (usable.length > 1) {
    const key = h => `${h.readback_closest}/${h.readback_furthest}`
    const disagreeing = usable.filter(s => key(s.headless) !== key(H))
    console.log(
        `=== control: ${usable.length} independent sessions ${disagreeing.length === 0 ? 'ALL AGREE on the limits' : 'DISAGREE'}`
    )
    for (const d of disagreeing) {
        console.log(
            `    ${d.dir}: ${key(d.headless)} against ${key(H)} - check whether the window was resized`
        )
    }
}

const fmt = n => (n === undefined || n === null ? '-' : Number(n.toPrecision(8)).toString())
const specStr = s =>
    s === undefined || s === null
        ? '-'
        : s.zoom !== undefined && s.zoom !== null
          ? `zoom ${fmt(s.zoom)}`
          : `distance ${fmt(s.distance)} (max ${fmt(s.max_distance)})`

console.log('\n--- (1) zoom_limits, read directly off the character controller')
console.log(`    closest            : ${specStr(H.limits_read?.closest)}`)
console.log(`    furthest           : ${specStr(H.limits_read?.furthest)}`)
console.log(`    furthest_game_view : ${specStr(H.limits_read?.furthest_game_view)}`)

console.log('\n--- (2) write far outside the limits, read back (the engine clamps reads)')
console.log(`    ceiling : ${fmt(H.readback_closest)}`)
console.log(`    floor   : ${fmt(H.readback_furthest)}`)

/*
    Control: (1) and (2) are independent routes to one quantity - but only when
    the limit is given as a `zoom`. A `distance` limit is not a zoom number at
    all; it is a rule computed against the window, so comparing it to a readback
    directly answers "DISAGREE" for a limit that is perfectly correct.

    So the rule is transcribed here and evaluated against the window this run
    actually had, which is the README's "transcribe the proposed rule into the
    probe" applied to a rule the docs state rather than one we propose. That
    turns an incomparable field into a third instrument: docs-formula against
    engine-readback, neither derived from the other.
*/
const PX_PER_TILE = 32
const zoomFromSpec = spec => {
    if (!spec) return undefined
    if (spec.zoom !== undefined && spec.zoom !== null) return spec.zoom
    if (spec.distance === undefined || spec.distance === null) return undefined
    /*
        display_resolution is physical pixels; display_scale is the UI scaling
        factor, so the window in the 32-px-per-tile unit the zoom number is
        against is resolution/scale. Getting this wrong is invisible - it
        rescales both ends together and still looks plausible.
    */
    const w = H.display_resolution.width / H.display_scale
    const h = H.display_resolution.height / H.display_scale
    const aspect = w / h
    const WIDE = 16 / 9
    const TALL = 9 / 16
    let z
    if (aspect > WIDE || aspect < TALL) {
        /*
            Docs: "distance * 9/16 tiles visible along the window's shorter
            axis". Note the docs then give the shorter axis as the height for
            BOTH the wide and the tall case, which cannot be true of a window
            taller than it is wide; the stated rule is followed rather than the
            second example. Only the wide branch has been measured.
        */
        z = Math.min(w, h) / (PX_PER_TILE * spec.distance * (9 / 16))
    } else {
        z = Math.max(w, h) / (PX_PER_TILE * spec.distance)
    }
    if (spec.max_distance !== undefined && spec.max_distance !== null) {
        /* "The closest zoom level calculated from distance and max_distance is always used." */
        z = Math.max(z, Math.max(w, h) / (PX_PER_TILE * spec.max_distance))
    }
    return z
}

const near = (a, b) =>
    a !== undefined && b !== undefined && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a))
const predictedClosest = zoomFromSpec(H.limits_read?.closest)
const predictedFurthest = zoomFromSpec(H.limits_read?.furthest)
const agreeTop = near(predictedClosest, H.readback_closest)
const agreeBottom = near(predictedFurthest, H.readback_furthest)
console.log('\n--- control: do the two instruments agree?')
console.log(
    `    ceiling ${agreeTop ? 'AGREE' : 'DISAGREE'}  (limits table ${fmt(predictedClosest)} vs readback ${fmt(H.readback_closest)})`
)
console.log(
    `    floor   ${agreeBottom ? 'AGREE' : 'DISAGREE'}  (limits table ${fmt(predictedFurthest)} vs readback ${fmt(H.readback_furthest)})`
)
console.log(
    `    The floor is a rule, not a number: at most ${fmt(H.limits_read?.furthest?.distance)} tiles across\n` +
        `    (hard cap ${fmt(H.limits_read?.furthest?.max_distance)}), which on this ${H.display_resolution?.width}x${H.display_resolution?.height} at scale ${H.display_scale} window is ${fmt(predictedFurthest)}.\n` +
        '    It moves with the viewport. The ceiling does not.'
)
if (!agreeTop || !agreeBottom) {
    console.log('    A disagreement is the finding, not a number to average.')
}

/* (3) where the world view gives way to chart view, observed rather than declared. */
const sweep = list(H.sweep)
let gameViewEdge
for (const s of sweep) {
    if (s.rm && s.rm.indexOf('chart') === -1) {
        if (gameViewEdge === undefined || s.actual < gameViewEdge) gameViewEdge = s.actual
    }
}
const modes = [...new Set(sweep.map(s => s.rm))]
console.log('\n--- (3) render_mode swept over the range')
console.log(`    modes seen  : ${modes.join(', ') || '(none)'}`)
console.log(`    lowest zoom still rendering the world: ${fmt(gameViewEdge)}`)
console.log(
    `    declared furthest_game_view          : ${specStr(H.limits_read?.furthest_game_view)}`
)
console.log(
    '    The editor has no chart view, so this - not `furthest` - is the limit its floor\n' +
        '    corresponds to.'
)

/* (4) the hand-scrolled ladder. */
console.log(`\n--- (4) hand-scrolled capture: ${samples.length} samples`)
/*
    Split by controller before anything else. `/editor` puts the player on the
    editor controller, which has its own limits - the wiki puts its floor at 0.1
    against freeplay's 0.3 - so folding those samples into the character ladder
    would report a range no single controller has and a bottom rung that is not
    a rung of anything.
*/
const byController = {}
for (const s of samples) (byController[s.ct] ??= []).push(s)
if (Object.keys(byController).length > 1) {
    console.log('    samples span more than one controller:')
    for (const [ct, ss] of Object.entries(byController)) {
        const zs = ss.map(s => s.z)
        console.log(
            `      controller ${ct}: ${ss.length} samples, ${fmt(Math.min(...zs))} .. ${fmt(Math.max(...zs))}`
        )
    }
    console.log(`    The ladder below is the character controller (${H.controller_type}) only.`)
}
/*
    A script-set zoom is not a scrolled one. `/zoomoffladder` writes its own
    tagged sample AND trips the live watcher on the same tick, so 0.83 arrives
    looking exactly like a rung the wheel stopped on - it would enter the
    distinct set, sit between two real rungs and break the constant-ratio check
    for a reason that has nothing to do with the game.
*/
const scripted = new Set(
    samples.filter(s => s.tag === 'offladder-set').map(s => `${s.session}:${s.t}`)
)
const live = samples.filter(
    s => s.tag === 'live' && s.ct === H.controller_type && !scripted.has(`${s.session}:${s.t}`)
)

/*
    The off-ladder case, which is the one the editor lives in: centerViewPort
    computes a continuous fit on every load, so a notch almost never starts on a
    rung.

    Three rules agree on every sample taken from a rung and disagree away from
    one, and **which pair a given start separates depends on where in the gap it
    sits**, which is why every probe is evaluated rather than the first. From
    0.83 a notch in cannot tell `nearest+step` from `directional` at all - both
    say 0.905724 - and reading that one probe as a verdict would have adopted
    the wrong rule with a number that matched perfectly.
*/
const RATIO = 2 ** (1 / 7)
const rungAt = n => 2 ** (n / 7)
const offLadder = []
for (let i = 0; i < samples.length; i++) {
    if (samples[i].tag !== 'offladder-set') continue
    const start = samples[i].z
    const next = samples.slice(i + 1).find(s => s.ct === samples[i].ct && s.z !== start)
    if (!next) continue
    const landed = next.z
    const n = Math.log2(start) * 7
    const below = rungAt(Math.floor(n))
    const above = rungAt(Math.ceil(n))
    const nearest = rungAt(Math.round(n))
    /* Which way the notch went is read off the answer, not assumed. */
    const inward = landed > start
    const predictions = {
        relative: inward ? start * RATIO : start / RATIO,
        nearestThenStep: inward ? nearest * RATIO : nearest / RATIO,
        directional: inward ? above : below,
    }
    const fits = Object.entries(predictions)
        .filter(([, v]) => near(v, landed))
        .map(([k]) => k)
    offLadder.push({ start, direction: inward ? 'in' : 'out', landed, predictions, fits })
}
if (offLadder.length) {
    console.log('\n--- (4b) notches taken from between two rungs')
    for (const o of offLadder) {
        console.log(
            `    from ${fmt(o.start)} one notch ${o.direction} landed on ${fmt(o.landed)}` +
                `   [relative ${fmt(o.predictions.relative)}, nearest+step ${fmt(o.predictions.nearestThenStep)}, directional ${fmt(o.predictions.directional)}]`
        )
        console.log(
            `      consistent with: ${o.fits.length ? o.fits.join(' and ') : 'NOTHING - that is the finding, do not pick the closest'}`
        )
    }
    /* The verdict is the rule that survives EVERY probe, not the one that fits the last. */
    const survivors = ['relative', 'nearestThenStep', 'directional'].filter(r =>
        offLadder.every(o => o.fits.includes(r))
    )
    console.log(
        `    => surviving rule${survivors.length === 1 ? '' : 's'}: ${survivors.join(', ') || 'none'}`
    )
    if (survivors.length > 1) {
        console.log(
            '    More than one survives, so the probes taken do not separate them. A start\n' +
                '    ABOVE its gap midpoint, or a notch in the other direction, would.'
        )
    }
}
/*
    Plateaus are per session. Ticks restart at every launch, so a plateau
    spanning a session boundary computes a hold time out of two unrelated clocks
    - which lands in the settled-rung filter below and quietly decides which
    values count as rungs.
*/
const plateaus = []
for (const s of live) {
    const last = plateaus[plateaus.length - 1]
    if (last && last.z === s.z && last.session === s.session) {
        last.until = s.t
        continue
    }
    plateaus.push({ z: s.z, from: s.t, until: s.t, rm: s.rm, session: s.session })
}
for (let i = 0; i < plateaus.length; i++) {
    const next = plateaus[i + 1]
    const contiguous = next && next.session === plateaus[i].session
    plateaus[i].heldTicks = (contiguous ? next.from : plateaus[i].until) - plateaus[i].from
}
const distinct = [...new Set(live.map(s => s.z))].sort((a, b) => a - b)

/*
    Every rung must be an exact 2^(n/7) off a baseline of 1.0. This is the
    headline claim and it is checked rather than eyeballed off the ratio spread:
    a mean ratio can sit at 1.10409 while individual rungs drift, and a ladder
    anchored at 1.03 instead of 1.0 would give an identical ratio series. The
    two clamp values are excluded because they are limits rather than rungs -
    the game steps onto its limit exactly, which is the behaviour, not an error.
*/
const RUNG_TOL = 1e-6
const clamps = new Set([H.readback_closest, H.readback_furthest])
const rungCheck = distinct
    .filter(z => !clamps.has(z))
    .map(z => ({ z, n: Math.log2(z) * 7 }))
    .map(r => ({ ...r, off: Math.abs(r.n - Math.round(r.n)) }))
const worstRung = rungCheck.length ? Math.max(...rungCheck.map(r => r.off)) : undefined
if (rungCheck.length) {
    console.log(
        `    every non-clamp value is 2^(n/7): ${worstRung < RUNG_TOL ? 'YES' : 'NO'}` +
            ` over ${rungCheck.length} values, worst deviation in n = ${worstRung.toExponential(2)}`
    )
    const ns = rungCheck.map(r => Math.round(r.n)).sort((a, b) => a - b)
    console.log(`    n runs ${ns[0]} .. ${ns[ns.length - 1]}, baseline 2^0 = 1.0`)
}
console.log(`    distinct zoom values : ${distinct.length}`)
console.log(`    plateaus (visits)    : ${plateaus.length}`)

if (distinct.length < 2) {
    console.log(
        '    !!! INSTRUMENT CONTROL FAILED: fewer than two distinct values. A wheel that\n' +
            '    never reached the game (window unfocused, cursor over a GUI) looks like this.'
    )
} else {
    /*
        A rung is a value the zoom settled on. Anything held for a single tick
        is a frame of an animated transition, not a level the wheel stops at.
    */
    const SETTLE_TICKS = 3
    const settled = [
        ...new Set(plateaus.filter(p => p.heldTicks >= SETTLE_TICKS).map(p => p.z)),
    ].sort((a, b) => a - b)
    console.log(`    settled rungs (held >= ${SETTLE_TICKS} ticks): ${settled.length}`)
    console.log(`    range walked : ${fmt(distinct[0])} .. ${fmt(distinct[distinct.length - 1])}`)

    const ratios = []
    for (let i = 1; i < settled.length; i++) ratios.push(settled[i] / settled[i - 1])
    if (ratios.length) {
        const min = Math.min(...ratios)
        const max = Math.max(...ratios)
        const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
        console.log(
            `    consecutive ratios: min ${fmt(min)}  mean ${fmt(mean)}  max ${fmt(max)}` +
                `  ${max - min < 0.02 ? '(constant - a geometric ladder)' : '(not constant)'}`
        )
        console.log(`    rungs: ${settled.map(fmt).join(', ')}`)
    }

    /* Cross-instrument control, the one #211 was blocked on. */
    const walkedTop = distinct[distinct.length - 1]
    const walkedBottom = distinct[0]
    const topOk = near(walkedTop, H.readback_closest)
    const bottomOk = near(walkedBottom, H.readback_furthest)
    console.log('\n--- control: do the scrolled endpoints equal the measured limits?')
    console.log(
        `    top    ${topOk ? 'AGREE' : 'DIFFER'} (scrolled ${fmt(walkedTop)} vs limit ${fmt(H.readback_closest)})`
    )
    console.log(
        `    bottom ${bottomOk ? 'AGREE' : 'DIFFER'} (scrolled ${fmt(walkedBottom)} vs limit ${fmt(H.readback_furthest)})`
    )
    if (!topOk || !bottomOk) {
        console.log(
            '    DIFFER usually means the scroll simply did not reach that stop, which makes it\n' +
                '    a control on the session rather than on the game. Scroll to both stops and rerun.'
        )
    }
}

/* (5) other controllers. */
if (controllers.length) {
    console.log('\n--- (5) other controller types')
    for (const c of controllers) {
        if (c.error) {
            console.log(`    ${c.controller}: ERROR ${c.error}`)
            continue
        }
        console.log(
            `    ${c.controller}: closest ${specStr(c.limits?.closest)}, furthest ${specStr(c.limits?.furthest)}, game view ${specStr(c.limits?.furthest_game_view)}`
        )
    }
} else {
    console.log('\n--- (5) other controller types: not recorded (/zoomcontrollers was not run)')
}

const captured = {
    provenance: {
        issue: 206,
        binary: binaryLine,
        modFactorioVersion: MOD_FACTORIO_VERSION,
        capturedBy: 'tools/oracle/probe-zoom-limits.mjs',
        mods: H.binary_mods,
        display: { resolution: H.display_resolution, scale: H.display_scale },
        note:
            'Zoom is a property of a player controller, so this ran against the graphics ' +
            'client with a human at the wheel for the ladder half. The editor targets ' +
            '2.0.45 to 2.0.73 and the corpus spans 2.0.32 to 2.1.12.',
    },
    characterController: {
        limitsRead: H.limits_read,
        readbackClosest: H.readback_closest,
        readbackFurthest: H.readback_furthest,
        observedGameViewFloor: gameViewEdge,
        renderModesSeen: modes,
    },
    scrolledLadder: {
        sampleCount: live.length,
        /* The ladder as a formula, and the values it was read off. */
        rungFormula: '2^(n/7), baseline 2^0 = 1.0',
        notchesPerDoubling: 7,
        ratio: RATIO,
        distinct,
        worstRungDeviationInN: worstRung,
        plateaus: plateaus.map(p => ({ z: p.z, heldTicks: p.heldTicks, rm: p.rm })),
    },
    offLadderNotches: offLadder,
    samplesByController: Object.fromEntries(
        Object.entries(byController).map(([ct, ss]) => {
            const zs = ss.map(s => s.z)
            return [ct, { count: ss.length, min: Math.min(...zs), max: Math.max(...zs) }]
        })
    ),
    otherControllers: controllers,
    controls: {
        sessions: usable.length,
        sessionsAgreeOnLimits: usable.every(
            s =>
                s.headless.readback_closest === H.readback_closest &&
                s.headless.readback_furthest === H.readback_furthest
        ),
        ceilingInstrumentsAgree: agreeTop,
        floorInstrumentsAgree: agreeBottom,
        distinctScrolledValues: distinct.length,
        everyValueIsAnExactRung: worstRung !== undefined && worstRung < RUNG_TOL,
        scrolledEndpointsEqualLimits:
            near(distinct[distinct.length - 1], H.readback_closest) &&
            near(distinct[0], H.readback_furthest),
    },
}

if (RAW_OUT) {
    writeFileSync(RAW_OUT, JSON.stringify({ headless: H, samples, controllers }, null, 2))
    console.log(`\nRaw dump written to ${RAW_OUT}`)
}

if (WRITE_FIXTURE) {
    writeFileSync(FIXTURE, JSON.stringify(captured, null, 4) + '\n')
    console.log(`\nFixture written to ${FIXTURE} - run \`vp check --fix\` to format it.`)
} else {
    console.log('\n(no fixture written; pass --write-fixture to capture)')
}
