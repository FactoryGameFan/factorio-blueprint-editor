# Vite+ Migration Design

- Date: 2026-06-29
- Branch: `explore/vite-plus`
- Status: Approved (design); pending implementation plan

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

| Question | Decision |
| --- | --- |
| Goal | Full toolchain (Oxlint + Oxfmt + unified `vp`) |
| Type-aware lint findings | Fix hard error + tsconfig; type-aware warnings stay non-blocking |
| Authoritative type gate | Keep custom `type-check-gate.mjs` (baseline 0) |
| Test runners | `vp test` = editor units + gate tests; Playwright stays separate |
| Test unification scope | Convert gate tests (node:test -> Vitest); do NOT port Playwright |
| Node version | vp-managed LTS (24.18.0); CI uses vp's Node |
| Rollout | One PR, phased commits, reformat isolated |

## Design

### 1. Toolchain (commit 1) - already produced by `vp migrate`

Keep the migration output as the first commit:

- Root `overrides` alias `vite` -> `npm:@voidzero-dev/vite-plus-core@latest` and
  pin `vitest` to `4.1.9`.
- `vite-plus` added as a dev dependency at root and in each workspace package.
- ESLint/Prettier dev deps removed (`@eslint/js`, `eslint`, `prettier`,
  `typescript-eslint`).
- `defineConfig` imports rewritten to `vite-plus`; `vitest`/`vitest/config`
  rewritten to `vite-plus` / `vite-plus/test`.
- Website inline plugins wrapped with `lazyPlugins()`.
- `package.json` scripts repointed to `vp` (`vp dev`, `vp build`, `vp preview`,
  `vp lint`, `vp fmt`, `vp test`).
- `.nvmrc`, `.prettierrc.yml`, and `eslint.config.mjs` deleted; their settings
  folded into the root `vite.config.ts` (`lint` and `fmt` blocks). `.nvmrc`
  replaced by `.node-version`.
- `tsconfig.json` `types` updated `vite/client` -> `vite-plus/client`.

### 2. Formatting - Oxfmt (commit 2)

Run `vp fmt .` and commit the resulting 109-file reformat as a single,
mechanical, isolated commit. Nothing is hand-edited. The `fmt` block mirrors the
prior Prettier configuration (printWidth 100, no semicolons, single quotes, es5
trailing commas, avoid arrow parens, tabWidth 2). `.prettierignore` is replaced
by `fmt.ignorePatterns`. Reviewers can skip this commit with
`git show <sha> --ignore-all-space`.

### 3. Lint - Oxlint, type-aware, warnings non-blocking (commit 3)

- Fix the one hard error: `packages/editor/src/UI/controls/Slider.ts:182`
  `TS2531` (object possibly null).
- Fix the root `tsconfig.json` type-aware lint error ("Cannot find type
  definition file for `typed-factorio/prototype`"). The root tsconfig references
  types only installed under `packages/editor`. Scope the root tsconfig's
  `types`/`include` (or otherwise make the type-aware pass resolve) without
  disturbing `packages/editor`'s own tsconfig.
- Keep `options.typeAware` and `options.typeCheck` enabled, but type-aware
  findings remain at `warn` severity (non-blocking). CI `vp lint .` fails only
  on errors. The ~25 `unbound-method` / `restrict-template-expressions` /
  `no-redundant-type-constituents` warnings stay visible for incremental
  cleanup.

### 4. Type checking - unchanged

`scripts/type-check-gate.mjs` (tsc against the editor tsconfig, baseline 0)
remains the authoritative type gate, run in CI as `npm run type-check:gate`.
Vite+ lint's type-awareness is advisory only. Type-checking is not folded into a
`vp check` gate.

### 5. Tests (commit 4)

- Convert `scripts/type-check-gate.test.mjs` from node:test to the Vitest API so
  `vp test` runs editor unit tests plus the gate tests.
- Scope the Vitest `include` so `vp test` covers `packages/editor/**` and
  `scripts/**`, and excludes `tests/**` (the Playwright suite) and any
  `*.spec.ts` Playwright files.
- Playwright is unchanged and stays on its own runner, exposed as a script
  (`test:e2e` -> `npx playwright test`, invoked via `vp run test:e2e`). The old
  `test:scripts` script is removed (folded into `vp test`).

### 6. CI + Node (commit 5)

- Rewrite `.github/workflows/ci.yml`: replace the `setup-node` + `npm ci` +
  `npm run format/lint/...` steps with a `vp` install step
  (`curl -fsSL https://vite.plus | bash`, or a pinned installer), then
  `vp install` -> `vp fmt --check` -> `vp lint .` -> `vp test` ->
  `npm run type-check:gate`.
- Pin `.node-version` to `24.18.0` (vp-managed LTS). CI runs under vp's Node so
  local and CI agree on the runtime.
- Preserve the existing triggers and branch filters
  (`wormeyman-space-age-support` push/PR).

### 7. Docs (commit 5)

- Update `CLAUDE.md`: the Key Commands table (`npm run start` -> `vp dev`, build,
  test, lint, format equivalents), the Dev Server Setup section, and a short
  "Vite+ toolchain" note describing `vp` and the config layout.
- Add a Vite+ pointer to auto-memory.

## Verification / success criteria

- `vp install` completes clean.
- `vp fmt --check` reports no formatting issues.
- `vp lint .` reports no errors (warnings allowed).
- `vp test` is green (editor units + gate tests).
- `npx playwright test --list` still discovers the blueprint suite.
- `vp build` produces a working `packages/website/dist/`.
- `npm run type-check:gate` reports 0 errors (at baseline 0).
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

1. Toolchain config + deps + import rewrites (current `vp migrate` output).
2. Oxfmt 109-file reformat (isolated, mechanical).
3. Lint unblock: fix `TS2531` + root tsconfig; confirm warnings non-blocking.
4. Test reorg: gate tests node:test -> Vitest; scope `vp test`; keep Playwright.
5. CI rewrite + `.node-version` pin (24.18.0) + `CLAUDE.md` doc updates.
