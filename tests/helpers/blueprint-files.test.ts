import { afterEach, describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { discoverBlueprintFiles } from './blueprint-files'

/*
    A vitest test rather than a Playwright spec, and that is the whole point of
    it rather than a filing decision. `discoverBlueprintFiles` is pure Node - no
    browser, no dev server, no FD - and when this was written that was decisive,
    because Playwright ran nowhere but a laptop while `vp test` gated every PR. A
    guard that only fires on someone's local run is most of the way back to the
    silence #190 is about: a contributor drops test-blueprints/foo.txt, it merges
    green, and it is found whenever somebody next happens to run the browser
    suite. The browser suite gates PRs too now, so that argument is weaker than
    it was - what is left of it is cost: this answers in milliseconds inside
    `checks`, against a separate job that needs two dev servers and five minutes.

    So the last test below calls the function bare, against the real corpus, and
    that call is what makes a committed stray file a red CI run.

    This is the only .test.ts under tests/. playwright.config.ts pins a testMatch
    of spec files only, so Playwright does not also try to run this file as a
    spec - the other 40 files there are all .spec.ts, so that narrowing changed
    nothing about what Playwright collects.
*/

/** A real blueprint string, so a file that gets read is a file that parses. */
const A_BLUEPRINT =
    '0eNqrVkrKTFeyUlAqSS0uUdJRykjMS8lJLVayqlZKzEspSy0qzsxLVzBUsjIyMDIwsjA2NDU2NTOtBQC/qA9M'

const tempRoots: string[] = []

function makeRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbe-corpus-'))
    tempRoots.push(dir)
    return dir
}

function writeBlueprint(dir: string, relativePath: string): void {
    const full = path.join(dir, relativePath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, A_BLUEPRINT)
}

afterEach(() => {
    while (tempRoots.length > 0) {
        fs.rmSync(tempRoots.pop() as string, { recursive: true, force: true })
    }
})

describe('discoverBlueprintFiles', () => {
    it('throws naming a blueprint that sits at the top level', () => {
        const root = makeRoot()
        writeBlueprint(root, 'EARN/proper.txt')
        writeBlueprint(root, 'orphan.txt')

        /*
            The name has to be in the message. "A file was skipped" sends whoever
            hits this back to reading readdirSync calls; "orphan.txt" sends them
            to the file. This is the assertion that a fix which throws a bare
            Error fails.
        */
        expect(() => discoverBlueprintFiles(root)).toThrow(/orphan\.txt/)
    })

    it('names every stray file, not just the first', () => {
        const root = makeRoot()
        writeBlueprint(root, 'b-second.txt')
        writeBlueprint(root, 'a-first.txt')

        /*
            Reporting one at a time turns cleaning up three files into three
            runs, and the loop is over a list already in hand.

            What this does *not* pin is the sort, and it is worth saying so
            rather than leaving the assertion looking stronger than it is:
            mutation-checked, deleting the `.sort` from the stray list leaves
            this green, because readdirSync happens to answer in name order on
            APFS. The sort is there for the same reason the collection walk
            sorts - directory order is a filesystem property and ext4 returns
            hash order - so the case that needs it is the one no test on this
            machine can reach.
        */
        let message = ''
        try {
            discoverBlueprintFiles(root)
        } catch (e) {
            message = (e as Error).message
        }

        expect(message).toContain('a-first.txt, b-second.txt')
    })

    it('is untroubled by a non-.txt file at the top level', () => {
        const root = makeRoot()
        writeBlueprint(root, 'EARN/proper.txt')
        fs.writeFileSync(path.join(root, 'README.md'), '# corpus\n')

        /*
            The control, and it can fail while the two tests above pass: the
            corpus root really does hold a README.md that #186 put there, so a
            guard written as "any file at the top level" would throw on a clean
            checkout and take all 40 specs with it.
        */
        const files = discoverBlueprintFiles(root)
        expect(files.map(f => f.name)).toEqual(['EARN/proper'])
    })

    it('still discovers a normal corpus, sorted', () => {
        const root = makeRoot()
        writeBlueprint(root, 'ZETA/b.txt')
        writeBlueprint(root, 'ALPHA/b.txt')
        writeBlueprint(root, 'ALPHA/a.txt')

        /*
            The guard is a filter that only ever throws, so nothing it does
            should change what a clean corpus discovers. Order included:
            blueprint-round-trip.spec.ts folds the corpus into one hash in
            iteration order, so a resort here is a fixture diff there.
        */
        const files = discoverBlueprintFiles(root)
        expect(files.map(f => f.name)).toEqual(['ALPHA/a', 'ALPHA/b', 'ZETA/b'])
        expect(files.map(f => f.collection)).toEqual(['ALPHA', 'ALPHA', 'ZETA'])
        expect(files.every(f => fs.existsSync(f.filePath))).toBe(true)
    })

    it('finds the committed corpus clean', () => {
        /*
            Called bare, so this reads test-blueprints/ through the same default
            every spec uses. This is the test that runs in CI on every push and
            so the one that makes a committed stray file fail a PR rather than
            wait for somebody's local Playwright run.

            The count assertion is not decoration: without it a corpus that had
            gone missing entirely would satisfy "did not throw", since an absent
            root returns an empty list by design.
        */
        const files = discoverBlueprintFiles()

        expect(files.length).toBeGreaterThan(0)
        expect(new Set(files.map(f => f.collection))).toEqual(new Set(['EARN', 'JEPAKAZOL']))
    })
})
