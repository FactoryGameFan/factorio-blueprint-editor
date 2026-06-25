# Contributing

First of all, thanks for your interest in helping out! 😃

# Submitting an Issue

Before you submit an issue, please search the issue tracker, maybe an issue for your problem already exists and the discussion might inform you of workarounds readily available.

We want to fix all the issues as soon as possible and a minimal reproduction scenario allows us to quickly confirm a bug (or point out a coding problem) as well as confirm that we are fixing the right problem.

You can file new issues by selecting from our [new issue templates](https://github.com/Teoxoy/factorio-blueprint-editor/issues/new/choose) and filling out the issue template.

# Submitting a Pull Request

## Prerequisites

- [git](https://git-scm.com/)
- [node](https://nodejs.org/en/)
- [vscode](https://code.visualstudio.com/)
- [rust](https://rust-lang.org)

### Note

This project uses `eslint` and `prettier` to lint and format code. I would recommend that you use `vscode` for this project because the repo already contains the extension settings for autofixing linting errors and formatting code on save. So, make sure to **download the recommended workspace extensions** in vscode after cloning the repo.

## Steps

1. Fork the repo
1. Clone your fork
1. Download the recommended workspace extensions in vscode
1. Create a new git branch (`git checkout -b my-fix-branch master`)
1. Create a new file at the path `packages/exporter/.env` and configure the exporter (see options below)
1. Run `npm i --legacy-peer-deps`
1. Run `npm run start:website` and `npm run start:exporter`
1. Open the link in a browser or use the vscode debugger
1. Make changes
1. Commit your changes using a descriptive commit message
1. Push your branch to GitHub `git push origin my-fix-branch`
1. Start a pull request from GitHub

### Exporter setup options

**Option A: Local Factorio installation (recommended - includes Space Age support)**

If you have Factorio installed locally (including any DLC like Space Age), set `FACTORIO_DIR` in `packages/exporter/.env`:

```
FACTORIO_DIR=/path/to/your/factorio/installation
```

| Platform        | Example path                                                               |
| --------------- | -------------------------------------------------------------------------- |
| macOS (Steam)   | `/Users/<you>/Library/Application Support/Steam/steamapps/common/Factorio` |
| Linux (Steam)   | `~/.steam/steam/steamapps/common/Factorio`                                 |
| Windows (Steam) | `C:\Program Files (x86)\Steam\steamapps\common\Factorio`                   |

When `FACTORIO_DIR` is set, `FACTORIO_USERNAME` and `FACTORIO_TOKEN` are not needed.

**Option B: Download base game data (no DLC support)**

Add your `FACTORIO_USERNAME` and `FACTORIO_TOKEN` to `packages/exporter/.env` (you can get those [here](https://factorio.com/profile)). The exporter will download the base game data automatically. This option only supports base game items.

That's it! 🎉 Thank you for your contribution! 😃

## Working on your first Pull Request?

Check out this [tutorial](https://github.com/firstcontributions/first-contributions/blob/master/github-windows-vs-code-tutorial.md)

Also, [How to Contribute to an Open Source Project on GitHub](https://egghead.io/series/how-to-contribute-to-an-open-source-project-on-github) for a more in depth (video) tutorial
