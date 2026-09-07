import { beforeAll, describe, expect, it } from 'vite-plus/test'
import * as pako from 'pako'
import { Blueprint } from './Blueprint'
import { getAndClearLoadWarnings, getBlueprintOrBookFromSource } from './bpString'
import { loadData } from './factorioData'

/*
    What `blueprintSchema.json` accepts, tested through the path a user takes -
    `getBlueprintOrBookFromSource`, whose validation failures surface as the
    "Blueprint had validation warnings (loaded anyway)" toast rather than as a
    thrown error. A schema gap is therefore silent apart from that one line, and
    nothing else in the suite reads it.

    The case here is the decider combinator's `else_outputs`, added by Factorio
    2.1.9 ("Decider combinator supports else-output", 30. 06. 2026). The schema
    was written against 2.0 and sets `additionalProperties: false` on
    `decider_conditions`, so every 2.1 blueprint holding a decider failed
    validation on that one key - including two files of the committed corpus,
    `gleba-base-mall-all` (36 deciders) and `vulcanus-starter-mk2` (44).

    The shapes below are transcribed from `tools/oracle/probe-decider-else-outputs.mjs`
    run against Factorio 2.1.14, not from the Lua API's `DeciderCombinatorParameters`,
    which describes the runtime concept rather than the serialisation.
*/

beforeAll(() => {
    // loadData permanently replaces FD's accessors. Vitest's per-file module
    // isolation keeps this synthetic dataset out of the other test files.
    loadData(
        JSON.stringify({
            items: { 'decider-combinator': { name: 'decider-combinator' } },
            fluids: {},
            signals: {},
            recipes: {},
            entities: {
                'decider-combinator': {
                    type: 'decider-combinator',
                    name: 'decider-combinator',
                    minable: { result: 'decider-combinator' },
                    collision_box: [
                        [-0.35, -0.65],
                        [0.35, 0.65],
                    ],
                },
            },
            tiles: {},
            inventoryLayout: [],
            utilitySprites: {},
            utilityConstants: {},
            guiStyle: {},
            defines: {},
        })
    )
})

/** 2.1.12, the version the two corpus files and the reported blueprint declare. */
const VERSION_2_1_12 = 2 * 2 ** 48 + 1 * 2 ** 32 + 12 * 2 ** 16

/**
 * The encoding `decode()` expects: a version byte, then deflated JSON. Written
 * out rather than reusing `encode()`, which serialises a `Blueprint` - the two
 * controls below need a key the model would be free to drop on its way through.
 */
const sourceFor = (decider_conditions: Record<string, unknown>): string => {
    const json = JSON.stringify({
        blueprint: {
            item: 'blueprint',
            version: VERSION_2_1_12,
            // Required by the schema, and not what any case here is about.
            icons: [{ index: 1, signal: { type: 'item', name: 'decider-combinator' } }],
            entities: [
                {
                    entity_number: 1,
                    name: 'decider-combinator',
                    position: { x: 0.5, y: 0 },
                    control_behavior: { decider_conditions },
                },
            ],
        },
    })
    let binary = ''
    for (const byte of pako.deflate(json)) binary += String.fromCharCode(byte)
    return `0${btoa(binary)}`
}

const load = async (decider_conditions: Record<string, unknown>) => {
    const bp = await getBlueprintOrBookFromSource(sourceFor(decider_conditions))
    if (!(bp instanceof Blueprint)) throw new Error('expected a blueprint, got a book')
    return {
        warnings: getAndClearLoadWarnings(),
        elseOutputs:
            bp.serialize().entities?.[0].control_behavior?.decider_conditions?.else_outputs,
    }
}

const CONDITIONS = [
    { first_signal: { type: 'virtual', name: 'signal-A' }, constant: 5, comparator: '>' },
]
const OUTPUTS = [
    { signal: { type: 'virtual', name: 'signal-check' }, copy_count_from_input: false },
]

describe("a decider combinator's else-outputs (Factorio 2.1.9)", () => {
    /*
        The shape that made this visible. Measured: 2.1 writes the key whether or
        not the else branch holds anything, so an empty array is what most 2.1
        blueprints carry - all five deciders in the reported blueprint, and every
        one in the two corpus files.
    */
    it('accepts an empty else_outputs, which 2.1 writes even with no else branch', async () => {
        const { warnings, elseOutputs } = await load({
            conditions: CONDITIONS,
            outputs: OUTPUTS,
            else_outputs: [],
        })
        expect(warnings).toEqual([])
        expect(elseOutputs).toEqual([])
    })

    /* The `one-else` probe case: a constant output on the else branch. */
    it('accepts and preserves a constant else-output', async () => {
        const else_outputs = [
            {
                signal: { type: 'virtual', name: 'signal-red' },
                copy_count_from_input: false,
                constant: 7,
            },
        ]
        const { warnings, elseOutputs } = await load({
            conditions: CONDITIONS,
            outputs: OUTPUTS,
            else_outputs,
        })
        expect(warnings).toEqual([])
        expect(elseOutputs).toEqual(else_outputs)
    })

    /*
        The `else-copy` probe case. It is the one that pins the element type
        rather than a guess at it: a copying else-output drops
        `copy_count_from_input` (it defaults to true) and carries `networks`,
        so this fails against any definition narrower than the `outputs` one.
    */
    it('accepts a copying else-output with a network selection', async () => {
        const else_outputs = [
            { signal: { name: 'iron-plate' }, networks: { red: true, green: false } },
        ]
        const { warnings, elseOutputs } = await load({
            conditions: CONDITIONS,
            outputs: OUTPUTS,
            else_outputs,
        })
        expect(warnings).toEqual([])
        expect(elseOutputs).toEqual(else_outputs)
    })

    /*
        The control, and the reason this is not `additionalProperties: true`.
        `decider_conditions` still refuses a key Factorio never writes, so these
        tests can fail: without it, adding the key at all would be untested and
        widening the object to accept anything would pass every case above.
    */
    it('still warns about a key Factorio does not write', async () => {
        const { warnings } = await load({
            conditions: CONDITIONS,
            outputs: OUTPUTS,
            else_outputz: [],
        })
        expect(warnings).toEqual(['Blueprint had validation warnings (loaded anyway)'])
    })

    /*
        And the element type is not free-form either: an else-output takes the
        same four keys `outputs` does and no more.
    */
    it('still warns about an unknown key inside an else-output', async () => {
        const { warnings } = await load({
            conditions: CONDITIONS,
            outputs: OUTPUTS,
            else_outputs: [{ signal: { type: 'virtual', name: 'signal-red' }, output_signal: {} }],
        })
        expect(warnings).toEqual(['Blueprint had validation warnings (loaded anyway)'])
    })
})
