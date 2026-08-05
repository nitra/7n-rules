//! Спільна обв'язка cross-language parity-гейтів концерну `k8s/manifests`.
//!
//! Обидва гейти (`k8s_manifests_parity.rs` — зріз 1,
//! `k8s_manifests_slice2_parity.rs` — зріз 2) влаштовані однаково: зібрати
//! тимчасове дерево, порахувати список YAML **нативно**
//! ([`rules_core::concerns::find_k8s_yaml_files`]), прогнати обидві сторони на
//! цьому списку і звірити повідомлення посимвольно. Різняться вони рівно
//! двома речами — JS-драйвером і набором native-функцій, тож усе інше живе
//! тут.
//!
//! Чому не окремий крейт: `tests/common/mod.rs` — конвенція Cargo для
//! спільного коду інтеграційних тестів (підкаталог `tests/` у власний
//! тест-бінар не збирається), і вона не тягне ні нового члена workspace, ні
//! запису в `Cargo.toml`.

// Кожен гейт тягне лише частину API цього модуля — це нормальна властивість
// спільної обв'язки, а не мертвий код.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use rules_core::concerns::find_k8s_yaml_files;
use tempfile::TempDir;

/// Корінь репо: `<repo>/crates/rules-core` → два рівні вгору.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/rules-core лежить на два рівні під коренем репо")
        .to_path_buf()
}

/// Чи є все потрібне для JS-боку (інакше гейт пропускається) — `node` у PATH,
/// `node_modules` у корені репо і сам канон на місці.
pub fn js_canon_available() -> bool {
    let root = repo_root();
    root.join("node_modules").is_dir()
        && root.join("npm/rules/k8s/manifests/main.mjs").is_file()
        && Command::new("node")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
}

/// Кладе файл у тимчасове дерево, створюючи батьківські каталоги.
pub fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    std::fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    std::fs::write(abs, content).expect("write");
}

/// Проганяє JS-драйвер у дочірньому `node` і повертає надрукований ним
/// JSON-масив повідомлень. Драйвер і його вхід кладуться в корінь дерева;
/// `.mjs`/`.json` під `k8s` не потрапляють, тож на вибірку файлів не впливають.
pub fn js_messages(tmp: &TempDir, driver_src: &str, files: &[PathBuf]) -> Vec<String> {
    let root = tmp.path();
    let driver = root.join(".parity-driver.mjs");
    std::fs::write(&driver, driver_src).expect("write driver");
    let files_json = root.join(".parity-files.json");
    let payload: Vec<String> = files
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    std::fs::write(
        &files_json,
        serde_json::to_string(&payload).expect("serialize"),
    )
    .expect("write files json");

    let canon = repo_root().join("npm/rules/k8s/manifests/main.mjs");
    let output = Command::new("node")
        .arg(&driver)
        .arg(root)
        .arg(&canon)
        .arg(&files_json)
        .output()
        .expect("спавн node");
    assert!(
        output.status.success(),
        "JS-канон впав: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout драйвера не JSON ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

/// Звіряє native і JS на дереві, зібраному `build`.
///
/// `gate` — ім'я гейта для повідомлення про пропуск; `label` додатково
/// позначає фікстуру. Мітка, що починається з `clean`, дозволяє порожній
/// вислід — решта фікстур мусить щось репортити, інакше гейт нічого не міряє.
pub fn assert_parity(
    gate: &str,
    label: &str,
    driver_src: &str,
    native: impl Fn(&Path, &[PathBuf]) -> Vec<String>,
    build: impl Fn(&TempDir),
) {
    if !js_canon_available() {
        eprintln!("{gate}[{label}]: пропуск — немає node/node_modules");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    build(&tmp);
    let files = find_k8s_yaml_files(tmp.path(), &[]);
    assert!(!files.is_empty(), "[{label}] фікстура без YAML під k8s");
    let native = native(tmp.path(), &files);
    let js = js_messages(&tmp, driver_src, &files);
    assert_eq!(native, js, "[{label}] розбіжність native ↔ JS");
    assert!(
        !native.is_empty() || label.starts_with("clean"),
        "[{label}] фікстура нічого не репортує — гейт був би порожній"
    );
}
