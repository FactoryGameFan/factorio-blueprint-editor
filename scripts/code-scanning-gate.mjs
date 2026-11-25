// The `code-scanning` job in .github/workflows/ci.yml: fails when the default
// branch has an open code-scanning (CodeQL) alert rated high or critical.
//
// Why it exists. A CodeQL js/polynomial-redos alert sat open on the default
// branch for a month, because alerts show up in the Security tab and nowhere
// else, and a pull request's annotations cover only the lines it changes. This
// turns "open and severe" into a red check.
//
// What it judges is the default branch, not the pull request. CodeQL runs from
// GitHub's default setup, a separate run that may not have analysed a pull
// request's merge ref by the time this job starts, so asking about that ref
// would race. The default branch's alerts are always settled. The cost: a
// pull request that fixes an alert still shows red until it merges and CodeQL
// re-analyses the branch. See .github/workflows/README.md.
//
// Usage: node scripts/code-scanning-gate.mjs --repo OWNER/NAME --ref BRANCH
//   --event EVENT_NAME
// All three also read from GITHUB_REPOSITORY, DEFAULT_BRANCH and
// GITHUB_EVENT_NAME, which is how the workflow passes them. `gh` does the
// requests, authenticated by GH_TOKEN.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// `rule.security_severity_level` is the field to read, not `rule.severity`.
// Per GitHub's REST docs for "List code scanning alerts for a repository",
// `severity` is none/note/warning/error (a lint-style grade), while
// `security_severity_level` is low/medium/high/critical, null for a rule that
// is not a security rule. js/polynomial-redos is `warning` and `high` at once,
// so filtering on `severity` would have missed the alert this exists for.
//
// The API's own `severity` query parameter is not used either. It is documented
// as one value, and repeating it keeps only the last (measured 2026-11-24:
// `severity=critical&severity=high` returned alert 1 alone). Every open alert
// is fetched and filtered here instead.
export const GATING_LEVELS = ['critical', 'high']

const RANK = new Map(GATING_LEVELS.map((level, i) => [level, i]))

/**
 * Flattens text that came from the API to one line of printable characters.
 * A step's stdout is parsed for workflow commands, recognised only at the
 * start of a line, and every line this script prints has a prefix, so removing
 * newlines is what keeps an alert's text on that prefix's line as plain data.
 * Same approach as oneLine in scripts/triage-labels.mjs.
 */
export function oneLine(text, limit = 300) {
    const flat = String(text ?? '')
        .replaceAll(/\p{Cc}+/gu, ' ')
        .trim()
    return flat.length > limit ? `${flat.slice(0, limit)}...` : flat
}

/** The open alerts that fail the check, worst first, then by number. */
export function gatingAlerts(alerts) {
    return alerts
        .filter(a => RANK.has(a?.rule?.security_severity_level))
        .sort(
            (a, b) =>
                RANK.get(a.rule.security_severity_level) -
                    RANK.get(b.rule.security_severity_level) || a.number - b.number
        )
}

/** `#2 js/request-forgery critical packages/x.ts:516 https://...` */
export function describeAlert(alert) {
    const where = alert.most_recent_instance?.location
    const place = where?.path
        ? `${oneLine(where.path)}${where.start_line ? `:${Number(where.start_line)}` : ''}`
        : '(no location)'
    return [
        `#${Number(alert.number)}`,
        oneLine(alert.rule?.id) || '(no rule id)',
        oneLine(alert.rule?.security_severity_level),
        place,
        oneLine(alert.html_url),
    ].join(' ')
}

/** The step summary: a table, with data kept out of markdown syntax. */
export function summaryFor(branch, gating) {
    if (gating.length === 0) {
        return `### Code scanning\n\nNo open high or critical alerts on \`${oneLine(branch)}\`.`
    }
    const cell = text => oneLine(text).replaceAll('|', '\\|').replaceAll('`', "'")
    const rows = gating.map(a => {
        const where = a.most_recent_instance?.location
        const place = where?.path ? `${where.path}:${Number(where.start_line ?? 0)}` : '(none)'
        return `| [#${Number(a.number)}](${cell(a.html_url)}) | ${cell(a.rule?.id)} | ${cell(
            a.rule?.security_severity_level
        )} | ${cell(place)} |`
    })
    return [
        '### Code scanning',
        '',
        `${gating.length} open high or critical alert${gating.length === 1 ? '' : 's'} on \`${cell(branch)}\`:`,
        '',
        '| Alert | Rule | Severity | Location |',
        '| --- | --- | --- | --- |',
        ...rows,
    ].join('\n')
}

/** The HTTP status in a `gh api` failure, or undefined. */
export function statusOf(message) {
    const m = /\(HTTP (\d{3})\)/.exec(String(message))
    return m ? Number(m[1]) : undefined
}

