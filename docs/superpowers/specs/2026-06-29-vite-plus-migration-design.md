# Vite+ Migration Design

- Date: 2026-06-29
- Branch: `explore/vite-plus`
- Status: Approved (design); revised after subagent review; pending implementation plan

> **Historical note, added 2026-09-02.** The type-check gate described below no
> longer exists. #268 removed `scripts/type-check-gate.mjs`, its baseline and the
> CI step, after `strict: true` landed under #77 and brought the baseline back to
> 0. Everything below records the state at the time of writing and is left as
> written. The strict-ratchet technique itself is kept, in
> `.github/workflows/README.md`.

## Goal & scope

Adopt the full Vite+ toolchain for the factorio-blueprint-editor monorepo:
unify build, dev, test, lint, and format under the `vp` CLI, replacing ESLint
with Oxlint and Prettier with Oxfmt. The work ships as one PR built from phased,
individually reviewable commits (Approach B).

In scope:

- Repo root and the two npm-workspace members: `packages/editor`,
  `packages/website`.
- CI workflow and repo documentation.

Out of scope:

- `packages/exporter` (Rust / cargo) and `packages/worker` (wrangler) stay as
  they are. They are not npm-workspace members and are already excluded by the
  lint/fmt `ignorePatterns`.
- The Playwright blueprint-diagnostic harness keeps its own runner (see Tests).
- Folding type-checking into a Vite+ gate. The existing type-check gate is
  retained unchanged (see Type checking).

## Background / current state

`vp migrate --no-interactive --no-hooks --no-agent --no-editor` has already been
run on the branch. It produced a working toolchain migration: the production
build (`vp build`) succeeds, and the editor's 13 Vitest unit tests pass. Four
issues remain to resolve, which this design addresses: the Oxfmt reformat churn,
the stricter type-aware Oxlint findings, the over-broad `vp test` scope, and CI
breakage.

The project uses npm workspaces (`packages/editor`, `packages/website`), a
custom `eslint.config.mjs`, Prettier defaults, per-package Vite/Vitest configs,
and a custom `scripts/type-check-gate.mjs` type gate currently at baseline 0
errors.

## Decisions

| Question                 | Decision                                                           |
| ------------------------ | ------------------------------------------------------------------ |
| Goal                     | Full toolchain (Oxlint + Oxfmt + unified `vp`)                     |
| Type-aware lint findings | Fix hard error + tsconfig; type-aware warnings stay non-blocking   |
| Authoritative type gate  | Keep custom `type-check-gate.mjs` (baseline 0)                     |
| Test runners             | `vp test` = editor units + gate tests; Playwright stays separate   |
| Test unification scope   | Convert gate tests (node:test -> Vitest); do NOT port Playwright   |
| Node version             | vp-managed LTS (24.18.0); CI uses vp's Node                        |
| Dependency specifiers    | Pin exact versions (no `@latest`); install must honor the lockfile |
| Indent width             | Keep 4-space (`fmt.tabWidth: 4`); YAML excluded from oxfmt         |
| Rollout                  | One PR, phased commits, reformat isolated                          |

## Design

### 1. Toolchain (commit 1) - already produced by `vp migrate`

Keep the migration output as the first commit:

- Root `overrides` alias `vite` -> `@voidzero-dev/vite-plus-core` and pin
  `vitest` to `4.1.9`. **Pin the `vite-plus-core` override and every `vite-plus`
  dependency to an exact version (replace the `@latest`/`"latest"` specifiers
  the migration emitted), so the toolchain version is reproducible.** Drop the
  redundant `vite: @voidzero-dev/vite-plus-core@latest` entry in
  `packages/website/package.json` (covered by the root override).
- `vite-plus` added as a dev dependency at root and in each workspace package.
- ESLint/Prettier dev deps removed (`@eslint/js`, `eslint`, `prettier`,
  `typescript-eslint`).
- `defineConfig` imports rewritten to `vite-plus`; `vitest`/`vitest/config`
  rewritten to `vite-plus` / `vite-plus/test`.
- Website inline plugins wrapped with `lazyPlugins()`.
- `package.json` scripts repointed to `vp`. Note the split: the root
  `package.json` repoints only `lint`/`format` (and their `:fix` variants) to
  `vp`; the `vp dev`/`vp build`/`vp preview` scripts live in
  `packages/website/package.json`. The root `build:website`/`start:website`/
  `preview:website` still shell out to `npm --workspace ... run` (which then call
  `vp`). Implication to document: any contributor or CI step running
  `npm run lint`/`format` now requires `vp` on PATH.
- `.nvmrc`, `.prettierrc.yml`, and `eslint.config.mjs` deleted; their settings
  folded into the root `vite.config.ts` (`lint` and `fmt` blocks). `.nvmrc`
  replaced by `.node-version`.
