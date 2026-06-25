# Space Age Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the exporter to use a local Factorio installation (with Space Age DLC) instead of downloading the base game, so exported data includes Space Age items, enabling blueprint validation to pass for Space Age blueprints.

**Architecture:** Add a `FACTORIO_DIR` env var branch to `main.rs` and `setup.rs`. When set, skip the download, derive platform-specific paths to the executable and game data, write the export mod into the user data directory, run Factorio, and clean up. Generalize the sprite `__modname__` prefix substitution to cover Space Age and other DLC prefixes.

**Tech Stack:** Rust, Tokio async runtime, existing Cargo dependencies. No new dependencies needed.

**Spec:** `docs/superpowers/specs/2026-03-13-space-age-exporter-design.md`

---

## Chunk 1: Path resolution helpers and validation

### Task 1: Add local Factorio path resolution to setup.rs

**Files:**

- Modify: `packages/exporter/src/setup.rs`

These are pure functions with no side effects - easy to reason about and test manually by inspection. No test harness exists in this project, so we verify correctness by reading the output in later tasks.

- [ ] **Step 1: Add the `local_paths` module at the top of `setup.rs`**

Add these functions directly in `setup.rs` after the existing imports. They resolve platform-specific paths from a `FACTORIO_DIR` root.

Also add the module-level regex for sprite prefix substitution here (used by both `extract` and `extract_local` in later tasks):

```rust
lazy_static! {
    // Matches __modname__/ at the start of a sprite path.
    // Handles names with hyphens (space-age) and internal underscores (some_mod).
    // Uses a negative lookahead so a single _ inside the name does not consume the closing __.
    static ref MOD_PREFIX_REGEX: Regex =
        Regex::new(r"^__((?:[^_]|_(?!_))+)__/").unwrap();
}

/// Returns the path to the Factorio executable given the install root.
/// - macOS: {dir}/factorio.app/Contents/MacOS/factorio
/// - Linux: {dir}/bin/x64/factorio
/// - Windows: {dir}\bin\x64\factorio.exe
pub fn local_executable_path(factorio_dir: &Path) -> PathBuf {
    match std::env::consts::OS {
        "macos" => factorio_dir
            .join("factorio.app")
            .join("Contents")
            .join("MacOS")
            .join("factorio"),
        "linux" => factorio_dir.join("bin").join("x64").join("factorio"),
        "windows" => factorio_dir.join("bin").join("x64").join("factorio.exe"),
        os => panic!("unsupported OS: {}", os),
    }
}

/// Returns the path to Factorio's game data directory given the install root.
/// - macOS: {dir}/factorio.app/Contents/data
/// - Linux: {dir}/data
/// - Windows: {dir}\data
pub fn local_game_data_path(factorio_dir: &Path) -> PathBuf {
    match std::env::consts::OS {
        "macos" => factorio_dir
            .join("factorio.app")
            .join("Contents")
            .join("data"),
        _ => factorio_dir.join("data"),
    }
}

/// Returns the Factorio user data directory (where mods/ and script-output/ live).
/// - macOS: ~/Library/Application Support/factorio
/// - Linux: ~/.factorio
/// - Windows: %APPDATA%\Factorio
pub fn user_data_dir() -> Result<PathBuf, Box<dyn Error>> {
    match std::env::consts::OS {
        "macos" | "linux" => {
            let home = get_env_var!("HOME")?;
            let path = match std::env::consts::OS {
                "macos" => PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("factorio"),
                _ => PathBuf::from(home).join(".factorio"),
            };
            Ok(path)
        }
        "windows" => {
            let appdata = get_env_var!("APPDATA")?;
            Ok(PathBuf::from(appdata).join("Factorio"))
        }
        os => Err(format!("unsupported OS: {}", os).into()),
    }
}
```

- [ ] **Step 2: Add validation function**

Add this function after the helpers above. It checks that the local install looks valid before we try to use it:

```rust
/// Validates that FACTORIO_DIR points to a usable Factorio installation.
/// Returns clear error messages if the executable or data dir are missing.
pub fn validate_local_install(factorio_dir: &Path) -> Result<(), Box<dyn Error>> {
    let exe = local_executable_path(factorio_dir);
    if !exe.is_file() {
        return Err(format!(
            "FACTORIO_DIR is set to \"{}\" but executable not found at \"{}\".\n\
             Check that FACTORIO_DIR points to your Factorio installation root.",
            factorio_dir.display(), exe.display()
        )
        .into());
    }

    let data = local_game_data_path(factorio_dir);
    if !data.is_dir() {
        return Err(format!(
            "FACTORIO_DIR is set to \"{}\" but game data directory not found at \"{}\".\n\
             Check that FACTORIO_DIR points to your Factorio installation root.",
            factorio_dir.display(), data.display()
        )
        .into());
    }

    Ok(())
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter
cargo build 2>&1
```

