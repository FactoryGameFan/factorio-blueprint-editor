# Contributing

First of all, thanks for your interest in helping out! 😃

**Where you are.** This is `FactoryGameFan/factorio-blueprint-editor`, deployed at
<https://fbe.factorygamefan.com>. It grew out of
[`teoxoy/factorio-blueprint-editor`](https://github.com/teoxoy/factorio-blueprint-editor),
which its author
[stopped maintaining in August 2026](https://github.com/teoxoy/factorio-blueprint-editor/issues/276),
and it adds Factorio 2.0 and Space Age support. Two things follow from that and
are easy to get wrong:

- The default branch is `wormeyman-space-age-support`, not `master`. Branch from
  it and target it with your pull request. CI only runs on that branch.
- Issues and pull requests belong here, not upstream. Nobody is reading them
  there.

## Submitting an Issue

Before you submit an issue, please search the issue tracker, maybe an issue for
your problem already exists and the discussion might inform you of workarounds
readily available.

We want to fix all the issues as soon as possible and a minimal reproduction scenario
allows us to quickly confirm a bug (or point out a coding problem) as well as confirm
that we are fixing the right problem.

You can file new issues by selecting from our
[new issue templates](https://github.com/FactoryGameFan/factorio-blueprint-editor/issues/new/choose)
and filling out the issue template.

## Submitting a Pull Request

### Prerequisites

- [git](https://git-scm.com/)
- [node](https://nodejs.org/en/). The root `package.json` declares
  `devEngines.packageManager: npm ^11` with `onFail: download`, so an npm new
  enough to read that field will fetch a matching one; an older npm ignores it
  and runs anyway, which is the version to watch out for.
- [Vite+](https://vite.plus) - the `vp` CLI this repo builds, lints, formats and
  tests with. The version is pinned, and CI installs the same one via
  `.github/actions/setup-vp`:

    ```shell
    VP_VERSION=0.2.6 VP_NODE_MANAGER=yes curl -fsSL https://vite.plus | bash
    ```

    Then put `~/.vite-plus/bin` on your PATH, ahead of any system npm. Two
    things need it there: `npm run localpreview` spawns `vp` directly, and
    `VP_NODE_MANAGER=yes` puts vp's managed node and npm on that path, which is
    what the scripts calling bare `npm`/`npx` expect to resolve to.

- [rust](https://rust-lang.org) - **only** if you want to regenerate the sprite
  data. The generated data is committed to the repo, so you do not need rust,
  a Factorio install, or a factorio.com account to work on the editor itself.
  See [Regenerating the sprite data](#regenerating-the-sprite-data-optional).
- [vscode](https://code.visualstudio.com/) - optional, but the repo ships
  workspace settings for it.

### Note

This project lints with `oxlint` and formats with `oxfmt`, both driven by `vp`
and configured in the root `vite.config.ts`. It no longer uses `eslint` or
`prettier`, so extensions for those will fight the repo's formatting.

If you use `vscode`, **download the recommended workspace extensions** after
cloning the repo. `.vscode/extensions.json` asks for `oxc.oxc-vscode` (the
formatter and linter), plus `rust-lang.rust-analyzer` and `sumneko.lua` for the
exporter. The committed workspace settings already format and autofix on save
once that first one is installed.

## Steps

1. Fork the repo
1. Clone your fork
1. Download the recommended workspace extensions in vscode
1. Create a new git branch
   (`git checkout -b my-fix-branch wormeyman-space-age-support`)
1. Run `vp install`
1. Run `npm run localpreview` from the repo root
1. Open <http://localhost:8080> in a browser
1. Make changes
1. Run `vp check --fix` and `vp test` - this is what CI checks
1. Commit your changes using a descriptive commit message
1. Push your branch to GitHub `git push origin my-fix-branch`
1. Start a pull request from GitHub

That's it! 🎉 Thank you for your contribution! 😃

### Running the editor locally

The editor needs two servers, and `npm run localpreview` starts both from the
repo root and ties their lifetimes together, so one Ctrl-C stops the pair:

| Port | Server                                         |
| ---- | ---------------------------------------------- |
| 8080 | Vite, serving the website (`packages/website`) |
| 8081 | a static file server, serving the sprite data  |

Both are required. In dev, Vite proxies `/data` to `127.0.0.1:8081` rather than
serving the sprite output itself, and that proxy target is hardcoded - so the
sprite server's port is not negotiable and only Vite's can move:

```shell
npm run localpreview -- --port 8090
```

The script checks both ports before spawning anything and refuses to start if
either is taken. That check is as much the point of the script as the
convenience is: started by hand, Vite without `--strictPort` quietly falls back
to 8081 and then proxies `/data` to itself, which presents as the sprite server
failing rather than as a port clash.

### Checks

| Command                   | What it does                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| `vp check`                | format + lint + type check, every package. This is the one to run before pushing. |
| `vp check --fix`          | the same, applying the format and lint fixes it can                               |
| `vp test`                 | unit tests (the editor's, plus the repo scripts')                                 |
| `npm run type-check:gate` | fails if the type error count rises above the committed baseline                  |
| `npx playwright test`     | browser tests - needs `npm run localpreview` running first                        |

Two things about the Playwright suite. Run `npx playwright install` after any
`@playwright/test` bump, or every spec fails on a missing browser executable.
And several specs load the blueprint corpus in `test-blueprints/`, which is
committed - see its README for where the blueprints come from and what the set
is chosen for. Those specs assert that they found some, so a missing corpus is a
real failure rather than an expected local condition.

If you moved Vite off 8080, point the specs at it rather than editing
`playwright.config.ts`:

```shell
FBE_BASE_URL=http://localhost:8090 npx playwright test
```

## Regenerating the sprite data (optional)

`packages/exporter` is a rust program that extracts entity definitions and
sprites from a Factorio installation into `packages/exporter/data/output/`. That
output is committed, so you only need this if you are updating the data for a
new game version.

Create `packages/exporter/.env`, configure it with one of the two options below,
then run:

```shell
npm run start:exporter
```

Note that the sprite compression step invokes `./basisu`, and the only binary
committed for it is macOS ARM64, so that step will not run as-is on Linux.

### Option A: Local Factorio installation (recommended - includes Space Age support)

If you have Factorio installed locally (including any DLC like Space Age),
set `FACTORIO_DIR` in `packages/exporter/.env`:

```shell
FACTORIO_DIR=/path/to/your/factorio/installation
```

| Platform        | Example path                                                               |
| --------------- | -------------------------------------------------------------------------- |
| macOS (Steam)   | `/Users/<you>/Library/Application Support/Steam/steamapps/common/Factorio` |
| Linux (Steam)   | `~/.steam/steam/steamapps/common/Factorio`                                 |
| Windows (Steam) | `C:\Program Files (x86)\Steam\steamapps\common\Factorio`                   |

When `FACTORIO_DIR` is set, `FACTORIO_USERNAME` and `FACTORIO_TOKEN` are not needed.

### Option B: Download base game data (no DLC support)

Add your `FACTORIO_USERNAME` and `FACTORIO_TOKEN` to `packages/exporter/.env`
(you can get those [here](https://factorio.com/profile)).
The exporter will download the base game data automatically.
This option only supports base game items.

## Working on your first Pull Request?

Check out this [tutorial](https://github.com/firstcontributions/first-contributions/blob/master/github-windows-vs-code-tutorial.md)

Also, [How to Contribute to an Open Source Project on GitHub](https://egghead.io/series/how-to-contribute-to-an-open-source-project-on-github)
for a more in depth (video) tutorial
