import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { URL } from 'node:url'
import {
    alertsRequest,
    analysesRequest,
    cell,
    check,
    describeAlert,
    gatingAlerts,
    isPermissionDenied,
    oneLine,
    parseArgs,
    statusOf,
    summaryFor,
} from './code-scanning-gate.mjs'

// Shaped like the real response, measured 2026-11-24 against this repository:
// the two alerts open that day. `severity` is the lint-style grade and is
// `warning` for the high one, which is why the gate reads
// `security_severity_level` instead.
const FORGERY = {
    number: 2,
    html_url: 'https://github.com/o/r/security/code-scanning/2',
    rule: { id: 'js/request-forgery', severity: 'error', security_severity_level: 'critical' },
    most_recent_instance: {
        location: { path: 'packages/editor/src/core/bpString.ts', start_line: 516 },
    },
}
const REDOS = {
    number: 1,
    html_url: 'https://github.com/o/r/security/code-scanning/1',
    rule: { id: 'js/polynomial-redos', severity: 'warning', security_severity_level: 'high' },
    most_recent_instance: {
        location: { path: 'packages/editor/src/core/richTextIcons.ts', start_line: 35 },
    },
}
const MEDIUM = {
    number: 3,
    html_url: 'https://github.com/o/r/security/code-scanning/3',
    rule: { id: 'js/some-medium', severity: 'warning', security_severity_level: 'medium' },
}
// A non-security rule: `severity` is set, `security_severity_level` is null.
const LINT = {
    number: 4,
    html_url: 'https://github.com/o/r/security/code-scanning/4',
    rule: { id: 'js/unused-local', severity: 'error', security_severity_level: null },
}

const api = ({ alerts = [], analysed = true, fail } = {}) => ({
    alerts: ref => {
        calls.push(ref)
        if (fail) throw new Error(fail)
        return alerts
    },
    hasAnalysis: () => analysed,
})
let calls = []

