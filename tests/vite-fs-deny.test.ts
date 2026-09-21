import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
    packages/website/vite.config.js sets server.fs.deny, and Vite REPLACES that
    array rather than merging it - mergeWithDefaultsRecursively assigns any
    non-plain-object value straight over the default, and an array is not a
    plain object. So writing only the entry we care about would silently delete
    Vite's own protections, including the one on `.env`. Measured against a real
    dev server: with the defaults repeated, `.env` and `.dev.vars` both 403 and
    package.json still 200; with the block absent, `.dev.vars` returned 200.

    This reads the config as text rather than importing it, because importing it
    pulls in the plugin graph for a question that is about a literal list.
*/
// Resolved from the repo root, which is where the `unit` project in the root
// vite.config.ts puts the working directory.
const config = readFileSync(resolve(process.cwd(), 'packages/website/vite.config.js'), 'utf8')

const VITE_DEFAULT_DENY = [
    '.env',
    '.env.*',
    '*.{crt,pem,key,p12,pfx,cer,der}',
    '.npmrc',
    '.yarnrc.yml',
    '**/.git/**',
]

function denyList(): string[] {
    const block = /fs:\s*\{[\s\S]*?deny:\s*\[([\s\S]*?)\]/.exec(config)
    assert.ok(block, 'server.fs.deny not found in packages/website/vite.config.js')
    return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

test('server.fs.deny still repeats every Vite default', () => {
    const deny = denyList()
    for (const pattern of VITE_DEFAULT_DENY) {
        assert.ok(
            deny.includes(pattern),
            `${pattern} is one of Vite's own deny defaults. Setting server.fs.deny ` +
                `replaces the default array instead of merging with it, so dropping ` +
                `this line stops denying it. Re-check against Vite's ` +
                `_serverConfigDefaults on a toolchain bump.`
        )
    }
})

test('server.fs.deny covers .dev.vars, which Vite does not', () => {
    assert.ok(
        denyList().some(p => p.startsWith('.dev.vars')),
        '.gitignore treats .dev.vars as secret (wrangler dev keeps local Worker ' +
            'secrets there) and Vite has no default for it, so the dev server would ' +
            'serve the file.'
    )
})
