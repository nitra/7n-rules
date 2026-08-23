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
    let tmp = TempDir::new().expect("tempdir");
    build(&tmp);
    let files = find_k8s_yaml_files(tmp.path(), &[]);
    assert!(!files.is_empty(), "[{label}] фікстура без YAML під k8s");
    let native = native(tmp.path(), &files);
    let key = format!("{gate}/{label}");

    // Режим ЗНЯТТЯ: JS-канон іще на місці, тож його вихід зберігається у
    // фікстуру. Вмикається лише вручну (`N_K8S_PARITY_CAPTURE=<тека>`) —
    // звичайний прогін ніколи сюди не заходить.
    if let Some(dir) = std::env::var_os(CAPTURE_ENV) {
        let js = js_messages(&tmp, driver_src, &files);
        capture(&PathBuf::from(dir), &key, &js);
        assert_eq!(native, js, "[{label}] розбіжність native ↔ JS");
    } else {
        assert_eq!(
            native,
            expected_messages(&key),
            "[{label}] розбіжність із каноном"
        );
    }
    assert!(
        !native.is_empty() || label.starts_with("clean"),
        "[{label}] фікстура нічого не репортує — гейт був би порожній"
    );
}

/// Змінна режиму зняття фікстури.
const CAPTURE_ENV: &str = "N_K8S_PARITY_CAPTURE";

/// Знята з живого JS-канону відповідь на кожен сценарій.
///
/// Канон видалено разом із портом, тож звірятися напряму більше нема з чим.
/// Фікстура — його ЗБЕРЕЖЕНИЙ вихід: та сама сила перевірки, лише без
/// дочірнього `node`. Перезняти можна, повернувши `main.mjs` з історії й
/// прогнавши з `N_K8S_PARITY_CAPTURE=<тека>`.
const CANON: &str = include_str!("../fixtures/js-k8s-parity.json");

fn expected_messages(key: &str) -> Vec<String> {
    let canon: serde_json::Value = serde_json::from_str(CANON).expect("фікстура — валідний JSON");
    let entry = canon
        .get(key)
        .unwrap_or_else(|| panic!("у фікстурі немає сценарію {key} — перезніми з каноном"));
    entry
        .as_array()
        .expect("сценарій — масив рядків")
        .iter()
        .map(|item| item.as_str().expect("повідомлення — рядок").to_string())
        .collect()
}

fn capture(dir: &Path, key: &str, messages: &[String]) {
    std::fs::create_dir_all(dir).expect("тека зняття");
    let name = key.replace(['/', ' ', ':'], "_");
    std::fs::write(
        dir.join(format!("{name}.json")),
        serde_json::to_string(&serde_json::json!({ "key": key, "messages": messages }))
            .expect("serialize"),
    )
    .expect("запис знятого сценарію");
}