Expected: compiles without errors (warnings are fine).

- [ ] **Step 4: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add packages/exporter/src/setup.rs
git commit -m "feat(exporter): add local Factorio path resolution helpers"
```

---

### Task 2: Generalize sprite path prefix substitution

**Files:**

- Modify: `packages/exporter/src/setup.rs` (the `extract` function, around line 191)

Currently the code only handles `__core__` and `__base__` prefixes. Space Age sprites use `__space-age__`, quality uses `__quality__`, elevated rails uses `__elevated-rails__`. We need to handle any `__modname__` prefix generically.

- [ ] **Step 1: Replace the hardcoded prefix substitutions in `extract`**

Find this block in `setup.rs` (around line 188-196):

```rust
    let file_paths = file_paths
        .into_iter()
        .map(|s| {
            let in_path =
                factorio_data.join(s.replace("__core__", "core").replace("__base__", "base"));
            let out_path = output_dir.join(s.replace(".png", ".basis").as_str());
            (in_path, out_path)
        })
        .collect::<Vec<(PathBuf, PathBuf)>>();
```

Replace with (uses `MOD_PREFIX_REGEX` defined at module scope in Task 1):

```rust
    let file_paths = file_paths
        .into_iter()
        .map(|s| {
            // Replace __modname__/ prefix with the mod's directory under factorio_data.
            // e.g. __space-age__/graphics/foo.png -> {factorio_data}/space-age/graphics/foo.png
            let resolved = MOD_PREFIX_REGEX.replace(&s, |caps: &regex::Captures| {
                format!("{}/", &caps[1])
            });
            let in_path = factorio_data.join(resolved.as_ref());
            let out_path = output_dir.join(s.replace(".png", ".basis").as_str());
            (in_path, out_path)
        })
        .collect::<Vec<(PathBuf, PathBuf)>>();
