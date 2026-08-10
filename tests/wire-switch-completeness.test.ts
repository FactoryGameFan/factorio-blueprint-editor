import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import { EntityWithOwnerPrototype } from 'factorio:prototype'
import { getCircuitConnector, getMaxWireDistance } from '../packages/editor/src/core/factorioData'

/*
    `getCircuitConnector` and `getMaxWireDistance` are per-type switches that a
    new prototype has to be added to by hand, and nothing checked they were
    complete. That gap cost a real bug (#186): `splitter` was missing from both,
    and the two halves failed nothing alike.

    - `getCircuitConnector` fell to `default:` and answered undefined. Nothing
      catches around `WiresContainer.add` - it is a bare `forEach` inside
      `BlueprintContainer.initBP`, and the only `try` in `Editor.loadBlueprint`
      sits above it around `getChildIndex` - so one wired splitter threw
      "Could not find the wire connection point!" and took the *whole blueprint*
      down. The throw lands before `addChildAt`, so the container is never
      attached and everything else on screen goes with it.
    - `getMaxWireDistance` fell to `default: return 0`, and a reach of 0 only
      makes `WiresContainer.createWire` draw the wire at alpha 0.3, as though the
      ends were out of range. Wrong, and completely silent.

    Both are complete today, so this is not a live defect - it is the thing that
    catches the next one before a user does. What would *not* have caught the
    splitter is the corpus: 578 blueprints stayed green because no file in it
    held a wired splitter, and `tests/splitter-wires.spec.ts` pins that one type
    by name, which is the wrong shape for a question about coverage.

    Three things about where this sits and how it asks the question.

    It is a vitest test living in tests/, which is a directory of Playwright
    specs, and both halves of that are deliberate. Neither function under test
    reads `FD` - both take a prototype directly - so nothing has to be loaded and
    no browser is needed, which also means it can run in CI, where Playwright
    does not. But it cannot live next to the code it guards: `packages/editor`
    narrows its tsconfig `types` back to typed-factorio alone, on purpose, so
    that browser code cannot reach node globals, and this needs `fs`. The root
    config is the only one here carrying node types, so a test that reads a file
    off disk sits under a directory that config owns whatever it is testing.

    It reads the real `packages/exporter/data/output/data.json`, the same file
    the editor fetches at runtime. That file is tracked (4.1 MB), so CI has it.

    And it asks *behaviourally* - it calls the real function with the real
    prototype and checks the answer is not the default one - rather than parsing
    the source for `case` labels. Reading the text would answer "is this type
    named", which is a proxy; this answers "does a wire have somewhere to go",
    which is the property a user has. It also stays true through a reformat, and
    it catches an arm that names a type and still hands back nothing.
*/

/**
 * The two fields, plus the one nesting that exists, read loosely.
 * `EntityWithOwnerPrototype` is the union base and declares neither, and the
 * point here is to find them wherever the data puts them rather than to trust a
 * type that has already been shown to be incomplete.
 */
type ProbedPrototype = EntityWithOwnerPrototype & {
    circuit_connector?: unknown
    ground_picture_set?: { circuit_connector?: unknown }
    circuit_wire_max_distance?: number
}

/*
    Resolved from the working directory rather than from this file, the way
    tests/helpers/blueprint-files.ts resolves test-blueprints/. Both runners that
    reach this directory start at the repo root. `import.meta.dirname` would say
    it more directly and does not compile: the root tsconfig is `module: "ES6"`,
    which predates import.meta, and that config is shared with the editor build.
*/
const DATA_JSON = path.resolve(process.cwd(), 'packages/exporter/data/output/data.json')

const entities = (
    JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8')) as {
        entities: Record<string, ProbedPrototype>
    }
).entities

/*
    Every direction a blueprint can carry, not just the four cardinals. The arms
    index their connector list differently and one of them uses all sixteen: a
    rail signal reads `[dir]` where an assembling machine reads `[dir / 4]`, a
    railgun turret `[dir / 2]`, and a loader offsets by four again depending on
    which way it faces. Sweeping the lot means this asks "is there any facing at
    which a wire can attach" without having to restate each arm's arithmetic,
    which would be the same mistake as parsing the source.
*/
const DIRECTIONS = Array.from({ length: 16 }, (_, i) => i)

/** X, H, V, SE, SW, NE and NW - the seven a transport belt indexes by. */
const BELT_CONNECTION_INDICES = [0, 1, 2, 3, 4, 5, 6]

