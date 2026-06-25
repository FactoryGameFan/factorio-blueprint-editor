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

    const collections = fs
        .readdirSync(TESTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())

    for (const collection of collections) {
        const collectionPath = path.join(TESTS_DIR, collection.name)
        const txtFiles = fs.readdirSync(collectionPath).filter(f => f.endsWith('.txt'))

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