```

Note: `factorio_data` is defined earlier in `extract` as `base_factorio_dir.join("data")`. This change is backward-compatible - `__core__` and `__base__` are handled correctly by the new regex.

- [ ] **Step 2: Build to verify it compiles**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter
cargo build 2>&1
```

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add packages/exporter/src/setup.rs
git commit -m "feat(exporter): generalize sprite __modname__ prefix substitution"
```

---

## Chunk 2: Local extract flow

### Task 3: Add `extract_local` function to setup.rs

**Files:**

- Modify: `packages/exporter/src/setup.rs`

This is a new async function that runs the export scenario against a local Factorio installation. It mirrors `extract` but uses the local paths from Task 1 and writes/cleans up from the user data directory.

- [ ] **Step 1: Add `extract_local` function**

Add this function in `setup.rs` after the existing `extract` function:

```rust
pub async fn extract_local(
    output_dir: &Path,
    factorio_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    let factorio_executable = local_executable_path(factorio_dir);
    let factorio_data = local_game_data_path(factorio_dir);
    let user_data = user_data_dir()?;

    let mod_dir = user_data.join("mods").join("export-data");
    let scenario_dir = user_data.join("scenarios").join("export-data");
    let extracted_data_path = user_data.join("script-output").join("data.json");

    let info = include_str!("export-data/info.json");
    let script = include_str!("export-data/control.lua");
    let data = include_str!("export-data/data-final-fixes.lua");
    let locale = generate_locale(&factorio_data).await?;

    // Write export-data mod files
    tokio::fs::create_dir_all(&mod_dir).await.map_err(|e| {
        format!(
            "Failed to write to mods directory \"{}\": {}. \
             Check that the directory is writable.",
            mod_dir.display(), e
        )
    })?;
    tokio::fs::create_dir_all(&scenario_dir).await?;

    tokio::fs::write(mod_dir.join("info.json"), info).await?;
    tokio::fs::write(mod_dir.join("locale.lua"), locale).await?;
    tokio::fs::write(mod_dir.join("data-final-fixes.lua"), data).await?;
    tokio::fs::write(scenario_dir.join("control.lua"), script).await?;

    println!("Running Factorio to generate data...");

    Command::new(&factorio_executable)
        .args(&["--start-server-load-scenario", "export-data/export-data"])
        .stdout(std::process::Stdio::null())
        .spawn()?
        .wait()
        .await?;

    let content = tokio::fs::read_to_string(&extracted_data_path).await?;
    tokio::fs::create_dir_all(&output_dir).await?;
    tokio::fs::write(output_dir.join("data.json"), &content).await?;

    // Process sprites using game data dir from local install
    let metadata_path = output_dir.join("metadata.json");
    let res = tokio::fs::read_to_string(&metadata_path).await;
    let old_metadata: HashMap<String, (u64, u64)> = match res {
        Ok(buffer) => serde_json::from_str(&buffer)?,
        Err(e) => match e.kind() {
            std::io::ErrorKind::NotFound => HashMap::new(),
            _ => return Err(Box::new(e)),
        },
    };
    let new_metadata = Arc::new(Mutex::new(HashMap::new()));

    lazy_static! {
        static ref IMG_REGEX_LOCAL: Regex = Regex::new(r#""([^"]+?\.png)""#).unwrap();
    }

    let file_paths: HashSet<String> = IMG_REGEX_LOCAL
        .captures_iter(&content)
        .map(|cap| cap[1].to_string())
        .collect();

    // Reuse module-level MOD_PREFIX_REGEX defined in Task 1
    let file_paths = file_paths
        .into_iter()
        .map(|s| {
            let resolved = MOD_PREFIX_REGEX.replace(&s, |caps: &regex::Captures| {
                format!("{}/", &caps[1])
            });
            let in_path = factorio_data.join(resolved.as_ref());
            let out_path = output_dir.join(s.replace(".png", ".basis").as_str());
            (in_path, out_path)
        })
        .collect::<Vec<(PathBuf, PathBuf)>>();

    let progress = ProgressBar::new(file_paths.len() as u64);
    progress.set_style(
        ProgressStyle::default_bar()
            .template("{wide_bar} {pos}/{len} ({elapsed})")
            .unwrap(),
    );

    let file_paths = Arc::new(Mutex::new(file_paths));
    let tmp_dir = std::env::temp_dir().join("__FBE__");
    tokio::fs::create_dir_all(&tmp_dir).await?;

    let available_parallelism =
        std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get);

    futures::future::try_join_all((0..available_parallelism).map(|_| {
        compress_next_img(
            file_paths.clone(),
            &tmp_dir,
            progress.clone(),
            &old_metadata,
            new_metadata.clone(),
        )
    }))
    .await?;

    let new_metadata = {
        let new_metadata = new_metadata.lock().unwrap();
        serde_json::to_vec(&*new_metadata)?
    };
    tokio::fs::write(metadata_path, new_metadata).await?;

    progress.finish();
    tokio::fs::remove_dir_all(&tmp_dir).await?;

    // Clean up export-data mod and scenario from user data dir
    if let Err(e) = tokio::fs::remove_dir_all(&mod_dir).await {
        eprintln!("Warning: failed to clean up mod directory \"{}\": {}", mod_dir.display(), e);
    }
    if let Err(e) = tokio::fs::remove_dir_all(&scenario_dir).await {
        eprintln!("Warning: failed to clean up scenario directory \"{}\": {}", scenario_dir.display(), e);
    }

    println!("DONE!");
    Ok(())
}
```

- [ ] **Step 2: Build to verify it compiles**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter
cargo build 2>&1
```

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add packages/exporter/src/setup.rs
git commit -m "feat(exporter): add extract_local for local Factorio installation"
```

---

## Chunk 3: Wire up main.rs

### Task 4: Update main.rs to branch on FACTORIO_DIR

**Files:**

- Modify: `packages/exporter/src/main.rs`

Replace the hardcoded OS panic and always-download flow with a branch: if `FACTORIO_DIR` is set, validate and use the local flow; otherwise fall through to the existing download flow (which still panics on macOS - that's acceptable since macOS users will use `FACTORIO_DIR`).

- [ ] **Step 1: Replace the body of `main` in `main.rs`**

Replace the entire `main` function with:

```rust
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok(); // .ok() so missing .env file is not fatal

    let output_dir = DATA_DIR.join("output");

    if let Ok(factorio_dir_str) = std::env::var("FACTORIO_DIR") {
        let factorio_dir = std::path::PathBuf::from(&factorio_dir_str);
        setup::validate_local_install(&factorio_dir)?;
        setup::extract_local(&output_dir, &factorio_dir).await?;
    } else {
        let factorio_dir_name = match std::env::consts::OS {
            "linux" => "factorio",
            "windows" => &format!("Factorio_{FACTORIO_VERSION}"),
            _ => panic!("unsupported OS - set FACTORIO_DIR to use a local Factorio installation"),
        };
        let base_factorio_dir = DATA_DIR.join(factorio_dir_name);
        setup::download_factorio(&DATA_DIR, &base_factorio_dir, FACTORIO_VERSION).await?;
        setup::extract(&output_dir, &base_factorio_dir).await?;
    }

    let static_ = Static::new(Path::new("data/output/"));
    let listener =
        TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], 8081))).await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let static_ = static_.clone();
        tokio::spawn(async move {
            if let Err(err) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(|req| static_.clone().serve(req)))
                .await
            {
                eprintln!("Error serving connection: {}", err);
            }
        });
    }
}
```

Note: `dotenvy::dotenv().ok()` instead of `dotenvy::dotenv()?` - this makes a missing `.env` file non-fatal (acceptable since `FACTORIO_DIR` can also be set as a real environment variable).

- [ ] **Step 2: Build to verify it compiles**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter
cargo build 2>&1
```

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add packages/exporter/src/main.rs
git commit -m "feat(exporter): branch on FACTORIO_DIR to support local install"
```

---

## Chunk 4: End-to-end verification

### Task 5: Verify the local flow works against your Factorio installation

- [ ] **Step 1: Create a `.env` file in the exporter directory**

```bash
cat > /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter/.env << 'EOF'
FACTORIO_DIR=/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio
EOF
```

- [ ] **Step 2: Verify the path helpers resolve correctly**

Add a temporary `println!` in `main.rs` after the `validate_local_install` call to print resolved paths, run once, then remove it:

```rust
println!("Executable: {:?}", setup::local_executable_path(&factorio_dir));
println!("Game data: {:?}", setup::local_game_data_path(&factorio_dir));
println!("User data: {:?}", setup::user_data_dir()?);
```

Expected output:

```
Executable: "/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio"
Game data: "/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data"
User data: "/Users/ericjohnson/Library/Application Support/factorio"
```

Remove the `println!`s after confirming, then rebuild.

- [ ] **Step 3: Run the exporter**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter
cargo run --release 2>&1
```