function isGivenAConnector(e: ProbedPrototype): boolean {
    for (const dir of DIRECTIONS) {
        for (const inputting of [false, true]) {
            for (const belt of BELT_CONNECTION_INDICES) {
                const cc = getCircuitConnector(
                    e,
                    dir,
                    () => inputting,
                    () => belt
                )
                if (cc !== undefined) return true
            }
        }
    }
    return false
}

/**
 * Entities whose prototype declares a circuit connector somewhere.
 *
 * Two places, measured rather than assumed: 78 entities carry it at the top
 * level and the two rail signals carry it under `ground_picture_set` instead.
 * Those same two also carry an `elevated_picture_set.circuit_connector`, which
 * the editor does not read and which is deliberately not asserted here - the
 * elevated rails are a collision layer this editor models only in placement.
 */
const declaresAConnector = Object.entries(entities).filter(
    ([, e]) =>
        e.circuit_connector !== undefined || e.ground_picture_set?.circuit_connector !== undefined
)

const declaresAWireDistance = Object.entries(entities).filter(
    ([, e]) => e.circuit_wire_max_distance !== undefined
)

describe('getCircuitConnector covers data.json', () => {
    it('gives a connector to every entity whose prototype declares one', () => {
        const unhandled = declaresAConnector
            .filter(([, e]) => !isGivenAConnector(e))
            .map(([name, e]) => `${name} (type ${e.type})`)

        /*
            Reported as a list rather than one `expect` per entity so a newly
            unhandled type names every entity it covers in one run. Deleting
            `case 'splitter'` from the switch prints all four splitters.
        */
        expect(
            unhandled,
            'these fall to the default arm and so lose their whole blueprint'
        ).toEqual([])
    })

    it('is asking about a non-empty set', () => {
        /*
            Without this the test above passes just as happily against a data.json
            that failed to parse, moved the field, or was replaced by `{}`. It
            asserts a floor rather than the measured 80, so re-running the
            exporter is not a fixture update; what it is really pinning is that
            the *way* the fields are found still finds them.
        */
        expect(declaresAConnector.length).toBeGreaterThan(50)

        const types = new Set(declaresAConnector.map(([, e]) => e.type))
        expect(types.has('splitter'), 'the type whose omission motivated this').toBe(true)
        expect(types.has('rail-signal'), 'the type that nests the field').toBe(true)
    })
})

describe('getMaxWireDistance covers data.json', () => {
    it('reports the exact reach every entity declaring one carries', () => {
        /*
            Equality, not "not zero". The default arm answers 0 and no entity in
            data.json declares less than 9, so either would catch a missing case
            - but equality also catches an arm added to the wrong group, reading
            `maximum_wire_distance` or `wire_max_distance` off an entity that
            declares neither and quietly answering 0 again.
        */
        const wrong = declaresAWireDistance
            .filter(([, e]) => getMaxWireDistance(e) !== e.circuit_wire_max_distance)
            .map(
                ([name, e]) =>
                    `${name} (type ${e.type}): got ${getMaxWireDistance(e)}, declares ${e.circuit_wire_max_distance}`
            )

        expect(wrong, 'these draw their wires at alpha 0.3 as though out of range').toEqual([])
    })

    it('is asking about a non-empty set', () => {
        expect(declaresAWireDistance.length).toBeGreaterThan(50)
        expect(new Set(declaresAWireDistance.map(([, e]) => e.type)).has('splitter')).toBe(true)
    })

    it('still answers for the two types that keep their reach elsewhere', () => {
        /*
            `electric-pole` and `power-switch` are in the switch but in neither
            set above: they declare `maximum_wire_distance` and `wire_max_distance`
            and no `circuit_wire_max_distance` at all. So the data-driven half
            cannot see them, and a refactor that dropped their two arms would be
            invisible to everything else here.
        */
        expect(getMaxWireDistance(entities['medium-electric-pole'])).toBeGreaterThan(0)
        expect(getMaxWireDistance(entities['power-switch'])).toBeGreaterThan(0)
    })
})

describe('the default arms still answer nothing', () => {
    /*
        The control, and it has to be able to fail while everything above passes.
        Every assertion here is of the form "the switch answered something", so a
        `default:` that returned a connector and a 9 would satisfy the lot. A pipe
        is in neither switch and takes no circuit wire; it is what answering
        indiscriminately would look like.
    */
    it('for an entity in neither switch', () => {
        const pipe = entities['pipe']

        expect(isGivenAConnector(pipe)).toBe(false)
        expect(getMaxWireDistance(pipe)).toBe(0)
    })
})
