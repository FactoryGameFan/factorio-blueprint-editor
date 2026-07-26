import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { parseArgs, isPortFree } from './localpreview.mjs'

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