Expected:

- No panic on startup
- Factorio launches and runs the scenario
- `data/output/data.json` is created
- Sprite `.basis` files are created under `data/output/`
- Mod and scenario dirs are cleaned up from `~/Library/Application Support/factorio/`
- Server starts listening on `:8081`

- [ ] **Step 4: Verify Space Age items are in the exported data**

```bash
grep -c "agricultural-science-pack" /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/packages/exporter/data/output/data.json
```

Expected: a count greater than 0.

- [ ] **Step 5: Load the blueprint in the local dev site**

In a separate terminal, start the website:

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
npm run start:website
```

Open the URL from the bug report in your browser:

```
http://localhost:5173/?source=https://www.factorio.school/api/blueprintData/ebecb9c63d1e56847148f8bd2a47115bdac5ade3/
```

Expected: blueprint loads without the "Blueprint with modded items not supported yet" error.

- [ ] **Step 6: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add packages/exporter/.env
```

Wait - `.env` should NOT be committed (it contains a personal path and potentially credentials). Add it to `.gitignore` if not already there:

```bash
grep -q "^\.env$" packages/exporter/.gitignore 2>/dev/null || echo ".env" >> packages/exporter/.gitignore
git add packages/exporter/.gitignore
git commit -m "chore(exporter): ensure .env is gitignored"
```

---

### Task 6: Update CONTRIBUTING.md

**Files:**

- Modify: `CONTRIBUTING.md`

The existing CONTRIBUTING.md documents the download-based setup. Add a section for the local Factorio flow so contributors with Space Age can get started.

- [ ] **Step 1: Read the existing CONTRIBUTING.md**

```bash
cat /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor/CONTRIBUTING.md
```

- [ ] **Step 2: Add a section for local Factorio setup**

Find the section describing the `.env` setup and add after it:

```markdown
### Using a local Factorio installation (required for Space Age support)

If you have Factorio installed locally (including the Space Age expansion), you can skip the download step by setting `FACTORIO_DIR` in your `.env` file:
```

FACTORIO_DIR=/path/to/your/factorio/installation

```

Platform-specific paths:

| Platform | Example path |
|---|---|
| macOS (Steam) | `/Users/<you>/Library/Application Support/Steam/steamapps/common/Factorio` |
| Linux (Steam) | `~/.steam/steam/steamapps/common/Factorio` |
| Windows (Steam) | `C:\Program Files (x86)\Steam\steamapps\common\Factorio` |

When `FACTORIO_DIR` is set, `FACTORIO_USERNAME` and `FACTORIO_TOKEN` are not needed. The exporter will use your local Factorio installation and automatically include any DLC content (Space Age, Quality, Elevated Rails) that is installed.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ericjohnson/Documents/GitHub/factorio-blueprint-editor
git add CONTRIBUTING.md
git commit -m "docs: document local Factorio install option for Space Age support"
```

---

## Done

At this point:

- `FACTORIO_DIR` unset: existing download flow unchanged (Linux/Windows)
- `FACTORIO_DIR` set: local flow with Space Age data exported
- macOS no longer panics when `FACTORIO_DIR` is set
- Space Age blueprints pass schema validation
- `__modname__` sprite paths handled generically

Next step: open a PR to `teoxoy/factorio-blueprint-editor` from the `wormeyman-space-age-support` branch.
