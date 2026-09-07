# Exporter validation and dataset review

See [CONTRIBUTING](../../CONTRIBUTING.md#regenerating-the-sprite-data-optional)
for installation and invocation. `FACTORIO_DIR` selects the installed version;
the download fallback still targets the version in `src/main.rs`. Accepting a
2.1 installation does not mean the editor or export schema is 2.1-ready.

## Isolation checks (no Factorio required)

```shell
cargo test --locked --manifest-path packages/exporter/Cargo.toml
cargo fmt --check --manifest-path packages/exporter/Cargo.toml
```

Linux and Windows CI run the tests. Unix additionally runs fake executable
tests that check the launch arguments, working directory, intentional nonzero
exit, missing fresh dump and invalid JSON. These are not a real-game smoke test.
Test workspaces are retained under the system temporary directory with the
`fbe-export-test-` and `fbe-export-` prefixes.

Every extraction passes explicit `--config` and `--mod-directory` paths, uses
a fresh write-data directory, and accepts only that run's JSON dump. Installed
official DLC is enabled explicitly; user mods, saves and mod settings are not
copied. The temporary export mod derives its game series from `base/info.json`
and loads after the installed DLC. The installation is read-only during local
extraction, including when sprites need power-of-two padding. The download
fallback's existing installation/cache management is separate from this local
extraction guarantee.

## Encoder repeatability probe

From the repository root, on macOS ARM64 (the bundled encoder's platform):

```shell
node tools/check-basisu-determinism.mjs packages/website/public/favicon.png .github/preview.png
```

The probe runs the bundled `basisu` with the exporter's `-no_multithreading
-mipmap` flags, encodes each image twice using different input and output paths,
compares bytes, checks that the source is unchanged, and prints SHA-256 hashes.
It retains outputs at the printed temporary path for inspection.

Measured on 2026-09-05 with the bundled basisu v1.16.4:

| Input | Output bytes | Identical across paths | Output SHA-256 |
| --- | ---: | --- | --- |
| `packages/website/public/favicon.png` | 6583 | yes | `5bd7f95dd6e1328f3fed0742a3c9784ad3b00299570c0dd39e38c31ea98ded9a` |
| `.github/preview.png` | 295367 | yes | `b735ea3fb3079c1ce1f1e23dd848eff69a4f8b6a8a3cc0ae2d349014930c92d1` |

This establishes repeatability for these samples only. It does not establish
cross-platform/compiler repeatability or equivalence of every Factorio sprite.
The probe encodes the supplied PNG directly; exporter padding is covered by the
Rust tests. Repeat with representative sprites from the intended installation
(and retained padded images) before relying on it for a dataset refresh.

## Before committing a regenerated dataset

1. Start with an unmodified installation of the intended game version and DLC.
   Run the encoder probe on representative source and padded sprites. Keep the
   hashes, encoder version and platform in the PR evidence.
2. Smoke-test extraction with that real installation. Inspect the printed
   temporary profile's `mods/mod-list.json`, `config.ini`, `factorio-current.log`
   (under write-data) and `factorio-output.log`. Confirm the expected version and
   enabled mods, and that the normal profile and installation remain unchanged.
3. Review `data/output/data.json` separately from sprite changes. The current
   metadata cache keys include absolute paths, sizes and mtimes, so a different
   installation path can trigger recompression even when pixels are unchanged.
   Do not commit local absolute-path metadata churn as a game-data change.
4. Triage each changed oracle expectation against the game's output. Distinguish
   genuine version changes from exporter or editor bugs; never bulk re-record
   fixtures to make the suite green. Follow [the oracle guide](../../tools/oracle/README.md).
5. Run `vp check`, `vp test` and the affected browser/oracle coverage. Keep a
   data-only refresh separate from exporter changes and justify any sprite diff
   with source/output evidence.

The [2.0.77 refresh (#155)](https://github.com/FactoryGameFan/factorio-blueprint-editor/issues/155)
and [2.1 migration (#187)](https://github.com/FactoryGameFan/factorio-blueprint-editor/issues/187)
remain separate efforts. The latter also requires the stable-release and type
metadata prerequisites tracked there. This work addresses their shared
[exporter blockers (#351)](https://github.com/FactoryGameFan/factorio-blueprint-editor/issues/351);
it does not regenerate data, change fixtures, or bump the game/type versions.
