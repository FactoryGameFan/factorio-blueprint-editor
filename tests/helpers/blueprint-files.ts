import * as fs from 'fs'
import * as path from 'path'

export interface BlueprintFile {
    /** Display name, e.g. "EARN/quick-start-v22-0-11" */
    name: string
    /** Absolute path to the .txt file */
    filePath: string
    /** Collection folder name, e.g. "EARN" */
    collection: string
}

const TESTS_DIR = path.resolve(process.cwd(), 'test-blueprints')

/**
 * Every `.txt` in `test-blueprints/{collection}/`, sorted.
 *
 * `root` exists so blueprint-files.test.ts can point this at a directory it
 * built, rather than writing a stray file into the committed corpus and relying
 * on cleanup it might not reach. Every caller in tests/ passes nothing.
 *
 * @throws if `root` holds a `.txt` directly. See the comment on that check.
 */
export function discoverBlueprintFiles(root: string = TESTS_DIR): BlueprintFile[] {
    const files: BlueprintFile[] = []

    if (!fs.existsSync(root)) {
        return files
    }

    const entries = fs.readdirSync(root, { withFileTypes: true })

    /*
        A blueprint sitting at the top level is read by nothing, and until #190
        it was also *reported* by nothing - this walked one level down and a
        stray file simply did not exist as far as the suite was concerned.

        That silence has already cost something. The old corpus carried
        wormeyman-tests/a.txt, 368 blueprints that no spec ever loaded but that a
        hand measurement of the directory counted, which is where
        pre-2-0-shape-migrations.spec.ts got "1452 control_behavior sections"
        against a discovered corpus holding 1295. The 157 difference was exactly
        that file, and the figure sat wrong until #186 re-measured it.

        Throwing rather than adopting the file is the louder answer and the right
        one now that test-blueprints/ is committed and public: the point of #186
        is that a fresh clone and the specs see the same corpus, and a file that
        only one of them can see breaks that quietly. A contributor who drops one
        here gets told where it belongs instead of silently getting no coverage.
    */
    const stray = entries
        .filter(d => d.isFile() && d.name.endsWith('.txt'))
        .map(d => d.name)
        .sort((a, b) => a.localeCompare(b))

    if (stray.length > 0) {
        throw new Error(
            `${stray.length} blueprint file(s) sit directly in ${root} and so are read by no spec: ` +
                `${stray.join(', ')}. Blueprints live in ` +
                `${path.basename(root)}/<collection>/<name>.txt - move each one into a ` +
                `collection folder, or delete it.`
        )
    }

    /*
        Sorted explicitly rather than left to readdirSync. Directory order is a
        filesystem property - APFS and ext4 both return hash order, not name
        order - and blueprint-round-trip.spec.ts folds the corpus into a single
        serializedHash in iteration order. Unsorted, that fixture is a fixed
        point only on the machine that recorded it, which is the one thing a
        committed corpus must not be.
    */
    const collections = entries
        .filter(d => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const collection of collections) {
        const collectionPath = path.join(root, collection.name)
        const txtFiles = fs
            .readdirSync(collectionPath)
            .filter(f => f.endsWith('.txt'))
            .sort((a, b) => a.localeCompare(b))

        for (const txtFile of txtFiles) {
            const baseName = txtFile.replace(/\.txt$/, '')
            files.push({
                name: `${collection.name}/${baseName}`,
                filePath: path.join(collectionPath, txtFile),
                collection: collection.name,
            })
        }
    }

    return files
}

export function readBlueprintString(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8').trim()
}
