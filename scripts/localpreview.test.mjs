import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { parseArgs, viteArgs, isPortFree } from './localpreview.mjs'

/** Listens on one loopback family and resolves the port it got. */
function listenOn(host) {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, host, () => resolve({ server, port: server.address().port }))
    })
}

const close = server => new Promise(resolve => server.close(resolve))

test('parseArgs defaults Vite to 8080', () => {
    assert.deepEqual(parseArgs([]), { port: 8080 })
})

test('parseArgs reads --port', () => {
    assert.deepEqual(parseArgs(['--port', '8090']), { port: 8090 })
})

test('parseArgs rejects a non-port rather than silently defaulting', () => {
    // Silently falling back to 8080 here would start Vite on a port the caller
    // did not ask for and then report success, which is the same class of
    // confusion the port check exists to prevent.
    assert.throws(() => parseArgs(['--port', 'lol']), /wants an integer/)
    assert.throws(() => parseArgs(['--port']), /wants an integer/)
    assert.throws(() => parseArgs(['--port', '70000']), /wants an integer/)
})

test('parseArgs rejects an argument it does not recognise', () => {
    /*
        Same class again, one step further out. Only --port was ever read, so
        anything else was dropped and the run still reported success. --host is
        the one that cost a test session: it reads like it would reach Vite,
        it does not, and nothing said so.
    */
    assert.throws(() => parseArgs(['--host']), /Unknown argument/)
    assert.throws(() => parseArgs(['--prot', '8090']), /Unknown argument/)
})

test('isPortFree is true for a port nothing is listening on', async () => {
    // Bind and release to get a port the OS just confirmed is assignable.
    const { server, port } = await listenOn('127.0.0.1')
    await close(server)
    assert.equal(await isPortFree(port), true)
})

test('isPortFree is false for an IPv4 listener', async () => {
    const { server, port } = await listenOn('127.0.0.1')
    try {
        assert.equal(await isPortFree(port), false)
    } finally {
        await close(server)
    }
})

test('isPortFree is false for an IPv6-only listener', async () => {
    /*
        The case that motivated probing both families. Vite binds localhost,
        which on macOS resolves to ::1 alone, so a check that only looked at
        127.0.0.1 reported the port free while Vite was holding it - and the
        script would then launch a second Vite that loses the bind, or worse
        fall through to the silent-fallback behaviour the check exists to stop.
    */
    const { server, port } = await listenOn('::1')
    try {
        assert.equal(await isPortFree(port), false)
    } finally {
        await close(server)
    }
})

test('viteArgs leaves Vite on loopback for a run on the host', () => {
    assert.deepEqual(viteArgs(8080, {}), ['dev', '--port', '8080', '--strictPort'])
    assert.deepEqual(viteArgs(8090, {}), ['dev', '--port', '8090', '--strictPort'])
})

test('viteArgs treats a falsey-looking value as off, not on', () => {
    /*
        The gate is `=== '1'`, not truthiness. Every non-empty string is truthy,
        so a bare check made FBE_DEV_HOST=0 bind every interface - the value you
        would pick to disable it. There is no off switch if the only off state is
        "unset", because nothing documents that either.
    */
    for (const off of ['0', 'false', 'no', 'off', '']) {
        assert.deepEqual(
            viteArgs(8080, { FBE_DEV_HOST: off }),
            ['dev', '--port', '8080', '--strictPort'],
            `FBE_DEV_HOST=${JSON.stringify(off)} must not widen the bind`
        )
    }
})

test('viteArgs adds a bare --host when the container asks for one', () => {
    /*
        Bare, with no value, and the assertion pins that. --host on its own
        leaves Vite listening on ::, which answers on both loopback families.
        --host 0.0.0.0 is IPv4 alone and refuses ::1 - and ::1 is what the
        Playwright specs reach, since playwright.config.ts defaults baseURL to
        http://localhost:8080 and localhost resolves ::1 first in the container.
        So the value that looks more permissive would break the test suite.
    */
    assert.deepEqual(viteArgs(8080, { FBE_DEV_HOST: '1' }), [
        'dev',
        '--port',
        '8080',
        '--strictPort',
        '--host',
    ])
})
