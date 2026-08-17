# Hard fork: becoming FactoryGameFan/factorio-blueprint-editor

Detach this repository from `teoxoy/factorio-blueprint-editor`, move it into a
`FactoryGameFan` organization, and rebrand it as a project in its own right.

> **Revised 2026-08-17.** The transfer is done. The detach is not. Upstream
> answered, and the answer changed two sections of this document - see "What
> changed since 2026-08-05" below. Everything not marked as revised was measured
> on 2026-08-05 and re-checked today.

## What changed since 2026-08-05

**Upstream answered, publicly, and said no to a transfer.** Issue #276, "Project
no longer maintained", was opened by teoxoy on 2026-08-16. It says he is stepping
away, that the repository will not be archived so people can keep commenting, and
it asks anyone who forks the project to "make the new identity clear", adding
that "ideally, a fork should not continue using the original logo since people
will naturally assume it's still the same project, same maintainer, and same
direction". wormeyman asked in that thread for the repository to be handed over.
teoxoy declined: "I would rather keep the repository and website up since it's
not terribly broken."

So the outreach section of this design is finished, and its answer is no. The
plan of asking on #208 and waiting four weeks is deleted rather than deferred.
What replaces it is a requirement this document did not have: a visual identity
of our own, because that is the specific thing the person we forked from asked
for.

**The transfer already happened**, out of the order this document set. The
repository is `FactoryGameFan/factorio-blueprint-editor` and has been since
2026-08-17, but `fork` is still `true` and `parent` still names teoxoy. Detaching
is the only step of the original sequence left, and doing it second cost nothing.

