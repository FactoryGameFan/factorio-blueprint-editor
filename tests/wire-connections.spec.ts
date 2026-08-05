import { test, expect } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'

/*
    WireConnections stores wires twice: as a hash -> connection map, and as an
    entity number -> hashes index that WireConnectionMap maintains alongside it.
    Nothing checked that the two agree, and both now throw rather than quietly
    handing back undefined when they disagree, so it is worth proving the
    invariant holds against a real blueprint.

    The blueprint-loading suite already covers decode and render. This covers the
    serialize direction and the create/remove cycle, neither of which that suite
    reaches. The static (de)serialize functions are unit tested in
    packages/editor/src/core/WireConnections.test.ts instead - they need no FD data.

    Not covered: the loose connection point, which only exists while a wire is
    being dragged in paint mode. Reaching it needs the BlueprintContainer, which
    the editor does not expose.

    Runs against the dev server like the rest of tests/ - see CLAUDE.md for the
    two servers that have to be up.
*/

// biggest test blueprint, so the wire set is large and varied (circuit and copper)
const BLUEPRINT = 'EARN/pocket-base-space-age-v22.1.2'

test('wire connections stay consistent with their index and survive a round trip', async ({
    page,
}) => {
    const blueprint = discoverBlueprintFiles().find(f => f.name === BLUEPRINT)
    if (!blueprint) throw new Error(`test blueprint ${BLUEPRINT} not found in test-blueprints/`)

    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await page.waitForFunction(() => (window as any).__fbe_test !== undefined, { timeout: 60_000 })

    const bpString = readBlueprintString(blueprint.filePath)

    const result = await page.evaluate(async (str: string) => {
        const api = (window as any).__fbe_test
        let bp = await api.getBlueprintOrBookFromSource(str)
        if (bp.selectBlueprint) bp = bp.selectBlueprint(0)

        const wc = bp.wireConnections
        const entityNumbers = [...bp.entities.keys()]

        // Every hash the index hands out has to resolve to a connection that
        // actually names the entity it was indexed under. Both getEntityConnections
        // and get() throw on a dangling hash, so reaching the end proves neither did.
        let indexedHashes = 0
        let mismatchedIndexEntries = 0
        for (const entNr of entityNumbers) {
            const hashes = wc.getEntityConnectionHashes(entNr)
            indexedHashes += hashes.length
            for (const hash of hashes) {
                const conn = wc.get(hash)
                if (conn.cps[0].entityNumber !== entNr && conn.cps[1].entityNumber !== entNr) {
                    mismatchedIndexEntries += 1
                }
            }
        }

        // serializeBpWires resolves both endpoints of every stored connection
        // against bp.entities, so it throws if the wire set references an entity
        // the blueprint does not have
        const wires = wc.serializeBpWires()
        const key = (w: number[]): string => w.join(',')
        const before = wires.map(key).sort()

        // A connection whose two ends are the same entity (a combinator wired from
        // its own output back to its input) is indexed once, not twice
        const selfConnections = wires.filter((w: number[]) => w[0] === w[2]).length

        // serializing is a read; doing it twice must not drift
        const again = wc.serializeBpWires().map(key).sort()
        const stableAcrossCalls = JSON.stringify(before) === JSON.stringify(again)

        // Take a real connection out and put it back. This drives
        // WireConnectionMap.set/delete and the index bookkeeping on both ends,
        // and the wire set has to come back identical.
        const wiredEntity = entityNumbers.find(
            (en: number) => wc.getEntityConnectionHashes(en).length > 0
        )
        if (wiredEntity === undefined) throw new Error('blueprint has no wired entities')
        const sampleHash = wc.getEntityConnectionHashes(wiredEntity)[0]
        const sample = wc.get(sampleHash)
        // the hash, not the endpoints: two combinators can carry same-coloured wires
        // on both their input and output sides, so endpoints alone do not identify one
        const sampleEnds = [sample.cps[0].entityNumber, sample.cps[1].entityNumber]

        wc.remove(sample)
        const afterRemoveCount = wc.serializeBpWires().length
        // getEntityConnections throws on a dangling hash, so if the index still held
        // the removed hash this would blow up rather than return it
        const endsStillIndexingRemoved = sampleEnds.filter((en: number) =>
            wc.getEntityConnectionHashes(en).includes(sampleHash)
        ).length

        wc.create(sample)
        const afterRecreate = wc.serializeBpWires().map(key).sort()
        const endsIndexingAfterRecreate = sampleEnds.filter((en: number) =>
            wc.getEntityConnectionHashes(en).includes(sampleHash)
        ).length

        return {
            entityCount: entityNumbers.length,
            wireCount: wires.length,
            selfConnections,
            indexedHashes,
            mismatchedIndexEntries,
            stableAcrossCalls,
            removedExactlyOne: afterRemoveCount === wires.length - 1,
            endsStillIndexingRemoved,
            // one end if the wire is a self-connection, two otherwise
            endsIndexingAfterRecreate,
            expectedEndsIndexing: sampleEnds[0] === sampleEnds[1] ? 1 : 2,
            roundTripped: JSON.stringify(afterRecreate) === JSON.stringify(before),
        }
    }, bpString)

    // the blueprint has to actually contain wires, or none of this proves anything
    expect(result.wireCount).toBeGreaterThan(0)
    expect(result.indexedHashes).toBeGreaterThan(0)

    // each connection is indexed under both of its ends, so the index holds two
    // entries per wire - except a self-connection, which is indexed once
    expect(result.indexedHashes).toBe(result.wireCount * 2 - result.selfConnections)
    expect(result.mismatchedIndexEntries).toBe(0)

    expect(result.stableAcrossCalls).toBe(true)
    expect(result.removedExactlyOne).toBe(true)
    expect(result.endsStillIndexingRemoved).toBe(0)
    expect(result.endsIndexingAfterRecreate).toBe(result.expectedEndsIndexing)
    expect(result.roundTripped).toBe(true)

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
})