- `tsconfig.json` `types` updated `vite/client` -> `vite-plus/client`.

### 2. Formatting - Oxfmt (commit 2)

Run `vp fmt .` and commit the resulting reformat as a single, mechanical,
isolated commit. Nothing is hand-edited.

**Critical: the `fmt` block must use `tabWidth: 4`, not the `tabWidth: 2` the
migration emitted.** The prior `.prettierrc.yml` used `tabWidth: 4` (with a
`*.yml -> 2` override); the repo is 4-space throughout. Left at 2, `vp fmt`
reindents the entire repo (that is most of the ~109-file churn seen during
exploration) AND invalidates the 4-space literal edit blocks in tasks 3-4, which
run after this commit. Setting `fmt.tabWidth: 4` (done in commit 1) reduces this
commit to genuine Oxfmt-vs-Prettier differences only. YAML files (the sole prior
tabWidth-2 override) are added to `fmt.ignorePatterns` rather than reformatted.
The remaining `fmt` settings mirror Prettier: printWidth 100, no semicolons,
single quotes, es5 trailing commas, avoid arrow parens. Reviewers can skip this
commit with `git show <sha> --ignore-all-space`.

Also in this commit: **delete the now-stale `.prettierignore`** (it still exists
in the tree; its patterns are duplicated in `fmt.ignorePatterns`). Before
committing, run `vp fmt --check` as a dry run to confirm the (now much smaller)
file set and that only expected trees are rewritten - watch for `docs/`,
`wormeyman-tests/`, and `diagnostic-reports/` being reformatted unexpectedly, and
extend `fmt.ignorePatterns` if generated/fixture files are caught.

### 3. Lint - Oxlint, type-aware rules on (warnings), strict typeCheck off (commit 3)

**Revised after Task 1 (the original premise undercounted the errors).** The
migrated config runs `lint.options.typeCheck: true`, which performs a full
strict-mode type-check and emits ~960 errors: ~900 TypeScript diagnostics
(TS18048 / TS2322 / TS2345 / ...), 54 `no-explicit-any`, 1 `ban-ts-comment`,
plus 2 `tsconfig-error` and 1 `no-unused-vars`. The project's own `tsc` runs with
`strict` **off** (the baseline-0 gate) and is the authoritative type check;
Oxlint's `typeCheck` duplicates a strict tsc the project intentionally does not
enforce. Decision (confirmed with the user):

- Set `lint.options.typeCheck: false`. Keep `lint.options.typeAware: true` so the
  type-aware lint _rules_ (unbound-method, restrict-template-expressions,
  no-redundant-type-constituents, ...) still run - as non-blocking **warnings**.
  This eliminates the ~900 TS diagnostics; the `tsc` gate remains the type
  authority (see section 4). The Slider `TS2531` sites were typeCheck
  diagnostics and disappear with typeCheck off - no Slider edit is needed.
- Restore the two rule disables the deleted `eslint.config.mjs` carried:
  `typescript/no-explicit-any: off` and `typescript/ban-ts-comment: off` (the
  Space Age code uses `as any` casts by design).
- Add `typed-factorio` to the **root** devDependencies so the root/website
  tsconfig `types: ['typed-factorio/prototype']` resolves (clears the 2
  `tsconfig-error`s). The package is otherwise only installed under
  `packages/editor`.
- Fix the 1 remaining `no-unused-vars` error (`render_layer` at
  `packages/editor/src/core/spriteDataBuilder.ts:1155`): remove/prefix if unused,
  or scope-disable if a false positive.