**Both risks this document refused to guess at came back clean.** Actions secrets
survived the transfer - `gh secret list` shows `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, both still stamped 2026-06-25. Renovate was reinstalled on
the org and is working; PR #236, "Adopt the org Renovate preset", merged
2026-08-17. Neither needed to be re-derived from behaviour, and both were checked
rather than assumed.

**Upstream pushed for the first time in ten months**, three commits on 2026-08-16,
so this fork is 3 behind where it was 0. Nothing here needs them:

- `12bbcef0` Factoriobin support (#272) - already ported here, credited in
  `bpString.ts` to nyakokitsu
- `9c73f979` remove discord and feedback buttons
- `62d8b92d` mark project as unmaintained (README title only)

The middle one matters to a decision below. **Upstream removed its own Discord
button from its own site**, so our README badge now points at a server that the
project it belongs to no longer links to.

## The problem

Other projects are switching to this copy and pull requests are arriving, but
GitHub still models it as someone else's fork. That is not a matter of framing -
`fork: true` has mechanical consequences, and they are the actual complaint:

- **Forks are excluded from GitHub repository search and from topic listings.**
  So the only way anyone finds this repo is by being told about it.
- **Pull requests default to the parent's base branch**, which is a trap for a
  first-time contributor who does not notice.
- Insights, discussions and the fork network all read as belonging upstream.
- **It is what gates Renovate.** On the Mend-hosted app, a fork is skipped during
  `init`, before any config is read, unless the app is kept on "Only select
  repositories". That happened on 2026-08-05 and left no trace in the repo.

Smaller leaks compound it, each one actively misdirecting somebody:

- The logo, the loading screen, the corner-panel mark and the favicon are all
  teoxoy's artwork - the illustrated orange `F.B.E.` - which is the exact thing
  #276 asks forks not to keep.
- `packages/editor/package.json` declares `author: "Teoxoy"`, and points
  `repository`, `homepage` and `bugs` at `github.com/Teoxoy/...`. The `bugs`
  field sends bug reports to a tracker with 38 open issues and no maintainer.
- The in-app GitHub link and the console "Looking for the source?" line both point
  at `wormeyman/factorio-blueprint-editor`, which redirects but names the old
  owner.
- Three strings tell users to report bugs "using the feedback button", which this
  fork does not have: `packages/website/index.html:50`,
  `packages/website/src/index.ts:105` and `:765`.
- The README's Discord badge points at upstream's server, whose maintainer left
  and which upstream itself stopped linking to on 2026-08-16.
- ~~The repository description is character-for-character upstream's, and the repo
  has no topics at all.~~ Both set on 2026-08-17: the description now names the
  2.0 and Space Age support and says outright that this is a separate project
  from `teoxoy/factorio-blueprint-editor`, and the topics are `factorio`,
  `blueprint-editor`, `space-age`, `pixijs`, `typescript`.
- The default branch is `wormeyman-space-age-support`, which names one person and
  one DLC, and needs a paragraph of explanation in both `README.md` and
  `CONTRIBUTING.md`.

## What was measured before deciding

Measured 2026-08-05, re-measured 2026-08-17 where marked. Re-derive rather than
trust - most of these expire.

**This is not a hostile fork, and upstream's own words are the evidence.** The
2026-08-05 version of this document rested that claim on issue #208, "Looking for
maintainer(s)", open and pinned since 2020-03-18, which reads "Going forward, I
would like to find at least one person that can help maintain the project."
wormeyman answered it on 2026-07-30 and got no reply. That reading is now
confirmed by #276 rather than inferred from silence: upstream stepped away on its
own terms, asked forks to identify themselves clearly, and pointed people at that
thread to find one.

**There is nothing to reconcile.** This fork is **428 commits ahead of
`upstream/master` and 3 behind** (2026-08-17). The three are listed above and
none is wanted. A hard fork here is a detachment, not a divergence, and no merge
or cherry-pick strategy is needed.

**What each side holds** (2026-08-17, with 2026-08-05 in brackets where it moved):

|             | this fork    | upstream                    |
| ----------- | ------------ | --------------------------- |
| Stars       | 6 (was 5)    | 422                         |
| Forks       | 3            | 102 (was 101)               |
| Open issues | 15 (was 8)   | 38                          |
| Open PRs    | 4 (was 0)    | 0 (was 1, #272, merged)     |
| Merged PRs  | 166 (was 86) | -                           |
| Last push   | 2026-08-17   | 2026-08-16 (was 2025-10-17) |
| Archived    | no           | no, and stated as never     |

That gap is why the 2026-08-05 outreach asked for a repository transfer rather
than only a link. The answer was no, so the gap stays. It is the cost of the
fork, and it is now a fixed cost rather than an open question.

**Upstream's Discord is alive even though its maintainer is not.** The invite in
the README (`discord.gg/c5eXyBU`, guild `540738973413408809`) still resolves, to
**968 members with 175 online** (2026-08-05). This inverted the obvious plan:
standing up a FactoryGameFan server would start at zero against a live community
and the usual result is that both go quiet.

**Nothing is published to npm.** Both `@fbe/editor` and `factorio-blueprint-editor`
return 404 from the registry. The `@fbe/` scope is internal to this monorepo, so
renaming it has no ecosystem consequence in either direction.

**The deploy has two secrets and no branch protection.** `.github/workflows/ci.yml`
has a `deploy` job gated on green checks that uses `secrets.CLOUDFLARE_API_TOKEN`
and `secrets.CLOUDFLARE_ACCOUNT_ID`, both set 2026-06-25 and both confirmed
present after the transfer. The default branch has no protection rules at all.

**The site's own type and palette are already a brand, and nobody used them as
one.** `packages/website/public/fonts/titillium-web-v8-latin/` ships Titillium Web
400 under the SIL Open Font License, and `packages/website/src/index.css` uses
`#ffe6c0` for text, `#27abdb` for blue, `#db9215` for amber and `#303030` for the
background. A new mark drawn from those needs no new font, no new license and no
new asset pipeline, and it matches the type the app already renders.

## Decisions

### Detach through GitHub Support

Ask GitHub Support to detach the fork - convert it to a standalone repository.
The transfer this document paired it with is already done, so the ordering note
that used to be here is spent.

Detaching flips `fork` to false, which is what makes the repo searchable and
stops Renovate depending on an app setting nobody can see from here. The
alternative - a fresh repository - is immediate but breaks every existing link
and the 3 downstream forks.

**This document used to assert that detaching keeps the URL, the 6 stars, the 15
open issues and the 166 merged pull requests. GitHub's own documentation says
otherwise, and the sentence was written without checking it.** The page at
`/pull-requests/how-tos/work-with-forks/detaching-a-fork` carries a warning under
"Converting a fork into a standalone repository" that the new repository "will
not retain any of its issues, pull requests, wikis, stars, watchers, comments,
child forks, or other metadata", keeping only git commit metadata, and that
leaving the network is **permanent** and cannot be undone. That warning sits
above both documented methods, so whether it describes the self-service path or
only the clone-and-recreate one is genuinely unclear from the page. The stakes
of guessing are 167 merged pull requests and 15 issues, so it is a question for
Support and not an inference.