test('high and critical alerts fail, worst first, whatever order the API gave', () => {
    const r = check({ ref: 'main', event: 'push', api: api({ alerts: [REDOS, FORGERY] }) })
    assert.equal(r.code, 1)
    const listed = r.lines.filter(l => l.startsWith('  #'))
    assert.deepEqual(listed, [
        '  #2 js/request-forgery critical packages/editor/src/core/bpString.ts:516 https://github.com/o/r/security/code-scanning/2',
        '  #1 js/polynomial-redos high packages/editor/src/core/richTextIcons.ts:35 https://github.com/o/r/security/code-scanning/1',
    ])
    assert.match(r.summary, /2 open high or critical alerts/)
    assert.match(r.summary, /\[#2\]\(https:\/\/github\.com\/o\/r\/security\/code-scanning\/2\)/)
})

test('severity is read from security_severity_level, not from severity', () => {
    // REDOS has severity "warning". Reading that field would pass it.
    assert.deepEqual(
        gatingAlerts([REDOS]).map(a => a.number),
        [1]
    )
})

test('medium, low and non-security alerts do not fail the check', () => {
    const r = check({ ref: 'main', event: 'push', api: api({ alerts: [MEDIUM, LINT] }) })
    assert.equal(r.code, 0)
    assert.match(r.lines[0], /2 open alerts on refs\/heads\/main, 0 high or critical/)
    assert.match(r.summary, /No open high or critical alerts/)
})

test('no alerts passes', () => {
    const r = check({ ref: 'main', event: 'push', api: api() })
    assert.equal(r.code, 0)
    assert.equal(
        r.lines.some(l => l.startsWith('::')),
        false
    )
})

test('asks about the default branch ref, given as a name or as a full ref', () => {
    calls = []
    check({ ref: 'main', event: 'pull_request', api: api() })
    check({ ref: 'refs/heads/main', event: 'push', api: api() })
    assert.deepEqual(calls, ['refs/heads/main', 'refs/heads/main'])
})

test('an empty answer for a ref that was never analysed warns instead of passing quietly', () => {
    // The API gives [] with status 200 for a branch that does not exist.
    const r = check({ ref: 'renamed', event: 'push', api: api({ analysed: false }) })
    assert.equal(r.code, 0)
    assert.ok(r.lines.some(l => l.startsWith('::warning::No code-scanning analysis')))
})

test('a pull request whose token cannot read alerts is skipped with a notice', () => {
    // The messages GitHub sends for a missing permission.
    for (const message of [
        'gh: Bad credentials (HTTP 401)',
        'gh: Resource not accessible by integration (HTTP 403)',
        'gh: Advanced Security must be enabled for this repository to use code scanning. (HTTP 403)',
        'gh: Not Found (HTTP 404)',
    ]) {
        const r = check({ ref: 'main', event: 'pull_request', api: api({ fail: message }) })
        assert.equal(r.code, 0, message)
        assert.ok(r.lines[0].startsWith('::notice::'), message)
    }
})

test('a rate limit fails a pull request: it is not a missing permission', () => {
    for (const message of [
        'gh: API rate limit exceeded for installation ID 1. (HTTP 403)',
        'gh: You have exceeded a secondary rate limit. Please wait a few minutes (HTTP 403)',
        'gh: Too Many Requests (HTTP 429)',
        'gh: API rate limit already exceeded for user ID 1. (HTTP 429)',
    ]) {
        assert.equal(isPermissionDenied(message), false, message)
        const r = check({ ref: 'main', event: 'pull_request', api: api({ fail: message }) })
        assert.equal(r.code, 1, message)
    }
})

test('a rate limit stays a failure even if its text also names a permission phrase', () => {
    // The explicit rate-limit check is what decides this: the permission phrase
    // alone would skip.
    const message =
        'gh: API rate limit exceeded; advanced security calls are not enabled (HTTP 403)'
    assert.equal(isPermissionDenied(message), false)
    assert.equal(isPermissionDenied(message.replace('rate limit', 'quota')), true)
})

test('an error with no HTTP status, or an unrecognised 403, is not a permission error', () => {
    assert.equal(isPermissionDenied('gh: connection refused'), false)
    assert.equal(isPermissionDenied('gh: Forbidden (HTTP 403)'), false)
    assert.equal(isPermissionDenied('gh: Server Error (HTTP 500)'), false)
})

test('the same error on a push or dispatch fails: the gate never skips itself there', () => {
    for (const event of ['push', 'workflow_dispatch', '']) {
        const r = check({
            ref: 'main',
            event,
            api: api({ fail: 'gh: Resource not accessible by integration (HTTP 403)' }),
        })
        assert.equal(r.code, 1, event)
    }
})

test('a server error fails even on a pull request', () => {
    const r = check({
        ref: 'main',
        event: 'pull_request',
        api: api({ fail: 'gh: Service unavailable (HTTP 503)' }),
    })
    assert.equal(r.code, 1)
})

test('the alerts call is open-only, for the ref, 100 a page, and follows every page', () => {
    const [verb, ...flags] = alertsRequest('o/r', 'refs/heads/main')
    const url = flags.pop()
    assert.equal(verb, 'api')
    assert.deepEqual(flags, ['--paginate', '--slurp'])
    const u = new URL(url, 'https://api.github.com/')
    assert.equal(u.pathname, '/repos/o/r/code-scanning/alerts')
    assert.equal(u.searchParams.get('state'), 'open')
    assert.equal(u.searchParams.get('ref'), 'refs/heads/main')
    assert.equal(u.searchParams.get('per_page'), '100')
})

test('the analyses call is a single request: no --paginate, or it follows 685 pages', () => {
    const args = analysesRequest('o/r', 'refs/heads/main')
    assert.equal(args[0], 'api')
    assert.equal(args.length, 2, `no flags allowed, got ${args.join(' ')}`)
    const u = new URL(args[1], 'https://api.github.com/')
    assert.equal(u.pathname, '/repos/o/r/code-scanning/analyses')
    assert.equal(u.searchParams.get('ref'), 'refs/heads/main')
    assert.equal(u.searchParams.get('per_page'), '1')
})

test('a ref is percent-encoded so it cannot add query parameters', () => {
    const url = new URL(alertsRequest('o/r', 'refs/heads/a&state=closed').at(-1), 'https://x/')
    assert.equal(url.searchParams.get('ref'), 'refs/heads/a&state=closed')
    assert.deepEqual(url.searchParams.getAll('state'), ['open'])
})

test('statusOf reads the HTTP code from gh output', () => {
    assert.equal(statusOf('gh: Bad credentials (HTTP 401)'), 401)
    assert.equal(statusOf('something else'), undefined)
})

test('alert text cannot start a workflow command or forge a table row', () => {
    const hostile = {
        number: 9,
        html_url: 'https://x.test/\n::error::forged',
        rule: {
            id: 'js/x\n::add-mask::secret',
            security_severity_level: 'high',
        },
        most_recent_instance: { location: { path: 'a|b`c\r\n::stop-commands::x', start_line: 1 } },
    }
    const r = check({ ref: 'main', event: 'push', api: api({ alerts: [hostile] }) })
    for (const line of r.lines) assert.equal(line.includes('\n'), false)
    // Only the script's own fixed `::` line remains at the start of a line.
    assert.deepEqual(
        r.lines.filter(l => l.startsWith('::')),
        ['::error::Open high or critical code-scanning alerts on the default branch:']
    )
    assert.equal(/\n::/.test(r.summary), false)
    // One row, with exactly four cells: split on unescaped pipes (4 cells and
    // the two outer edges make 6 pieces).
    const rows = r.summary.split('\n').filter(l => l.startsWith('| #'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].split(/(?<!\\)\|/).length, 6)
    assert.ok(rows[0].includes('a\\|b'), 'the pipe in the path is escaped')
    assert.doesNotMatch(rows[0], /(?<!\\)`/, 'a backtick cannot open a code span')
    assert.doesNotMatch(describeAlert(hostile), /[\n\r]/)
})

test('alert text cannot carry a legacy ##[ command, which works anywhere in a line', () => {
    // The runner finds `##[command]` with IndexOf, so the `  #9 ...` prefix on
    // each logged line does not protect it.
    const hostile = {
        number: 9,
        html_url: 'https://x.test/##[warning]forged',
        rule: { id: 'js/##[add-mask]x', security_severity_level: 'high' },
        most_recent_instance: { location: { path: 'src/##[error]forged.ts', start_line: 1 } },
    }
    const r = check({ ref: 'main', event: 'push', api: api({ alerts: [hostile] }) })
    for (const line of r.lines) assert.doesNotMatch(line, /##\[/)
    assert.doesNotMatch(describeAlert(hostile), /##\[/)
    assert.equal(oneLine('src/##[error]x.ts'), 'src/##​[error]x.ts')
})

test('a URL that could end a markdown link early is shown as text, not linked', () => {
    const base = { number: 5, rule: { id: 'r', security_severity_level: 'high' } }
    for (const url of [
        'https://x.test/a)(https://evil.test',
        'https://x.test/a b',
        'javascript:x',
    ]) {
        const summary = summaryFor('main', [{ ...base, html_url: url }])
        assert.equal(summary.includes(']('), false, url)
    }
    const ok = summaryFor('main', [{ ...base, html_url: 'https://x.test/security/2' }])
    assert.ok(ok.includes('[#5](https://x.test/security/2)'))
})

test('cell escapes the characters markdown acts on', () => {
    assert.equal(cell('a|b'), 'a\\|b')
    assert.equal(cell('[x](y) *z* _w_ <i> `c`'), '\\[x\\]\\(y\\) \\*z\\* \\_w\\_ \\<i\\> \\`c\\`')
})

test('a missing line number reads the same in the log and the summary', () => {
    const noLine = { ...REDOS, most_recent_instance: { location: { path: 'src/a.ts' } } }
    assert.match(describeAlert(noLine), / src\/a\.ts https:/)
    const summary = summaryFor('main', [noLine])
    assert.ok(summary.includes('| src/a.ts |'))
    assert.equal(summary.includes(':0'), false)
})

test('oneLine flattens control characters and truncates', () => {
    assert.equal(oneLine('a\nb\u001b[31mc'), 'a b [31mc')
    assert.equal(oneLine('x'.repeat(10), 5), 'xxxxx...')
    assert.equal(oneLine(null), '')
})

test('summaryFor says so when there is nothing to list', () => {
    assert.match(summaryFor('main', []), /No open high or critical alerts on `main`/)
})

test('parseArgs takes flags first, then the environment, and refuses a bad repo', () => {
    const env = {
        GITHUB_REPOSITORY: 'o/r',
        DEFAULT_BRANCH: 'main',
        GITHUB_EVENT_NAME: 'push',
    }
    assert.deepEqual(parseArgs([], env), { repo: 'o/r', ref: 'main', event: 'push' })
    assert.deepEqual(parseArgs(['--ref', 'dev', '--event', 'pull_request'], env), {
        repo: 'o/r',
        ref: 'dev',
        event: 'pull_request',
    })
    assert.throws(() => parseArgs([], { DEFAULT_BRANCH: 'main' }), /--repo/)
    assert.throws(() => parseArgs(['--repo', 'a b/c'], env), /--repo/)
    assert.throws(() => parseArgs([], { GITHUB_REPOSITORY: 'o/r' }), /--ref/)
})
