// Launches the two dev servers the editor needs, together, and ties their
// lifetimes to this process so one Ctrl-C stops both.
//
//   Vite   :8080  the website (packages/website)
//   serve  :8081  the sprite data (packages/exporter/data/output)
//
// The two are separate because in dev Vite proxies /data to 127.0.0.1:8081
// rather than serving the sprite output itself. That proxy target is hardcoded,
// so the sprite server's port is not negotiable - only Vite's is, via --port.
//
// Both ports are checked before anything is spawned. That is the point of the
// script as much as the convenience is: if something else already holds 8080,
// Vite without --strictPort silently falls back to 8081 and then proxies /data
// to itself, which presents as the sprite server failing rather than as a port
// clash. Here it is a named error before either server starts.
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SPRITE_PORT = 8081

export function parseArgs(argv) {
    const i = argv.indexOf('--port')
    if (i === -1) return { port: 8080 }

    const raw = argv[i + 1]
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--port wants an integer from 1 to 65535, got ${raw ?? '(nothing)'}`)
    }
    return { port }
}

// Probes by connecting rather than by binding, and checks both loopback
// families. Vite binds localhost, which on macOS is ::1 only - a bind probe
// against 127.0.0.1 succeeds while Vite is running and would report the port
// free, which is the one answer this check must never give.
function isHostFree(port, host) {
    return new Promise(resolve => {
        const socket = connect({ port, host })
        const done = free => {
            socket.destroy()
            resolve(free)
        }
        socket.setTimeout(500)
        socket.once('connect', () => done(false))
        socket.once('timeout', () => done(false)) // Answering slowly still means occupied.
        socket.once('error', e => done(e.code === 'ECONNREFUSED' || e.code === 'EADDRNOTAVAIL'))
    })
}

/** True when nothing is listening on the port, on either loopback family. */
export async function isPortFree(port) {
    const results = await Promise.all(['127.0.0.1', '::1'].map(host => isHostFree(port, host)))
    return results.every(Boolean)
}

const children = []
let shuttingDown = false

// Each child is spawned into its own process group so the whole group can be
// signalled. `npx serve` in particular is a wrapper - killing the npx pid on
// its own leaves the real server holding 8081, which makes the next run fail
// the port check for a server this script started.
function start(name, command, args, cwd) {
    const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })

    const prefix = line => `[${name}] ${line}`
    const pipe = (stream, out) => {
        let buffered = ''
        stream.setEncoding('utf8')
        stream.on('data', chunk => {
            buffered += chunk
            const lines = buffered.split('\n')
            buffered = lines.pop() ?? ''
            for (const line of lines) out.write(`${prefix(line)}\n`)
        })
        stream.on('end', () => {
            if (buffered) out.write(`${prefix(buffered)}\n`)
        })
    }
    pipe(child.stdout, process.stdout)
    pipe(child.stderr, process.stderr)

    child.on('error', e => {
        console.error(prefix(`failed to start: ${e.message}`))
        shutdown(1)
    })
    // Neither server is meant to exit on its own, so one leaving means the pair
    // is broken - take the other down rather than leave a half-working setup
    // that looks fine until /data 502s.
    child.on('exit', (code, signal) => {
        if (shuttingDown) return
        console.error(prefix(`exited (${signal ?? `code ${code}`}) - stopping the other server`))
        shutdown(code ?? 1)
    })

    children.push({ name, child })
    return child
}

function shutdown(code) {
    if (shuttingDown) return
    shuttingDown = true

    for (const { child } of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        try {
            process.kill(-child.pid, 'SIGTERM')
        } catch {
            // Already gone, or never got a group - nothing to signal.
        }
    }

    // Give them a moment to close their ports, then insist. Without this a
    // server that ignores SIGTERM keeps 8080 or 8081 and the next run fails
    // the port check.
    const timer = setTimeout(() => {
        for (const { child } of children) {
            if (child.exitCode !== null || child.signalCode !== null) continue
            try {
                process.kill(-child.pid, 'SIGKILL')
            } catch {
                // Same.
            }
        }
        process.exit(code)
    }, 3000)
    timer.unref()

    const allDown = () =>
        children.every(({ child }) => child.exitCode !== null || child.signalCode !== null)
    const poll = setInterval(() => {
        if (!allDown()) return
        clearInterval(poll)
        process.exit(code)
    }, 50)
    poll.unref()
}

async function main() {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const { port } = parseArgs(process.argv.slice(2))

    const taken = []
    if (!(await isPortFree(port))) taken.push(`${port} (Vite)`)
    if (!(await isPortFree(SPRITE_PORT))) taken.push(`${SPRITE_PORT} (sprite data)`)
    if (taken.length > 0) {
        console.error(`Port already in use: ${taken.join(', ')}.`)
        console.error('Stop whatever is holding it, or find it with:  lsof -nP -iTCP -sTCP:LISTEN')
        if (taken.some(t => t.startsWith(`${port} `))) {
            console.error(
                `To run Vite elsewhere instead:  npm run localpreview -- --port 8090\n` +
                    `then point the Playwright specs at it with FBE_BASE_URL=http://localhost:8090.`
            )
        }
        if (taken.some(t => t.startsWith(`${SPRITE_PORT} `))) {
            console.error(
                `Port ${SPRITE_PORT} has no alternative - the Vite dev proxy targets it directly.`
            )
        }
        process.exit(1)
    }

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            console.log(`\nStopping both servers...`)
            shutdown(0)
        })
    }

    // Vite first, matching the order in CLAUDE.md, and with --strictPort so a
    // clash that appears between the check above and the bind is still an error
    // rather than a silent fallback.
    start(
        'vite',
        'vp',
        ['dev', '--port', String(port), '--strictPort'],
        join(repoRoot, 'packages/website')
    )
    // --yes so a machine without `serve` cached installs it instead of sitting
    // on an install prompt that never gets answered.
    start(
        'sprites',
        'npx',
        [
            '--yes',
            'serve',
            join(repoRoot, 'packages/exporter/data/output'),
            '-l',
            String(SPRITE_PORT),
            '--cors',
        ],
        repoRoot
    )

    console.log(`Editor:      http://localhost:${port}`)
    console.log(`Sprite data: http://localhost:${SPRITE_PORT}`)
    if (port !== 8080) {
        console.log(`\nPlaywright:  FBE_BASE_URL=http://localhost:${port} npx playwright test`)
    }
    console.log(`\nCtrl-C stops both.\n`)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
    main().catch(e => {
        console.error(e.message)
        process.exit(1)
    })
}
