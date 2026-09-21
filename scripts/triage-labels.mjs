// The write half of .github/workflows/issue-triage.yml: decides whether a new
// issue needs a domain label, and applies the ones a Claude run proposed.
//
// Claude never touches the issue itself. It reads the issue and writes its
// proposal to a file; this script validates that file and calls `gh`. The
// split is the security boundary. Issue bodies on a public repository are
// text a stranger wrote, and they reach the model as tool output, so a crafted
// one can try to talk the model into anything the model's tools allow. Here
// the model's tools cannot reach GitHub at all, and the worst a successful
// injection achieves is a wrong label from the list below - which is also the
// worst a plainly mistaken run achieves.
//
// Two subcommands, both taking --issue:
//
//   gate    writes needs-triage=true|false to $GITHUB_OUTPUT. False when the
//           issue already carries a domain label, which is the common case:
//           `gh issue create --label` applies them about two seconds after the
//           issue exists, well before a runner has finished booting.
//   apply   reads PROPOSAL_FILE, keeps what survives selectLabels, and adds it
//           with `gh issue edit`. Add only. Nothing here removes a label,
//           closes anything, or posts a comment.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The domain half of this repository's labels: which part of the editor an
// issue is about. The type half (bug, enhancement, documentation, question)
// is deliberately absent - both issue templates already set one, so a model
// choosing type would only ever contradict the person filing. The triage
// verdicts (duplicate, wontfix, invalid) and the recruiting labels (good first
// issue, help wanted) are absent for a stronger reason: they are judgements
// about work this repository has not done yet, not descriptions of the text.
export const DOMAIN_LABELS = [
    'blueprint data',
    'build & deploy',
    'editor ui',
    'factorio data',
    'measurement',
    'placement',
    'project',
    'renderer',
    'security',
    'test coverage',
    'test suite',
    'toolchain',
]

// An issue is about one area, occasionally two. A run proposing more than this
// has not narrowed anything down, and a wall of labels is harder to undo than
// a missing one.
export const MAX_LABELS = 3

// Where the Claude step leaves its proposal, relative to the workspace root.
// The prompt in .github/workflows/issue-triage.yml names the same path.
export const PROPOSAL_FILE = 'triage-labels.json'

// Where `gate` leaves the issue for the Claude step to read. Handing it the
// text this way is what lets that step run with no Bash tool at all: it never
// needs to reach GitHub, so an injected instruction has nothing to reach it
// with. The file holds the same stranger-written text either way - the
// difference is what is available to act on it.
export const ISSUE_FILE = 'issue.json'

const normalize = name => String(name).trim().toLowerCase()

/** True when none of the issue's current labels says which area it is about. */
export function needsTriage(currentLabels) {
    const current = new Set(currentLabels.map(normalize))
    return !DOMAIN_LABELS.some(label => current.has(label))
}

/**
 * The labels worth adding: on the allowlist, no repeats, capped. Everything
 * else is dropped silently here and reported by `apply`.
 *
 * The first line is the same question the gate asks, asked again at the moment
 * of writing. A model run takes a minute or so, which is long enough for
 * someone to label the issue by hand in between, and an issue a person has
 * already placed is not this workflow's to place. Asking in one place only
 * would leave that gap open; asking in both closes it - and it is why there is
 * no separate "already carries this label" filter below. Once any domain label
 * is present nothing is added at all, so that filter could never fire.
 */
export function selectLabels(proposed, currentLabels) {
    if (!needsTriage(currentLabels)) return []

    const allowed = new Set(DOMAIN_LABELS)
    const chosen = []

    for (const raw of proposed) {
        const label = normalize(raw)
        if (!allowed.has(label)) continue
        if (chosen.includes(label)) continue
        chosen.push(label)
        if (chosen.length === MAX_LABELS) break
    }
    return chosen
}

/**
 * Reads the proposal file. Throws on anything malformed rather than reading it
 * as an empty proposal: a run whose model wrote prose, or wrote nothing, is a
 * broken run and should show as one instead of as a quiet no-op.
 */
export function parseProposal(text) {
    let parsed
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error(`${PROPOSAL_FILE} is not JSON`)
    }
    const labels = parsed?.labels
    if (!Array.isArray(labels) || labels.some(l => typeof l !== 'string')) {
        throw new Error(`${PROPOSAL_FILE} needs a "labels" array of strings`)
    }
    return { labels, reasoning: String(parsed.reasoning ?? '') }
}

/**
 * The menu the prompt offers, built from the repository's own label
 * descriptions and filtered to DOMAIN_LABELS. Built rather than written into
 * the workflow so the allowlist above stays the only copy of these names: a
 * prompt offering a label `selectLabels` would drop spends a decision for
 * nothing, and the two lists drift apart the first time one is edited alone.
 */
export function labelMenu(ghLabels) {
    const described = new Map(ghLabels.map(l => [l.name, l.description]))
    return DOMAIN_LABELS.filter(name => described.has(name)).map(name => {
        const description = described.get(name)
        return description ? `- ${name}: ${description}` : `- ${name}`
    })
}

