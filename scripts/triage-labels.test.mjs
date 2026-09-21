import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import {
    DOMAIN_LABELS,
    MAX_LABELS,
    labelMenu,
    logLines,
    needsTriage,
    parseArgs,
    parseProposal,
    selectLabels,
    oneLine,
    summaryFor,
} from './triage-labels.mjs'

test('the allowlist covers packages/website, not only packages/editor', () => {
    // #446 is why this is asserted rather than assumed. A CSS defect in
    // packages/website/src/index.css had no label that fitted: `editor ui` is
    // scoped to packages/editor/src/UI, so the run correctly proposed nothing
    // and the issue stayed unplaced. Dropping `website` from the list again
    // would reopen that hole silently.
    assert.ok(DOMAIN_LABELS.includes('website'))
    assert.deepEqual(selectLabels(['website'], ['bug']), ['website'])
})

test('needsTriage is true for an issue carrying only a type label', () => {
    // What the bug template gives every contributor issue, and all this
    // workflow exists to finish.
    assert.equal(needsTriage(['bug']), true)
})

test('needsTriage is false once any domain label is present', () => {
    assert.equal(needsTriage(['bug', 'renderer']), false)
})

test('needsTriage is true for an issue with no labels at all', () => {
    assert.equal(needsTriage([]), true)
})

test('selectLabels keeps a proposal that is a domain label', () => {
    assert.deepEqual(selectLabels(['renderer'], ['bug']), ['renderer'])
})

test('selectLabels drops a name that is not on the allowlist', () => {
    // The whole guard against a crafted issue body: a proposal outside this
    // list is discarded here rather than reaching `gh issue edit`. `wontfix`
    // is a real label in this repo and still must not come from a model.
    assert.deepEqual(selectLabels(['wontfix', 'renderer'], []), ['renderer'])
})

test('selectLabels adds nothing once the issue says which area it is about', () => {
    // The gate asks this a minute earlier, and a minute is long enough for
    // someone to label the issue by hand while the model is still reading it.
    // Asking again at the moment of writing is what closes that gap: an issue
    // a person has already placed is not this workflow's to place.
    assert.deepEqual(selectLabels(['editor ui'], ['bug', 'renderer']), [])
})

test('selectLabels drops a repeated proposal', () => {
    assert.deepEqual(selectLabels(['renderer', 'renderer'], []), ['renderer'])
})

test('selectLabels matches case and surrounding space loosely', () => {
    // A model writing `Renderer` means the renderer label. Dropping it would
    // read as the labeller having no opinion, which is a different answer.
    assert.deepEqual(selectLabels([' Renderer '], []), ['renderer'])
})

test('selectLabels caps how many labels one run can add', () => {
    const many = DOMAIN_LABELS.slice(0, MAX_LABELS + 2)
    assert.equal(selectLabels(many, []).length, MAX_LABELS)
})

test('selectLabels returns nothing when there is nothing left to add', () => {
    assert.deepEqual(selectLabels(['renderer'], ['renderer']), [])
})

test('parseProposal reads the labels and reasoning out of the written file', () => {
    const text = '{"labels": ["renderer"], "reasoning": "It is about sprites."}'
    assert.deepEqual(parseProposal(text), {
        labels: ['renderer'],
        reasoning: 'It is about sprites.',
    })
})

test('parseProposal accepts a proposal of no labels', () => {
    assert.deepEqual(parseProposal('{"labels": [], "reasoning": "Cannot tell."}'), {
        labels: [],
        reasoning: 'Cannot tell.',
    })
})

test('parseProposal throws rather than treating an unreadable file as empty', () => {
    // A model that wrote prose instead of JSON, or wrote nothing, is a broken
    // run. Reading that as "no labels" would leave a green tick over it.
    assert.throws(() => parseProposal('I could not decide!'), /not JSON/)
    assert.throws(() => parseProposal('{"reasoning": "x"}'), /labels/)
    assert.throws(() => parseProposal('{"labels": [7], "reasoning": "x"}'), /labels/)
})

test('labelMenu describes each allowed label with the repo description', () => {
    const fromGitHub = [
        { name: 'renderer', description: 'PixiJS drawing, sprites, overlays' },
        { name: 'placement', description: 'PositionGrid, paste, collision' },
    ]
    assert.deepEqual(labelMenu(fromGitHub), [
        '- placement: PositionGrid, paste, collision',
        '- renderer: PixiJS drawing, sprites, overlays',
    ])
})

test('labelMenu leaves out a label the model may not apply', () => {
    // The prompt offers exactly what selectLabels would accept. Offering
    // `bug` and then dropping it wastes a decision the run already made.
    const fromGitHub = [
        { name: 'bug', description: "Something isn't working" },
        { name: 'renderer', description: 'PixiJS drawing' },
    ]
    assert.deepEqual(labelMenu(fromGitHub), ['- renderer: PixiJS drawing'])
})