**There is now a self-service route, and this repository cannot use it.** The
same page documents a **Leave fork network** button in Settings under the Danger
Zone, available only when the fork is public, is under 1GB and **has no child
forks**. Measured 2026-08-17: public yes, 0.475GB yes, child forks **three**
(`byalex33`, `olafrose`, `seesee010`). So the button is out on the third
condition, and it is not a condition that can be cleared from here - those are
other people's repositories. That is what makes the fork question below the
load-bearing one rather than a courtesy.

**One thing to ask Support rather than assume:** what happens to the three
existing forks of this repository (`byalex33`, `olafrose`, `seesee010`, all still
present on 2026-08-17) when it leaves the network. This design does not assert an
answer.

**Answered on 2026-08-17, by the support form's own assistant, and it is two
operations rather than one.** Neither the docs page nor this document knew that.

- **Detach** creates a new fork network holding only this repository. Its
  sub-forks are re-parented and **stay in the original network**.
- **Extract** moves this repository **and all its sub-forks** into a new network,
  with this repository as the new root.

Both make the repository standalone, so both fix the search problem. The choice
is only about where `byalex33`, `olafrose` and `seesee010` end up, and the
awkward part is that they forked this project's work rather than upstream's, so
detach re-parents them to a project their code did not come from. Worth knowing
before choosing, and not worth reopening after: they are other people's
repositories either way.

**Still unanswered:** whether the repository keeps its issues, pull requests,
stars and watchers. The assistant did not address it, so the filed ticket asks.

The ticket was filed on 2026-08-17 under the FactoryGameFan organization, in the
"Transfer" category - the form's nine categories name neither forks nor
detaching, and the fork routing rides on a `tags=rr-forks` parameter carried from
the topic tile instead.

**The ticket text**, drafted 2026-08-17 and kept here because a ticket that lives
only in a chat log gets rewritten from memory the second time. File it at
<https://support.github.com/request/fork>, which is the form the docs page links
for forks specifically, not the generic request page. Two concrete problems are
named on purpose - a request to detach because the fork label feels wrong reads
as taste, and the search invisibility and the wrong default PR base are neither.

> **Subject:** Detach FactoryGameFan/factorio-blueprint-editor from its fork
> network
>
> Hi,
>
> I'd like to detach https://github.com/FactoryGameFan/factorio-blueprint-editor
> from its parent, `teoxoy/factorio-blueprint-editor`, so it becomes a standalone
> repository. I'm an admin of the FactoryGameFan organization, and the repository
> was transferred into it recently.
>
> The parent is no longer maintained. Its author said so in
> `teoxoy/factorio-blueprint-editor#276` on 16 August 2026, declined to transfer
> the repository, and pointed people at that thread to find maintained forks.
> Mine is one of them. It is 429 commits ahead of the parent, has its own logo
> and issue tracker, and is where the pull requests are arriving now.
>
> Being modeled as a fork is causing two concrete problems: the repository
> doesn't appear in GitHub repository search or in topic listings, and new pull
> requests default to the parent's base branch, which has already confused
> contributors.
>
> Two questions before you make the change, because your documentation on
> detaching a fork warns that the standalone repository keeps only git commit
> metadata, and I can't tell from the page whether that applies to a
> Support-side detach or only to the clone-and-recreate method described lower
> down.
>
> First, does the repository keep its issues, pull requests, stars and watchers?
> There are 15 open issues and 167 merged pull requests, and losing them would
> change my mind about doing this at all.
>
> Second, there are three forks of my repository (byalex33, olafrose,
> seesee010). What happens to them? I ask partly because the self-service
> "Leave fork network" button is unavailable to me for exactly that reason, so
> I'd rather know in advance than discover it afterwards.
>
> Thanks,
> Eric (wormeyman)

The commit count is the one figure in there that moves, so re-measure it against
`teoxoy/factorio-blueprint-editor`'s `master` before filing rather than copying
the number above. The search claim is measured, not assumed: a
`factorio-blueprint-editor in:name` search on 2026-08-17 returns 11 repositories,
every one of them with `fork: false`, and this one is not among them. Setting the
five topics did not change that, which is the point - the exclusion is the fork
flag, not the metadata.

### A distinct visual identity

Replace teoxoy's artwork everywhere it ships, and take the replacement from the
app's own palette and type rather than from his.

