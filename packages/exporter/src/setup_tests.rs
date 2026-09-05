use super::*;

fn fixture_dir() -> PathBuf {
    new_work_dir(&std::env::temp_dir(), "fbe-export-test").unwrap()
}

fn fake_game(mods: &[&str], version: &str) -> PathBuf {
    let data = fixture_dir().join("game data");
    for name in mods {
        let dir = data.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("info.json"),
            serde_json::to_vec(&serde_json::json!({ "name": name, "version": version })).unwrap(),
        )
        .unwrap();
    }
    data
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[tokio::test]
async fn isolated_profile_enables_only_installed_official_mods() {
    let data = fake_game(
        &[
            "base",
            "quality",
            "elevated-rails",
            "space-age",
            "foreign-mod",
        ],
        "2.0.77",
    );
    let work = prepare_export(&data).await.unwrap();
    let second = prepare_export(&data).await.unwrap();
    assert_ne!(work.root, second.root);
    assert!(!work.dump.exists());
    let config = std::fs::read_to_string(&work.config).unwrap();
    assert!(config.contains(&format!(
        "read-data={}",
        config_path(&data.canonicalize().unwrap()).unwrap()
    )));
    assert!(config.contains(&format!(
        "write-data={}",
        config_path(&work.root.join("write-data")).unwrap()
    )));
    assert_eq!(
        read_json(&work.mods.join("mod-list.json")),
        serde_json::json!({
            "mods": [
                { "name": "base", "enabled": true },
                { "name": "quality", "enabled": true },
                { "name": "elevated-rails", "enabled": true },
                { "name": "space-age", "enabled": true },
                { "name": "export-data", "enabled": true }
            ]
        })
    );
    let info = read_json(&work.mods.join("export-data/info.json"));
    assert_eq!(info["factorio_version"], "2.0");
    assert_eq!(
        info["dependencies"],
        serde_json::json!([
            "base >= 2.0.0",
            "? quality",
            "? elevated-rails",
            "? space-age"
        ])
    );
    assert!(work
        .mods
        .join("export-data/scenarios/export-data/control.lua")
        .is_file());
    assert!(!data.join("mods").exists());
    assert!(!data.join("script-output").exists());
}

#[test]
fn config_paths_handle_windows_canonical_paths_and_reject_newlines() {
    for (input, expected) in [
        (
            r"\\?\C:\Program Files\Factorio\data",
            "C:/Program Files/Factorio/data",
        ),
        (r"\\?\UNC\server\share\data", "//server/share/data"),
        (r"C:\Factorio\data", "C:/Factorio/data"),
        (
            "/Applications/Factorio.app/Contents/data",
            "/Applications/Factorio.app/Contents/data",
        ),
    ] {
        assert_eq!(config_path(Path::new(input)).unwrap(), expected);
    }
    assert!(config_path(Path::new("/data\nwrite-data=/profile")).is_err());
    assert!(config_path(Path::new("/data\rwrite-data=/profile")).is_err());
}

#[tokio::test]
async fn base_only_install_does_not_enable_missing_dlc_and_uses_installed_series() {
    let work = prepare_export(&fake_game(&["base"], "2.1.12"))
        .await
        .unwrap();
    let info = read_json(&work.mods.join("export-data/info.json"));
    assert_eq!(info["factorio_version"], "2.1");
    assert_eq!(info["dependencies"], serde_json::json!(["base >= 2.0.0"]));
    assert_eq!(
        read_json(&work.mods.join("mod-list.json"))["mods"],
        serde_json::json!([
            { "name": "base", "enabled": true }, { "name": "export-data", "enabled": true }
        ])
    );
}

#[test]
fn accepts_direct_macos_bundles_and_steam_install_roots() {
    let bundle = Path::new("/downloads/factorio_space_age_mac_2_0_77.app");
    assert_eq!(macos_bundle_path(bundle), bundle);
    assert_eq!(
        macos_bundle_path(Path::new("/steam/Factorio")),
        Path::new("/steam/Factorio/factorio.app")
    );
    #[cfg(target_os = "macos")]
    {
        assert_eq!(
            local_executable_path(bundle),
            bundle.join("Contents/MacOS/factorio")
        );
        assert_eq!(local_game_data_path(bundle), bundle.join("Contents/data"));
    }
}