- **Verify (don't assume):** after the above, `vp lint .` exits 0 with only
  warnings present. This is a gating assumption for the "green CI" criterion.

### 4. Type checking - unchanged

`scripts/type-check-gate.mjs` (tsc against the editor tsconfig, baseline 0)
remains the authoritative type gate, run in CI as `npm run type-check:gate`.
Vite+ lint's type-awareness is advisory only. Type-checking is not folded into a
`vp check` gate.

### 5. Tests (commit 4)

- Convert `scripts/type-check-gate.test.mjs` from node:test to the Vitest API so
  `vp test` runs editor unit tests plus the gate tests.
- **Add a root `test` block to `vite.config.ts`** (it currently has only `lint`
  and `fmt` blocks). `scripts/**` lives outside any workspace package, so without
  a root-level test config `vp test` will not pick up the converted gate tests.
  The root `test` config must `include` `scripts/**/*.test.{mjs,ts}` and
  `exclude` `tests/**` and `**/*.spec.ts` (the Playwright suite). The editor's
  own `packages/editor/vitest.config.ts` already scopes to `src/**/*.test.ts`.
  After wiring this, confirm `vp test` runs exactly the editor units + gate tests
  and does not sweep up Playwright.
- Playwright is unchanged and stays on its own runner. Rename the root `test`
  script (`npx playwright test`) to `test:e2e`, update `test:report`
  accordingly, and invoke via `vp run test:e2e`, so `npm test` does not silently
  keep launching Playwright. The old `test:scripts` script is removed (folded
  into `vp test`).

### 6. CI + Node (commit 5)

- Rewrite `.github/workflows/ci.yml`: replace the `setup-node` + `npm ci` +
  `npm run format/lint/...` steps with a `vp` install step, then `vp install` ->
  `vp fmt --check` -> `vp lint .` -> `vp test` -> `npm run type-check:gate`. Also
  fix the stale step labels ("prettier"/"eslint") and remove the
  `node-version-file: .nvmrc` reference (that file is deleted).
- **Pin and cache the `vp` install**: prefer a version-pinned installer (with
  checksum) over a bare `curl -fsSL https://vite.plus | bash`, and cache the vp
  toolchain dir (`~/.vite-plus`) between runs so CI does not re-download the
  toolchain every time (the risk section flags this network dependency).
- **Install must honor the lockfile.** Confirm `vp install` has frozen-lockfile
  semantics in CI; if it re-resolves and mutates `package-lock.json`, keep
  `npm ci` for the install step instead. (Pairs with the exact-version pinning
  in section 1.)
- **Keep `typescript` pinned** in root devDeps. `npm run type-check:gate` runs
  `npx tsc`, which resolves `typescript@^5.9.3` (still present; not dropped by
  the migration). The gate is independent of `vp`; do not remove `typescript`.
- Pin `.node-version` to `24.18.0` (vp-managed LTS); it currently reads `lts/*`.
  CI runs under vp's Node so local and CI agree on the runtime. Note the local
  machine runs Node 26 until contributors adopt vp's Node.
- Preserve the existing triggers and branch filters
  (`wormeyman-space-age-support` push/PR). Because CI triggers only on that
  branch (not `explore/vite-plus`) and a PR runs the workflow file at its head,
  the rewritten `ci.yml` is what executes at PR/merge time. Intermediate
  commits 1-4 leave `ci.yml` internally inconsistent, which only matters if
  someone runs CI off an intermediate SHA (e.g. via bisect).

### 7. Docs (commit 5)

- Update `CLAUDE.md` beyond just the table: the Key Commands block (including the
  `npm run test:scripts` reference, now folded into `vp test`), the Dev Server
  Setup section, the Playwright Diagnostics **Prerequisites** (`npm run start` ->
  `vp dev`), and a short "Vite+ toolchain" note describing `vp` and the
  `vite.config.ts` `lint`/`fmt`/`test` config layout. Document that
  `npm run lint`/`format` now require `vp` on PATH.
- Add a Vite+ pointer to auto-memory.

## Verification / success criteria

- `vp install` completes clean and does not mutate `package-lock.json` (frozen
  lockfile).
- `vp fmt --check` reports no formatting issues; `.prettierignore` is gone.
- `vp lint .` **exits 0** with no errors (warnings allowed and present).
- `vp test` is green and runs exactly the editor units + gate tests (no
  Playwright files swept in).
- `npx playwright test --list` still discovers the blueprint suite.
- `vp build` produces a working `packages/website/dist/`.
- `npm run type-check:gate` reports 0 errors (at baseline 0).
- No `@latest`/`"latest"` dependency specifiers remain.
- CI is green on the PR.

## Risks & rollback

- Oxfmt drift from Prettier: mitigated by isolating the reformat in commit 2.
- Type-aware lint noise: mitigated by keeping type-aware findings non-blocking.
- CI `vp`-install flakiness or network dependency: fallback documented; the type
  gate remains on plain node so it is not coupled to the vp install.
- Node version mismatch (system 26 vs vp 24): resolved by pinning `.node-version`
  to vp's LTS and running CI under vp's Node.
- Rollback: the entire change is contained on `explore/vite-plus`. Revert with
  `git checkout -- . && git clean -fd`, or delete the branch. `vp implode`
  removes the CLI itself.

## Rollout (commit plan)

1. Toolchain config + deps + import rewrites (current `vp migrate` output), with
   `@latest` specifiers pinned to exact versions and the redundant website `vite`
   dep dropped.
2. Oxfmt reformat (isolated, mechanical) + delete stale `.prettierignore`.
3. Lint unblock: fix both `Slider.ts` `TS2531` sites (173 + 182) + root tsconfig;
   verify `vp lint .` exits 0 with warnings.
4. Test reorg: gate tests node:test -> Vitest; add root `test` block scoping
   `vp test`; rename `test` -> `test:e2e`; keep Playwright.
5. CI rewrite (pinned/cached vp install, frozen lockfile, keep `typescript`) +
   `.node-version` pin (24.18.0) + `CLAUDE.md` doc updates.
