# Hard fork: becoming FactoryGameFan/factorio-blueprint-editor

Detach this repository from `teoxoy/factorio-blueprint-editor`, move it into a
`FactoryGameFan` organization, and rebrand it as a project in its own right.

## The problem

Other projects are switching to this copy and pull requests are arriving, but
GitHub still models it as someone else's fork. That is not a matter of framing -
`fork: true` has mechanical consequences, and they are the actual complaint:

- **Forks are excluded from GitHub repository search and from topic listings.**
  So the only way anyone finds this repo is by being told about it.
- **Pull requests default to the parent's base branch**, which is a trap for a
  first-time contributor who does not notice.
- Insights, discussions and the fork network all read as belonging upstream.

Three smaller leaks compound it, each one actively misdirecting somebody:

- `packages/editor/package.json` declares `author: "Teoxoy"`, and points
  `repository`, `homepage` and `bugs` at `github.com/Teoxoy/...`. The `bugs`
  field sends bug reports to a tracker with 38 open issues and no maintainer.
- The README's Discord badge points at upstream's server, whose maintainer left.
- The default branch is `wormeyman-space-age-support`, which names one person and
  one DLC, and needs a paragraph of explanation in both `README.md` and
  `CONTRIBUTING.md`.

## What was measured before deciding

All measured 2026-08-05. Re-derive rather than trust - most of these expire.

**This is not a hostile fork, and the evidence is upstream's own issue tracker.**
`teoxoy/factorio-blueprint-editor#208`, "Looking for maintainer(s)", has been
open and pinned since 2020-03-18. Its body reads "Going forward, I would like to
find at least one person that can help maintain the project." wormeyman commented
on it on 2026-07-30 naming this fork; byalex33 asked "Is this still needed?" on
2026-06-23. Neither has a reply. teoxoy's last comment anywhere in that repo is
2025-10-17, and the last push to `master` is the same day.

So the sequence is: upstream asked for maintainers, someone answered, and upstream
went quiet. Every public document produced by this change should say it that way,
because it is what happened.

**There is nothing to reconcile.** This fork is **399 commits ahead of
`upstream/master` and 0 behind** - a strict superset. A hard fork here is a
detachment, not a divergence, and no merge or cherry-pick strategy is needed.

**What each side holds:**