#[tokio::test]
async fn padding_preserves_source_pngs_and_separates_matching_basenames() {
    let root = fixture_dir();
    let scratch = root.join("scratch");
    std::fs::create_dir(&scratch).unwrap();
    let mut outputs = Vec::new();
    for (name, color) in [("base", [255, 0, 0, 255]), ("quality", [0, 255, 0, 255])] {
        let dir = root.join(name);
        std::fs::create_dir(&dir).unwrap();
        let source = dir.join("same.png");
        image::RgbaImage::from_pixel(3, 5, image::Rgba(color))
            .save(&source)
            .unwrap();
        let before = std::fs::read(&source).unwrap();
        let output = make_img_pow2(&source, &scratch).await.unwrap().into_owned();
        assert!(output.starts_with(&scratch));
        assert_ne!(output, source);
        assert_eq!(std::fs::read(&source).unwrap(), before);
        let padded = image::open(&output).unwrap().into_rgba8();
        assert_eq!(padded.dimensions(), (4, 8));
        assert_eq!(padded.get_pixel(2, 4), &image::Rgba(color));
        assert_eq!(padded.get_pixel(3, 7), &image::Rgba([0, 0, 0, 0]));
        outputs.push(output);
    }
    assert_ne!(outputs[0], outputs[1]);
}

#[tokio::test]
async fn power_of_two_image_is_borrowed_without_rewriting() {
    let root = fixture_dir();
    let source = root.join("sprite.png");
    image::RgbaImage::new(4, 8).save(&source).unwrap();
    let before = std::fs::read(&source).unwrap();
    assert!(matches!(
        make_img_pow2(&source, &root).await.unwrap(),
        Cow::Borrowed(_)
    ));
    assert_eq!(std::fs::read(&source).unwrap(), before);
}

#[cfg(unix)]
fn fake_factorio(body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let executable = fixture_dir().join("fake factorio");
    std::fs::write(&executable, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    executable
}

#[cfg(unix)]
#[tokio::test]
async fn invokes_factorio_in_isolation_and_accepts_its_deliberate_error_exit() {
    let work = prepare_export(&fake_game(&["base"], "2.0.77"))
        .await
        .unwrap();
    let executable = fake_factorio(
        "printf '%s\\n' \"$@\" > args.txt\nmkdir -p write-data/script-output\nprintf '{\"entities\":{}}' > write-data/script-output/data.json\nexit 1"
    );
    let content = run_factorio_export(&executable, &work).await.unwrap();
    assert_eq!(content, "{\"entities\":{}}");
    let args = std::fs::read_to_string(work.root.join("args.txt")).unwrap();
    assert_eq!(
        args.lines().collect::<Vec<_>>(),
        vec![
            "--config",
            work.config.to_str().unwrap(),
            "--mod-directory",
            work.mods.to_str().unwrap(),
            "--start-server-load-scenario",
            "export-data/export-data"
        ]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn missing_dump_cannot_reuse_a_previous_runs_output() {
    let data = fake_game(&["base"], "2.0.77");
    let previous = prepare_export(&data).await.unwrap();
    std::fs::create_dir_all(previous.dump.parent().unwrap()).unwrap();
    std::fs::write(&previous.dump, "{\"old\":true}").unwrap();
    let work = prepare_export(&data).await.unwrap();
    let error = run_factorio_export(&fake_factorio("exit 0"), &work)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("no readable dump"));
    assert!(error.to_string().contains("factorio-output.log"));
    assert_eq!(
        std::fs::read_to_string(previous.dump).unwrap(),
        "{\"old\":true}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_an_invalid_dump_even_when_factorio_exits_successfully() {
    let work = prepare_export(&fake_game(&["base"], "2.0.77"))
        .await
        .unwrap();
    let executable = fake_factorio(
        "mkdir -p write-data/script-output\nprintf 'not json' > write-data/script-output/data.json\nexit 0"
    );
    assert!(run_factorio_export(&executable, &work).await.is_err());
}