This is the section #276 asks for, and the standard it sets is not "different
enough to defend" but "nobody assumes it is the same project". Four assets carry
his work today and all four change: `.github/logo.svg` (498 KB of illustrated
orange `F.B.E.`), `packages/website/public/logo.svg` (the loading screen, drawn
at 50% of viewport width), `packages/website/public/logo-small.svg` (the 140x80
corner panel) and `packages/website/public/favicon.png` (196x196).

The new mark is a chamfered blueprint plate: a grid with one placed tile, in the
blue and amber the app already uses, beside a two-line wordmark reading
`FACTORIO` over `BLUEPRINT EDITOR`. Three things about that choice are
deliberate:

- **The colour story is blue, not orange.** Upstream's mark is orange and so is
  the Factorio logo it echoes. Blue is the strongest single signal that this is
  not that project, and it is not invented - it is `#27abdb`, already on screen
  in the editor.
- **The wordmark spells the name instead of the initials.** Upstream's logo is
  `F.B.E.`, so a letterform mark, in any colour, is the one shape most likely to
  be read as his. The name is also what people search for, and it already sits in
  `index.html` as the page title.
- **The type is outlined, not referenced.** An SVG loaded through `<img>` cannot
  use the page's fonts, so the wordmark ships as paths drawn from the OFL-licensed
  Titillium Web the site already serves. That keeps the lockup identical to the
  app's own type with no new dependency.

`logo-small.svg` is the mark and a compressed wordmark, sized for a 140x80 box;
the favicon is the mark alone, which is the case that decided the design, since
it has to survive 32 pixels.

### GitHub Discussions, and the Discord badge goes

Enable Discussions on the repository; remove the Discord badge from the README.
Both done on 2026-08-17 - the badge with #237, Discussions alongside the
description and topics.

This forfeits direct reach to 968 Factorio players, which is a real cost and is
recorded here as one. What it buys is a surface that is owned, moderated, indexed
by the same search that is about to start finding the repository, and adjacent to
the issues.

The revision strengthens this rather than reopening it: on 2026-08-16 upstream
removed its own Discord button from its own site. Keeping a badge that points into
a server the parent project no longer links to, and where nobody can act on what
is said, is worse than it was when this decision was first made.

While the README is open, `packages/website/public/discord.svg` is a dead asset -
the in-app button that used it is already gone here - and the three strings
pointing users at a "feedback button" this fork does not have are corrected to
name GitHub issues instead. Those are not branding, but they are the same
question the `bugs` field answers wrongly: where does a user go with a problem.

### One comment on #276, after the rebrand lands

Post a single comment on upstream #276 naming the new URL and the new identity.
It goes after the visual identity ships, not before, because the thread's purpose
is helping people find a maintained fork and the useful version of that link is
one where the logo already differs.

The comment is a message to another person, so it goes through the `humanizer`
skill first, and wormeyman posts it - not the agent. The existing comment on that
thread, which names `wormeyman/factorio-blueprint-editor`, stays as the record of
what was asked and answered.

**The comment text**, drafted and humanized 2026-08-17, kept here for the same
reason the ticket text is. Note what it answers: the request in #276's body is
specifically about the logo, so the logo is the first thing it addresses, and the
stale URL is second.

> About the identity ask in your first post: the fork has its own logo now, plus
> its own wordmark and favicon, none of it based on yours. The README says at the
> top that this is a different project than this one, and the MIT notice still
> carries your copyright line.
>
> It also moved orgs, so the link I posted earlier is stale. It's now
> https://github.com/FactoryGameFan/factorio-blueprint-editor and the site is
> https://fbe.factorygamefan.com. The old wormeyman URL redirects.
>
> Thanks again for eight years of work on it.

### Deferred: renaming the default branch

`wormeyman-space-age-support` should become `main`, and the stale `master` branch
that tracks upstream should be deleted. Both are deliberately **not** in this
change, and that was re-confirmed on 2026-08-17. The rename touches `ci.yml` and
its Cloudflare deploy gate, `.github/renovate.json5`, `CLAUDE.md`,
`CONTRIBUTING.md`, `README.md`, `packages/website/index.html`,
`packages/website/src/index.ts` and several plan documents - 27 references across
16 files - and it would retarget 4 open pull requests. Isolating that risk into
its own reviewable PR is worth the second disruption to contributors.

## Judgment calls, recorded so they can be reversed knowingly

- **The repository name stays `factorio-blueprint-editor`.** It is what people
  search for.