|             | this fork  | upstream                    |
| ----------- | ---------- | --------------------------- |
| Stars       | 5          | 422                         |
| Forks       | 3          | 101                         |
| Open issues | 8          | 38                          |
| Open PRs    | 0          | 1 (#272, opened 2026-05-20) |
| Last push   | 2026-08-04 | 2025-10-17                  |
| Archived    | no         | no                          |

That gap is why the outreach in this design asks for a repository transfer rather
than only for a link: the stars, the forks and the inbound links are worth
substantially more than anything a detach can produce.

**Upstream's Discord is alive even though its maintainer is not.** The invite in
the README (`discord.gg/c5eXyBU`, guild `540738973413408809`) still resolves, to
**968 members with 175 online**. This inverts the obvious plan: standing up a
FactoryGameFan server would start at zero against a live community and the usual
result is that both go quiet.

**Nothing is published to npm.** Both `@fbe/editor` and `factorio-blueprint-editor`
return 404 from the registry. The `@fbe/` scope is internal to this monorepo, so
renaming it has no ecosystem consequence in either direction.

**The deploy has two secrets and no branch protection.** `.github/workflows/ci.yml`
has a `deploy` job gated on green checks that uses `secrets.CLOUDFLARE_API_TOKEN`
and `secrets.CLOUDFLARE_ACCOUNT_ID`, both set 2026-06-25. The default branch has
no protection rules at all.

**The org exists.** `FactoryGameFan` was created 2026-08-05T18:30:41Z, free plan,
0 repositories, with wormeyman as an active admin. `factorygamefan` and
`factory-game-fan` were also free at that moment and were not claimed.

## Decisions

### Detach through GitHub Support, then transfer

Ask GitHub Support to detach the fork - convert it to a standalone repository -
then transfer it into `FactoryGameFan`. **In that order.** A transfer first would
leave the support ticket naming a repository that has moved.

Detaching keeps the URL, the 5 stars, all 8 open issues, the 86 merged pull
requests and the entire history, and flips `fork` to false so the repo becomes
searchable. The alternative - a fresh repository - is immediate but forfeits all
of that and breaks every existing link and the 3 downstream forks.

**One thing to ask Support rather than assume:** what happens to the three
existing forks of this repository (`byalex33`, `olafrose`, `seesee010`) when it
leaves the network. This design does not assert an answer.

### One outreach comment, no email, and nothing waits on it

Post a single comment on upstream #208 that states the intent plainly, asks for a
transfer of `teoxoy/factorio-blueprint-editor` into the org as the preferred
outcome, and names a date after which the fork proceeds independently. **No
email** - the issue is the channel the request was made on, and it is public, so
the record is visible to the community that has been waiting on it.

Everything this repository controls proceeds on its own schedule regardless. A
project that has been asking for maintainers since 2020 and has not spoken since
October cannot be a blocker. If teoxoy does answer with a transfer, that outcome
is strictly better than the detach and supersedes it.

The comment is a message to another person, so it goes through the `humanizer`
skill before it is posted, and wormeyman posts it - not the agent.

### GitHub Discussions, and the Discord badge goes

Enable Discussions on the repository; remove the Discord badge from the README.

This forfeits direct reach to 968 Factorio players, which is a real cost and is
recorded here as one. What it buys is a surface that is owned, moderated, indexed
by the same search that is about to start finding the repository, and adjacent to
the issues. The alternative - keeping a badge that points into a server where
nobody can act on what is said - trades a solvable problem for an unsolvable one.

### Deferred: renaming the default branch

`wormeyman-space-age-support` should become `main`, and the stale `master` branch
that tracks upstream should be deleted. Both are deliberately **not** in this
change. The rename touches `ci.yml`, the Cloudflare deploy gate, `CLAUDE.md`,
`CONTRIBUTING.md`, `README.md` and several plan documents, and isolating that risk
into its own reviewable PR is worth the second disruption to contributors.

## Judgment calls, recorded so they can be reversed knowingly

- **The repository name stays `factorio-blueprint-editor`.** It is what people
  search for.
- **The `@fbe/` package scope stays.** Nothing is published, so a rename is churn
  with no ecosystem benefit, and `fbe` is an abbreviation of the project rather
  than of a person.
- **The Cloudflare worker stays named `fbeworkeyman`.** It carries a personal
  name, and it is the one piece of this that a user could theoretically see - but
  only as the legacy `fbeworkeyman.workers.dev` host, which exists solely to 301
  to `fbe.factorygamefan.com`. Renaming means creating a second worker and moving
  the `custom_domain` route off the live one. That is production risk against a
  hostname that is already deprecated by its own redirect.
- **`packages/editor/package.json` is corrected, not rebranded.** `author`,
  `repository`, `homepage` and `bugs` are changed because they are **wrong** and
  `bugs` misdirects reports, not because of naming.
- **The LICENSE keeps `Copyright (c) 2020 Tanasoaia Teodor Andrei`.** MIT requires
  retaining the notice; this is not a choice. A second copyright line is added for
  the fork alongside it, and the README keeps crediting Teoxoy for building the
  editor this is based on.

## Sequence

Phase 0 is the public blueprint corpus work (#186) landing, since it is in flight
and touches many of the same documents.

| Phase | Action                                                                                                           | Blocking?        |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1     | Post the #208 comment (humanizer pass first). Open the GitHub Support detach ticket. Same day, both asynchronous | no               |
| 2     | Support detaches. Transfer to `FactoryGameFan`. Verify secrets, reinstall Renovate, enable Discussions           | waits on Support |
| 3     | One rebrand commit: package metadata, LICENSE, README, CONTRIBUTING, CLAUDE.md                                   | no               |
| 4     | Announce - repository description, topics, and a note wherever adopters are already pointing                     | no               |
| 5     | Deadline check at week 4. Silence means proceed as the project; a reply offering transfer supersedes the detach  | no               |
| later | Branch rename to `main`, its own PR                                                                              | no               |

## Risks

- **Renovate stops, silently.** GitHub App installations are per-account, so
  after the transfer the app must be installed on `FactoryGameFan` or dependency
  pull requests simply cease. Nothing fails; they just stop arriving. Verify
  explicitly after the transfer rather than waiting to notice.
- **The Cloudflare secrets may not survive the transfer.** This design does not
  assert whether repository Actions secrets are retained. Verify with
  `gh secret list` immediately after, and re-add if absent. Left unchecked, the
  failure surfaces on the next push to the deploy branch, which is late.
- **Ordering.** Detach, then transfer. Not the reverse.
- **Branch protection does not exist**, and an org with more than one person who
  can merge wants it. It is a consequence of the org rather than part of the fork,
  so it is noted rather than scheduled.
- **The `?source=` proxy and the custom domain are unaffected** by any of this -
  no DNS, no Cloudflare account, and no worker route changes.

## Verification

- `gh api repos/FactoryGameFan/factorio-blueprint-editor --jq .fork` returns
  `false`, and `.parent` is absent
- The repository appears in a GitHub search for `factorio blueprint editor` that
  does not pass `fork:true`
- `gh secret list` shows both Cloudflare secrets, and a deploy succeeds
- Renovate opens or updates its dependency dashboard issue after the transfer
- `git grep -n "Teoxoy/factorio-blueprint-editor"` returns only the credit lines
  in `README.md` and the historical documents under `docs/superpowers/`
- `wormeyman-space-age-support` still builds and deploys - the branch rename is
  explicitly not part of this

## Out of scope

- Starting a release or tagging scheme. The packages are at 1.0.0 and 0.0.1 with
  no releases; giving the project a version story is worth doing and is not this.
- Moving Playwright into CI (#186 notes it becomes possible once the corpus is
  committed).
- Factorio 2.1 data regeneration (#187).
- Adopting upstream's 38 open issues or its open PR #272. Worth triaging once the
  transfer question resolves, since a transfer would bring them along anyway.