/**
 * Decides the outcome. `api` is injected so tests need no network:
 *   api.alerts(ref)     -> array of open alerts, or throws an Error with HTTP in it
 *   api.hasAnalysis(ref)-> boolean, whether CodeQL has analysed the ref at all
 *
 * Returns { code, lines, summary }. Fails closed: anything unexpected is a
 * failure, because a gate that skips itself quietly is the thing being fixed.
 * The one exception is a pull request whose token cannot read alerts (see
 * below), which is a notice, not a failure.
 */
export function check({ ref, event, api }) {
    const branch = ref.replace(/^refs\/heads\//, '')
    const fullRef = `refs/heads/${branch}`

    let alerts
    try {
        alerts = api.alerts(fullRef)
    } catch (e) {
        const status = statusOf(e.message)
        // A pull request from a fork runs with a read-only GITHUB_TOKEN, and
        // GitHub documents no promise that `security-events: read` survives
        // that. The author cannot fix the repository's alerts, so blocking
        // their pull request on a permission they cannot grant is wrong. The
        // push and dispatch runs, which always have the token, still gate.
        if (event === 'pull_request' && (status === 401 || status === 403 || status === 404)) {
            const note = `The token cannot read code-scanning alerts here (HTTP ${status}), so this pull request is not checked. The run on the default branch is.`
            return {
                code: 0,
                lines: [`::notice::Code-scanning check skipped (HTTP ${status})`, note],
                summary: `### Code scanning\n\n${note}`,
            }
        }
        return {
            code: 1,
            lines: [
                `could not list code-scanning alerts for ${oneLine(fullRef)}: ${oneLine(e.message)}`,
            ],
            summary: `### Code scanning\n\nCould not list alerts: ${oneLine(e.message).replaceAll('`', "'")}`,
        }
    }

    const gating = gatingAlerts(alerts)
    const lines = [
        `${alerts.length} open alert${alerts.length === 1 ? '' : 's'} on ${oneLine(fullRef)}, ${gating.length} high or critical`,
    ]

    if (gating.length === 0) {
        // [] is also what the API says for a ref it has never analysed
        // (measured: a branch that does not exist gives [] with status 200), so
        // a renamed default branch would pass for ever. Ask whether anything
        // was analysed, and say so if not. A warning rather than a failure:
        // a new repository with code scanning still starting up is not broken.
        if (!api.hasAnalysis(fullRef)) {
            lines.push(
                `::warning::No code-scanning analysis exists for ${oneLine(fullRef)}, so "no alerts" proves nothing`
            )
        }
        return { code: 0, lines, summary: summaryFor(branch, gating) }
    }

    lines.push('::error::Open high or critical code-scanning alerts on the default branch:')
    for (const alert of gating) lines.push(`  ${describeAlert(alert)}`)
    return { code: 1, lines, summary: summaryFor(branch, gating) }
}

/** Reads `--name value` pairs, falling back to the environment. */
export function parseArgs(argv, env = {}) {
    const get = (name, fallback) => {
        const i = argv.indexOf(`--${name}`)
        return i === -1 ? fallback : argv[i + 1]
    }
    const repo = get('repo', env.GITHUB_REPOSITORY)
    const ref = get('ref', env.DEFAULT_BRANCH)
    const event = get('event', env.GITHUB_EVENT_NAME) ?? ''
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        throw new Error(`--repo wants OWNER/NAME, got ${repo ?? '(nothing)'}`)
    }
    if (!ref) throw new Error('--ref wants the default branch name, got (nothing)')
    return { repo, ref, event }
}

function ghApi(path) {
    try {
        return JSON.parse(
            execFileSync('gh', ['api', '--paginate', '--slurp', path], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            })
        ).flat()
    } catch (e) {
        // gh puts "gh: <message> (HTTP 403)" on stderr.
        throw new Error(String(e.stderr || e.message).trim(), { cause: e })
    }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
    try {
        const { repo, ref, event } = parseArgs(process.argv.slice(2), process.env)
        const base = `repos/${repo}/code-scanning`
        const q = r => encodeURIComponent(r)
        const result = check({
            ref,
            event,
            api: {
                alerts: r => ghApi(`${base}/alerts?state=open&per_page=100&ref=${q(r)}`),
                hasAnalysis: r => ghApi(`${base}/analyses?per_page=1&ref=${q(r)}`).length > 0,
            },
        })
        for (const line of result.lines) console.log(line)
        if (process.env.GITHUB_STEP_SUMMARY) {
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`)
        }
        process.exit(result.code)
    } catch (e) {
        console.error(e.message)
        process.exit(1)
    }
}