- **The project name stays "Factorio Blueprint Editor".** #276 asks that the
  identity be clear, and names the logo specifically. A descriptive name shared
  with a project that is now explicitly retired is not what makes someone assume
  a shared maintainer; the artwork is.
- **The `@fbe/` package scope stays.** Nothing is published, so a rename is churn
  with no ecosystem benefit, and `fbe` is an abbreviation of the project rather
  than of a person.
- **The Cloudflare worker stays named `fbeworkeyman`.** It carries a personal
  name, and it is the one piece of this that a user could theoretically see - but
  only as the legacy `fbeworkeyman.workers.dev` host, which exists solely to 301
  to `fbe.factorygamefan.com`. Renaming means creating a second worker and moving
  the `custom_domain` route off the live one. That is production risk against a
  hostname that is already deprecated by its own redirect. Its placeholder page,
  which reads `FBEWormeyman`, is corrected - that is text, not infrastructure.
- **`packages/editor/package.json` is corrected, not rebranded.** `author`,
  `repository`, `homepage` and `bugs` are changed because they are **wrong** and
  `bugs` misdirects reports, not because of naming.
- **The LICENSE keeps `Copyright (c) 2020 Tanasoaia Teodor Andrei`.** MIT requires
  retaining the notice; this is not a choice. A second copyright line is added for
  the fork alongside it, and the README keeps crediting Teoxoy for building the
  editor this is based on.

## Sequence

Phases 1 and 2 are done, in the wrong order and at no cost. Phases 4 and 5
followed on 2026-08-17, so the only thing left in sequence is 3, which is in
someone else's queue, and 6, which waits on nothing now.

| Phase | Action                                                                                                     | State                  |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1     | Outreach. Superseded by #276 - upstream answered publicly and declined the transfer                        | done, answer was no    |
| 2     | Transfer to `FactoryGameFan`. Secrets verified present, Renovate reinstalled (#236)                        | done 2026-08-17        |
| 3     | Open the GitHub Support detach ticket, asking about the 3 downstream forks                                 | filed 2026-08-17       |
| 4     | Identity commit: new logo assets, package metadata, LICENSE, README, CONTRIBUTING, CLAUDE.md, dead strings | done 2026-08-17 (#237) |
| 5     | Repository description and topics; enable Discussions                                                      | done 2026-08-17        |
| 6     | One comment on #276 with the new URL, humanizer pass first, posted by wormeyman                            | unblocked, to do       |
| later | Branch rename to `main`, its own PR                                                                        | deferred, re-confirmed |

Phase 3 does not block phase 4. The detach is a ticket in someone else's queue
and the identity work is local; either can land first.

## Risks

- ~~**Renovate stops, silently.**~~ Checked 2026-08-17: reinstalled on the org and
  working, PR #236 merged. The underlying hazard stands - app installations are
  per-account, and a fork is skipped before its config is read - which is one more
  reason the detach is worth a ticket.
- ~~**The Cloudflare secrets may not survive the transfer.**~~ Checked 2026-08-17:
  both present, both still stamped 2026-06-25.
- **A logo swap is invisible to the test suite.** Nothing under `tests/` reads
  `logo.svg`, `logo-small.svg` or `favicon.png`, so a broken or missing asset is
  green everywhere and only shows on screen. Load the page and look at it, at the
  loading screen, the corner panel and the browser tab.
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
- `git grep -in teoxoy` returns only the credit lines in `README.md` and the
  historical documents under `docs/superpowers/`
- `git grep -n "feedback button" -- packages` returns nothing - scoped to `packages`,
  since this document names the string it is asking about
- No file under `packages/website/public/` or `.github/` still holds upstream's
  artwork, and `discord.svg` is gone
- The loading screen, the corner panel and the browser tab all show the new mark,
  checked by eye against a running dev server
- `vp check` and `vp test` clean, and all four Playwright shards green - every
  spec loads `index.html`
- `wormeyman-space-age-support` still builds and deploys - the branch rename is
  explicitly not part of this

## Out of scope

- Starting a release or tagging scheme. The packages are at 1.0.0 and 0.0.1 with
  no releases; giving the project a version story is worth doing and is not this.
- Factorio 2.1 data regeneration (#187).
- Adopting upstream's 38 open issues. Worth triaging now that the transfer
  question is settled, since nobody there will.
- ~~Moving Playwright into CI~~ - done, the `e2e` job, four sharded runners.
