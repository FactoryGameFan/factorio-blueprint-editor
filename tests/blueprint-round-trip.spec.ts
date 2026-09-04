import { test, expect } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    Characterization test for Blueprint's decode -> model -> serialize path,
    ahead of clearing its 22 strictNullChecks errors (issue #22).

    Nothing covers this today. blueprint-loading.spec.ts checks that a blueprint
    loads without console noise, and entity-accessors.spec.ts checks what the
    Entity getters return, but neither looks at what comes back out of
    Blueprint.serialize(), and none of them would notice if entities moved.

    Moving is the specific risk. getOffset() decides where the whole blueprint
    lands relative to the grid, and it is one of the functions being changed -
    it takes `data?: Partial<IBlueprint>` and reads data.entities, data.tiles and
    data.version off it. A wrong guard there shifts every entity in every
    blueprint by a tile or centres it on the wrong axis, and every existing test
    would still pass, because they all ask about entities rather than about where
    the entities are.

    The serialized output cannot catch that on its own, which mutation-checking
    this test is how I found out. serialize() re-centres everything through
    getCenter() before writing positions out, so a uniform shift applied at load
    time is cancelled on the way back out and the round trip is offset-invariant
    by design. Shifting getOffset by a whole tile changes nothing it reports.

    So there are two position checksums and they are not redundant.
    modelPositionChecksum reads bp.entities and bp.tiles - where the entities
    actually sit after loading, which is what getOffset decides and what the
    canvas draws. positionChecksum reads the serialized output, which is what
    round-trips back into a blueprint string. A change to either is worth
    knowing about and neither implies the other.

    Alongside those: the counts that survive the round trip, and a hash of the
    serialized output as a whole. The hash catches everything else, at the cost
    of a less specific failure message - it cannot tell a shift from a
    re-ordering, which is why the checksums are there.

    What this does NOT cover, found the same way: every blueprint in
    test-blueprints/ carries a version, so anything keyed on a *missing* version
    is inert here. Replacing `data.version < X` with `(data.version ?? 0) < X`
    passes this test untouched while being wrong - it would treat a version-less
    blueprint as pre-2.0 and parse its wires in the old format. Those reads want
    reasoning about, not a green run.

    Fixed point, not a snapshot to regenerate. A diff means the round trip
    changed - review it as a behaviour change.
*/

test('every test blueprint survives the decode/serialize round trip unchanged', async ({
    page,
}) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)

    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const sources = files.map(f => readBlueprintString(f.filePath))

    const summary = await page.evaluate(async (strings: string[]) => {
        const api = (window as any).__fbe_test

        /*
            djb2 over the serialized JSON. Only needs to be stable and sensitive,
            not cryptographic, and it has to run in-page so the full JSON of 367
            blueprints never crosses the CDP bridge.
        */
        const hashInto = (h: number, s: string): number => {
            let acc = h
            for (let i = 0; i < s.length; i++) {
                acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
            }
            return acc
        }

        let blueprints = 0
        let entities = 0
        let tiles = 0
        let wires = 0
        let icons = 0
        let threw = 0
        /*
            Weighted so that swapping an entity's x and y, or moving one entity
            +1 and another -1, still changes the total.
        */
        let positionChecksum = 0
        let modelPositionChecksum = 0
        let serializedHash = 5381

        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? loaded.lastBookIndex + 1 : 1

            for (let i = 0; i < count; i++) {
                const bp = isBook ? loaded.selectBlueprint(i) : loaded
                blueprints += 1

                /*
                    Read before serialize(): serialize() mutates nothing here,
                    but the model is what getOffset positioned and it is the only
                    place a load-time shift is visible.
                */
                for (const e of bp.entities.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }
                for (const t of bp.tiles.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum + Math.round(t.x) * 11 + Math.round(t.y) * 13) | 0
                }

                let obj: any
                try {
                    obj = bp.serialize()
                } catch {
                    // serializing is behaviour too - a throw here is pinned, not hidden
                    threw += 1
                    continue
                }

                entities += obj.entities ? obj.entities.length : 0
                tiles += obj.tiles ? obj.tiles.length : 0
                wires += obj.wires ? obj.wires.length : 0
                icons += obj.icons ? obj.icons.length : 0

                for (const e of obj.entities ?? []) {
                    positionChecksum =
                        (positionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }

                serializedHash = hashInto(serializedHash, JSON.stringify(obj))
            }
        }

        return {
            blueprints,
            entities,
            tiles,
            wires,
            icons,
            threw,
            positionChecksum,
            modelPositionChecksum,
            serializedHash,
        }
    }, sources)

    expect(summary).toEqual(EXPECTED)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

/**
 * The original fixed point here was captured before the Blueprint/History
 * strictNullChecks cleanup (issue #22), against the 578-blueprint
 * wormeyman-tests/ corpus. It is not what is below any more - the corpus was
 * replaced by the 367-blueprint test-blueprints/ (issue #186), which moves
 * every count in EXPECTED, not only serializedHash. The values below are a
 * live capture against test-blueprints/ with today's code, taken 2026-08-05
 * by the same throwaway recorder before it was deleted. See the note at the
 * top of this file before changing any of it.
 *
 * `serializedHash` has moved twice, not once. First from -488612622 to
 * -883773190, when the legacy name migrations became version-aware (issue
 * #40): the corpus was entirely post-2.0 then, exactly as it was before that
 * fix and exactly as test-blueprints/ is now, so nothing in it should have
 * been migrated at all - the bug was migrations still running on those
 * blueprints, quietly rewriting stack inserters to bulk-inserter on load and
 * re-encoding them that way. Recorded then as 9535 stack inserters across 7
 * of the 11 files; that corpus was gitignored and has since been replaced, so
 * the figure cannot be re-measured and is not asserted as fact here. Both
 * position checksums and every count held across that move, which is the
 * signature of names changing under identical geometry.
 *
 * Then from -883773190 to 825830683, when the corpus itself was swapped
 * for test-blueprints/ (issue #186). That move is not a signature of
 * anything targeted - blueprints, entities, tiles, wires and icons all moved
 * with it, because a different set of blueprints is a different set of
 * blueprints. The hash changing is exactly what serializing different JSON
 * should do.
 *
 * Then from 825830683 to -1735753444 here, when icon signal types stopped
 * being re-derived on the way out (issue #264). This one has the #40
 * signature rather than the #186 one, and that is the argument for accepting
 * it: every count held, `icons` included at 956, and both position checksums
 * held, so no blueprint gained, lost or moved anything. Only the serialized
 * JSON differs, in the one field that was being rewritten. Measured
 * separately over the same corpus, 359 of those 956 icons used to change
 * type across a round trip - 334 `item` to `recipe`, 17 `space-location` to
 * `item`, 8 `item` to `fluid` - and after the fix 0 of 956 do. 383 of the
 * corpus's 1034 icons omit `type` entirely, which Factorio does for items, so
 * the absence had to survive too and the output now carries no type where the
 * input carried none.
 */
const EXPECTED = {
    blueprints: 372,
    entities: 350862,
    tiles: 232815,
    wires: 49257,
    icons: 970,
    threw: 0,
    positionChecksum: -44088168,
    modelPositionChecksum: -63922400,
    serializedHash: 568918011,
}
