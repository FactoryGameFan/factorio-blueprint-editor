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
 * A step's stdout is parsed for workflow commands. The `::command::` form is
 * recognised only at the start of a line, and every line this script prints
 * has a prefix, so removing newlines keeps an alert's text on that prefix's
 * line as plain data. The legacy `##[command]` form works anywhere in a line,
 * so it is broken up as well.
 * Same approach as oneLine in scripts/triage-labels.mjs.
 */
export function oneLine(text, limit = 300) {
    // The runner also acts on the legacy `##[command]` form anywhere in a
    // line, not just at its start (actions/runner ActionCommand.TryParse uses
    // IndexOf("##[")), so a prefix does not protect it. A zero-width space
    // between `##` and `[` breaks the match and reads the same.
    const flat = String(text ?? '')
        .replaceAll(/\p{Cc}+/gu, ' ')
        .replaceAll('##[', '##\u200b[')
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

/** `path:line`, or `path` when the instance has no line, or a placeholder. */
function locationOf(alert) {
    const where = alert.most_recent_instance?.location
    if (!where?.path) return '(no location)'
    return `${oneLine(where.path)}${where.start_line ? `:${Number(where.start_line)}` : ''}`
}

/** `#2 js/request-forgery critical packages/x.ts:516 https://...` */
export function describeAlert(alert) {
    return [
        `#${Number(alert.number)}`,
        oneLine(alert.rule?.id) || '(no rule id)',
        oneLine(alert.rule?.security_severity_level),
        locationOf(alert),
        oneLine(alert.html_url),
    ].join(' ')
}

/**
 * Text for a markdown table cell. Flattened to one line, then every character
 * markdown acts on is backslash-escaped, so data renders as itself: a `|`
 * cannot open a new cell, a backtick or bracket cannot open a span or a link.
 */
export function cell(text) {
    return oneLine(text).replaceAll(/[\\|`*_[\]()<>!~&]/g, '\\$&')
}

// The only form a summary link is made from. Anything else is shown as plain
// escaped text, so a `)` or a space in a hostile URL cannot end the link early.
const SAFE_URL = /^https:\/\/[^\s()<>|`\\[\]]+$/

/** The step summary: a table, with data kept out of markdown syntax. */
export function summaryFor(branch, gating) {
    if (gating.length === 0) {
        return `### Code scanning\n\nNo open high or critical alerts on \`${oneLine(branch).replaceAll('`', "'")}\`.`
    }
    const rows = gating.map(a => {
        const url = oneLine(a.html_url)
        const label = `#${Number(a.number)}`
        const link = SAFE_URL.test(url) ? `[${label}](${url})` : `${label} ${cell(url)}`
        return `| ${link} | ${cell(a.rule?.id)} | ${cell(a.rule?.security_severity_level)} | ${cell(locationOf(a))} |`
    })
    return [
        '### Code scanning',
        '',
        `${gating.length} open high or critical alert${gating.length === 1 ? '' : 's'} on \`${oneLine(branch).replaceAll('`', "'")}\`:`,
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
 * True only when the failure says the token is not allowed to read alerts,
 * which is the one thing a pull request may skip over. Status alone is not
 * enough: GitHub answers a rate limit with 403 or 429 too ("API rate limit
 * exceeded for ...", "You have exceeded a secondary rate limit"), and treating
 * that as a missing permission would pass the check exactly when GitHub is
 * unavailable. The permission messages GitHub sends are "Resource not
 * accessible by integration" (403), "Advanced Security must be enabled for this
 * repository to use code scanning" (403), "Bad credentials" (401) and "Not
 * Found" (404).
 */
export function isPermissionDenied(message) {
    const text = String(message)
    const status = statusOf(text)
    if (status === undefined || /rate limit|abuse/i.test(text)) return false
    if (status === 401) return /bad credentials|requires authentication/i.test(text)
    if (status === 403) {
        return /not accessible by integration|advanced security|not enabled/i.test(text)
    }
    return status === 404 && /not found/i.test(text)
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
        // GitHub's workflow syntax docs say a pull request from a fork has its
        // write permissions "adjusted to change any write permissions to read
        // only", and that `permissions` can add or remove read permissions for
        // forks. So `security-events: read` should survive and this branch
        // should not fire. It stays as a safety net for the case where it does
        // not (or the token is otherwise refused): the author cannot grant the
        // permission, so blocking their pull request on it is wrong, and the
        // push and dispatch runs, which always have the token, still gate.
        // A rate limit is not that case and fails; see isPermissionDenied.
        if (event === 'pull_request' && isPermissionDenied(e.message)) {
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
            summary: `### Code scanning\n\nCould not list alerts: ${cell(e.message)}`,
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

/**
 * The `gh` arguments for each of the two calls. Exported so a test can pin
 * them: both are easy to get subtly wrong and neither failure is visible in a
 * green run.
 *
 * `alerts` pages through everything, 100 at a time. `analyses` must be ONE call:
 * with `--paginate` and `per_page=1` gh follows every next link, one per
 * analysis ever uploaded, and the repository had 685 pages. That was 690 API
 * calls and over two minutes per run, against a GITHUB_TOKEN limit of 1,000
 * requests an hour.
 */
export function alertsRequest(repo, ref) {
    const query = `state=open&per_page=100&ref=${encodeURIComponent(ref)}`
    return ['api', '--paginate', '--slurp', `repos/${repo}/code-scanning/alerts?${query}`]
}

export function analysesRequest(repo, ref) {
    return ['api', `repos/${repo}/code-scanning/analyses?per_page=1&ref=${encodeURIComponent(ref)}`]
}

// `--slurp` gives an array of pages and a plain call gives the array itself;
// flat() turns either into one list.
function gh(args) {
    try {
        const out = execFileSync('gh', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        return JSON.parse(out).flat()
    } catch (e) {
        // gh puts "gh: <message> (HTTP 403)" on stderr.
        throw new Error(String(e.stderr || e.message).trim(), { cause: e })
    }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
    try {
        const { repo, ref, event } = parseArgs(process.argv.slice(2), process.env)
        const result = check({
            ref,
            event,
            api: {
                alerts: r => gh(alertsRequest(repo, r)),
                hasAnalysis: r => gh(analysesRequest(repo, r)).length > 0,
            },
        })
        for (const line of result.lines) console.log(line)
        if (process.env.GITHUB_STEP_SUMMARY) {
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`)
        }
        process.exit(result.code)
    } catch (e) {
        console.error(oneLine(e.message))
        process.exit(1)
    }
}
