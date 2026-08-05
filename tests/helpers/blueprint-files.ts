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

const TESTS_DIR = path.resolve(process.cwd(), 'wormeyman-tests')

export function discoverBlueprintFiles(): BlueprintFile[] {
    const files: BlueprintFile[] = []

    if (!fs.existsSync(TESTS_DIR)) {
        return files
    }

    /*
        Sorted explicitly rather than left to readdirSync. Directory order is a
        filesystem property - APFS and ext4 both return hash order, not name
        order - and blueprint-round-trip.spec.ts folds the corpus into a single
        serializedHash in iteration order. Unsorted, that fixture is a fixed
        point only on the machine that recorded it, which is the one thing a
        committed corpus must not be.
    */
    const collections = fs
        .readdirSync(TESTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const collection of collections) {
        const collectionPath = path.join(TESTS_DIR, collection.name)
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