/**
 * Flattens text that reached us from the model, and so at one remove from a
 * stranger's issue, to a single line of printable characters.
 *
 * A step's stdout is parsed by the runner for workflow commands, and those are
 * recognised only at the start of a line. Every line below is prefixed, so
 * removing the newlines is what keeps injected text on the prefix's line where
 * it can only be data. The same flattening stops an escape sequence reaching a
 * terminal reading the log, and stops a heading forging one in the summary.
 */
export function oneLine(text, limit = 300) {
    // \p{Cc} is the Unicode control category, which is every character a
    // terminal or the runner would act on rather than print. Written this way
    // there is no control character in this file for a reader or a linter to
    // trip over, and it covers the C1 range an explicit \u0000-\u001f misses.
    const flat = String(text)
        .replaceAll(/\p{Cc}+/gu, ' ')
        .trim()
    return flat.length > limit ? `${flat.slice(0, limit)}...` : flat
}

/**
 * What the run did, for the step log. `added` is already known to be on the
 * allowlist; `proposed`, `dropped` and `reasoning` are not checked for shape
 * anywhere, which is why every one of them goes through oneLine.
 */
export function logLines(proposed, added, dropped, reasoning) {
    const lines = [
        `proposed: ${oneLine(proposed.join(', ')) || '(none)'}`,
        `adding:   ${oneLine(added.join(', ')) || '(none)'}`,
    ]
    if (dropped.length > 0) lines.push(`dropped:  ${oneLine(dropped.join(', '))}`)
    lines.push(`because:  ${oneLine(reasoning) || '(no reason given)'}`)
    return lines
}

/**
 * What the run did, for the job summary. This is the only record of why a
 * label was chosen, and of what was proposed and refused, so it is worth
 * reading: the blank lines are load-bearing, since markdown runs consecutive
 * lines together into one paragraph.
 */
export function summaryFor(issue, added, dropped, reasoning) {
    const lines = [`### Triage of #${issue}`, '', `**Added:** ${added.join(', ') || '_nothing_'}`]
    if (dropped.length > 0) {
        lines.push(
            '',
            `**Dropped:** ${oneLine(dropped.join(', '))} (not an allowed domain label, or the issue already had its area set)`
        )
    }
    lines.push('', `**Reasoning:** ${oneLine(reasoning) || '_none given_'}`)
    return lines.join('\n')
}

export function parseArgs(argv) {
    const command = argv[0]
    if (command !== 'gate' && command !== 'apply') {
        throw new Error(`wants a subcommand, gate or apply, got ${command ?? '(nothing)'}`)
    }

    const i = argv.indexOf('--issue')
    const raw = i === -1 ? undefined : argv[i + 1]
    const issue = Number(raw)
    if (!Number.isInteger(issue) || issue < 1) {
        throw new Error(`--issue wants a positive integer, got ${raw ?? '(nothing)'}`)
    }
    return { command, issue }
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8' })

/** The issue's labels as GitHub has them now, not as the event payload had them. */
function currentLabels(issue) {
    const json = gh(['issue', 'view', String(issue), '--json', 'labels'])
    return JSON.parse(json).labels.map(l => l.name)
}

function writeOutput(line) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
}

// A random delimiter because that is the documented form for a multi-line
// step output: a fixed one can be closed early by a value that happens to
// contain it, and whatever follows is then read as more outputs.
function writeBlockOutput(name, value) {
    const delimiter = `EOF_${randomUUID()}`
    writeOutput(`${name}<<${delimiter}\n${value}\n${delimiter}`)
}

function writeSummary(markdown) {
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
    }
}

function gate(issue) {
    const current = currentLabels(issue)
    const needed = needsTriage(current)
    console.log(`#${issue} has [${current.join(', ')}] - needs triage: ${needed}`)
    writeOutput(`needs-triage=${needed}`)
    if (!needed) return

    const issueJson = gh(['issue', 'view', String(issue), '--json', 'number,title,body,author'])
    writeFileSync(ISSUE_FILE, issueJson)

    const all = JSON.parse(gh(['label', 'list', '--json', 'name,description', '--limit', '200']))
    const menu = labelMenu(all)
    console.log(`offering:\n${menu.join('\n')}`)
    writeBlockOutput('labels', menu.join('\n'))
}

function apply(issue) {
    const { labels, reasoning } = parseProposal(readFileSync(PROPOSAL_FILE, 'utf8'))
    const current = currentLabels(issue)
    const chosen = selectLabels(labels, current)
    const dropped = labels.filter(l => !chosen.includes(normalize(l)))

    // The `because:` line is here and not only in the job summary below.
    // GitHub exposes a step summary in the web UI and through no API at all -
    // not the checks API, which returns an empty `output.summary` for an
    // Actions job - so without it the only account of why a label was chosen
    // cannot be read with `gh run view --log`.
    for (const line of logLines(labels, chosen, dropped, reasoning)) console.log(line)

    if (chosen.length > 0) {
        gh(['issue', 'edit', String(issue), ...chosen.flatMap(l => ['--add-label', l])])
    }

    writeSummary(summaryFor(issue, chosen, dropped, reasoning))
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
    try {
        const { command, issue } = parseArgs(process.argv.slice(2))
        if (command === 'gate') gate(issue)
        else apply(issue)
    } catch (e) {
        console.error(e.message)
        process.exit(1)
    }
}
