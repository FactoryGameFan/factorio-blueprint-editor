# Vite+ Migration — Remaining Work to Merge-Ready

Branch: `explore/vite-plus`. The migration is implemented across 7 commits
(`38f1ed01`…`340171cb`) and has passed per-task reviews plus a broad
whole-branch review. The broad review verdict was **"Ready to merge — with
fixes."** This is the checklist to make that a clean **Yes**.

Local verification is already green: `vp fmt . --check`, `vp lint .` (exit 0,
warnings only), `vp test` (29 tests), `type-check:gate` (0 at baseline 0),
`vp build`, and `playwright --list` all pass. The items below are the gaps a
single-task review could not see, plus one security decision.

---

## Resolved during exploration

- [x] **0. `devEngines` over-strict npm pin (broke `npx`/`npm run` + ccstatusline).**
      `vp migrate` pinned `devEngines.packageManager` to the exact npm `11.18.0` vp
      bundled. System npm `11.17.0` then failed every in-repo `npm run`/`npx` with
      `EBADDEVENGINES` — which also broke the Claude Code status line
      (`npx -y ccstatusline@latest`, run in the project cwd). Loosened to `"^11"` in
      `package.json`; `npm run type-check:gate`, `npx`, and ccstatusline all work
      again under system npm. **(Change is uncommitted on the branch — commit it with
      the other fixes.)** This also resolves the bare-`npm` friction noted in items 5
      and 6 below.

---

## Blockers — must fix before merging to `wormeyman-space-age-support`

- [ ] **1. Migrate `.github/workflows/deploy.yml` to Vite+ (CRITICAL).**
      It is the Cloudflare deploy workflow and triggers on `push` to
      `wormeyman-space-age-support` — the merge target — so it runs first on merge.
      This branch breaks it three ways:
    - `deploy.yml:27` `node-version-file: .nvmrc` — `.nvmrc` was deleted (replaced
      by `.node-version`); `actions/setup-node` fails immediately.
    - `deploy.yml:34` `npm run lint` now resolves to `vp lint .`, but the workflow
      never installs `vp` → `vp: command not found`.
    - `deploy.yml:37` `npm run build:website` → `vp build`, same missing-`vp`.

    Fix: mirror `ci.yml`. Replace the `setup-node`/`.nvmrc` step with the pinned,
    cached `vp` install + `$GITHUB_PATH` step (`VP_VERSION=0.2.1
VP_NODE_MANAGER=yes curl -fsSL https://vite.plus | bash`; cache `~/.vite-plus`).
    Keep the dependency install, `npm run lint`, `npm run build:website`, and the
    `cloudflare/wrangler-action` deploy step, plus the existing `concurrency`,
    `permissions: contents: read`, and triggers. Verify the YAML is well-formed and
    every `npm run`/`vp` call has `vp` on PATH first.

- [ ] **2. Make the CI + deploy dependency install frozen-lockfile (IMPORTANT).**
      The design made "install honors the lockfile, no drift" a success criterion.
      `ci.yml`'s current bare `vp install` (commit `340171cb`) can re-resolve
      transitive deps and silently drift `package-lock.json`.
      Fix: use a frozen install in both `ci.yml` and `deploy.yml` — either
      `vp install --frozen-lockfile` (if `vp` supports it; check `vp install --help`)
      or `npm ci` (now safe because `.npmrc` sets `legacy-peer-deps=true`; run it via
      vp's managed npm, which is on PATH after the install step). Confirm the chosen
      command leaves `git status --short package-lock.json` empty on a clean tree.

---

## Security decision — your call before this reaches production deploys

- [ ] **3. `curl | bash` vp install in CI + deploy (HIGH).**
      Both workflows install `vp` via `curl -fsSL https://vite.plus | bash`, which
      executes an unpinned bootstrap script on every run. Mitigations already in
      place: pinned `VP_VERSION=0.2.1`, top-level `permissions: contents: read`, and
      a cached toolchain. Not eliminated: the installer script itself is mutable, and
      `deploy.yml` (once fixed) carries `CLOUDFLARE_API_TOKEN` — a higher-value
      target than CI.
      Options:
    - (a) Accept as-is — it is vp's only official install path; reasonable for a
      personal fork with the mitigations above.
    - (b) Pin + verify — download the installer to a file and check a known
      SHA-256 before running, once Vite+ publishes a per-version immutable
      installer URL + checksum.
    - (c) Use a pinned GitHub release / npm artifact or a `setup-vp` action if/when
      one exists, removing curl-pipe-to-bash entirely.
      Decide before merging to a branch whose CI/deploy actually runs.

---

## Minor cleanups — nice to clear in the same pass

- [ ] **4. `CLAUDE.md` stale baseline comment.** The type-check-gate comment
      (~line 23) still says "currently 87"; the gate is at **0**. This branch already
      edited that comment block (prettier/eslint → oxfmt/oxlint), so update `87` → `0`
      here rather than leaving it as drift.
- [ ] **5. `CLAUDE.md` `build:analyze` uses bare `npm`.** With
      `devEngines.packageManager` pinning npm 11.18.0 (`onFail: download`), bare
      `npm`/`npx` outside vp's managed Node trips the engine check. Add a doc note
      that toolchain commands run through vp's npm.
- [ ] **6. Editor `test:unit` from the editor cwd.**
      `packages/editor/package.json` `test:unit` is now `vp test run`; invoked from
      the editor directory it may resolve the root `vite.config.ts` `projects` (incl.
      the `gate` project) rather than only editor units. It's off the CI path (CI
      calls root `vp test`). Sanity-check the behavior or add a comment.
- [ ] **7. Drop `'react'` from `vite.config.ts` lint `plugins`.**
      Migrate-emitted noise — this is not a React project. Harmless; remove it and
      re-confirm `vp lint .` exits 0.

---

## Final steps — once blockers are cleared

- [ ] Re-run the full local verification suite (item list at top), using vp's npm
      for the `npm run type-check:gate` step.
- [ ] Choose the finish path: PR to the wormeyman fork (matches prior batches) vs
      direct merge. Default to a PR.
- [ ] On the **first real CI + deploy run** on `wormeyman-space-age-support`,
      confirm the parts that cannot be verified locally: the `vp` install step, the
      npm-version / `devEngines` interplay, the frozen install, and a successful
      Cloudflare deploy.
- [ ] Remove this `todo.md` (or move it into `docs/superpowers/`) when complete.