test('labelMenu still offers a label whose description is empty', () => {
    assert.deepEqual(labelMenu([{ name: 'project', description: null }]), ['- project'])
})

test('summaryFor separates every heading and line with a blank line', () => {
    // Markdown collapses consecutive lines into one paragraph, so without the
    // blanks the job summary renders as a single run-on line and the reasoning
    // stops being readable at a glance - which is the only reason it is there.
    const summary = summaryFor(416, ['renderer'], [], 'It is about sprites.')
    assert.deepEqual(summary.split('\n'), [
        '### Triage of #416',
        '',
        '**Added:** renderer',
        '',
        '**Reasoning:** It is about sprites.',
    ])
})

test('summaryFor names what it dropped and why', () => {
    const summary = summaryFor(416, [], ['wontfix'], 'Tried something silly.')
    assert.match(summary, /\*\*Added:\*\* _nothing_/)
    assert.match(summary, /\*\*Dropped:\*\* wontfix/)
})

test('summaryFor leaves the dropped line out when nothing was dropped', () => {
    assert.doesNotMatch(summaryFor(416, ['renderer'], [], 'x'), /Dropped/)
})

test('oneLine keeps text a stranger wrote on one line', () => {
    // A step's stdout is parsed by the runner for workflow commands, and those
    // are recognised only at the start of a line. Every line logged here is
    // prefixed, so flattening the newlines is what keeps injected text on the
    // prefix's line, where it can only ever be data.
    assert.equal(oneLine('one\n::error::forged'), 'one ::error::forged')
    assert.equal(oneLine('a\r\n\r\nb'), 'a b')
})

test('oneLine strips the control characters a terminal would act on', () => {
    // Asserted as "none are left" rather than as an exact string: whether a
    // stripped character leaves one space or two is incidental, and pinning it
    // would make this test fail for a reason that is not the point.
    const flattened = oneLine('red \u001b[31mhere\u0007')
    assert.doesNotMatch(flattened, /\p{Cc}/u)
    assert.match(flattened, /red\s+\[31mhere/)
})

test('oneLine truncates rather than printing an essay', () => {
    const flattened = oneLine('x'.repeat(500))
    assert.equal(flattened.length, 303)
    assert.match(flattened, /\.\.\.$/)
})

test('logLines reports what was proposed, added, dropped and why', () => {
    assert.deepEqual(logLines(['renderer'], ['renderer'], [], 'It draws things.'), [
        'proposed: renderer',
        'adding:   renderer',
        'because:  It draws things.',
    ])
})

test('logLines leaves the dropped line out when nothing was dropped', () => {
    assert.equal(
        logLines(['renderer'], ['renderer'], [], 'x').some(l => l.startsWith('dropped')),
        false
    )
})

test('logLines says so plainly when there is nothing to add', () => {
    const lines = logLines([], [], [], '')
    assert.ok(lines.includes('adding:   (none)'))
    assert.ok(lines.includes('because:  (no reason given)'))
})

test('logLines cannot be made to emit a second line by a proposal', () => {
    // The proposal file's label names are model output and are not checked for
    // shape before they are logged, so this is the same hazard as the reasoning.
    const lines = logLines(
        ['a\n::add-mask::secret'],
        [],
        ['b\n::error::two'],
        'why\n::error::forged'
    )
    assert.equal(lines.length, 4)
    for (const line of lines) assert.doesNotMatch(line, /\n/)
})

test('summaryFor flattens the reasoning so it cannot forge a heading', () => {
    const summary = summaryFor(1, [], [], 'fine\n### Injected heading')
    assert.equal(summary.split('\n').filter(l => l.startsWith('###')).length, 1)
})

test('parseArgs reads the subcommand and issue number', () => {
    assert.deepEqual(parseArgs(['gate', '--issue', '416']), { command: 'gate', issue: 416 })
    assert.deepEqual(parseArgs(['apply', '--issue', '7']), { command: 'apply', issue: 7 })
})

test('parseArgs rejects an issue number that is not one', () => {
    assert.throws(() => parseArgs(['gate', '--issue', 'null']), /--issue wants/)
    assert.throws(() => parseArgs(['gate', '--issue']), /--issue wants/)
    assert.throws(() => parseArgs(['gate', '--issue', '0']), /--issue wants/)
})

test('parseArgs rejects a subcommand it does not have', () => {
    assert.throws(() => parseArgs(['remove', '--issue', '416']), /gate/)
    assert.throws(() => parseArgs([]), /gate/)
})
