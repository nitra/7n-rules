//! Спільна обвʼязка `require_fixture`-гейтів wasm-фікстур цього крейта
//! (`contract_test_kit.rs`, `plugin_ci_azure.rs`, `plugin_ci_github.rs`,
//! `plugin_lang_js.rs`, `plugin_lang_php.rs`) — конвенція `tests/common/mod.rs`
//! та сама, що в `crates/rules-core/tests/common/mod.rs` (підкаталог `tests/`
//! у власний тест-бінар не збирається, тож спільний код лежить тут без
//! нового члена workspace).
//!
//! До цього модуля кожен із пʼяти файлів окремо перевіряв лише
//! `path.is_file()` — і жоден не перевіряв СВІЖІСТЬ. Це не теоретична діра:
//! датований `.wasm` у `target/` (build-директорія, поза git) двічі за
//! задачу PR #555 давав фальшиві падіння парності — спершу 5, потім 16
//! тестів `wasm-plugin-parity.test.mjs` (JS-дзеркало цих самих Rust-гейтів)
//! падали мовчки-неправильно, бо скопійований/застарілий артефакт зібраний
//! зі СТАРІШОГО джерела, ніж дерево, яке проти нього звірялось. `is_file()`
//! мовчав — файл-бо на місці. [`require_fresh_fixture`] закриває саме цю
//! діру: панікує, якщо `mtime` артефакту старіший за найновіший `mtime` у
//! відповідному `crates/<crate_dir_name>` (`Cargo.toml`/`build.sh`/
//! `plugin.toml`/`src/**`).

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Корінь репо: `crates/rules-plugin-host` → два рівні вгору.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/rules-plugin-host лежить на два рівні під коренем репо")
        .to_path_buf()
}

/// Рекурсивно шукає найновіший `mtime` серед файлів під `dir`. `None`, якщо
/// каталог відсутній чи порожній — той самий fail-safe шлях, що і в
/// `rules-core`-парності: краще пропустити звірку свіжості, ніж панікувати
/// на цілком штатному стані (наприклад, `crate_dir_name` набув іншої назви).
fn newest_mtime(dir: &Path) -> Option<SystemTime> {
    let mut newest: Option<SystemTime> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(entry.path());
                continue;
            }
            if let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) {
                newest = Some(newest.map_or(modified, |current_newest| current_newest.max(modified)));
            }
        }
    }
    newest
}

/// Панікує, якщо `.wasm`-фікстура `wasm_path` відсутня АБО застаріла відносно
/// джерела крейта `crates/<crate_dir_name>` — інакше повертає `wasm_path`.
///
/// `subject` — іменник для повідомлення (`"wasm-компонент plugin-lang-js"`,
/// `"guest-фікстура contract-test-kit"`) у формулюванні, що узгоджується з
/// НЕЙТРАЛЬНИМ присудком (`не зібрано`/`застаріло`) незалежно від роду
/// `subject` — щоб не тримати окремий рід-параметр заради граматики.
/// `build_cmd` — точна команда збірки з підказки повідомлення.
pub fn require_fresh_fixture(
    wasm_path: &Path,
    subject: &str,
    crate_dir_name: &str,
    build_cmd: &str,
) -> PathBuf {
    assert!(
        wasm_path.is_file(),
        "{subject} не зібрано: {} відсутній.\nЗберіть командою: {build_cmd}",
        wasm_path.display(),
    );
    let crate_dir = repo_root().join("crates").join(crate_dir_name);
    let wasm_mtime = fs::metadata(wasm_path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or_else(|error| panic!("не вдалось прочитати mtime {}: {error}", wasm_path.display()));
    if let Some(newest_src) = newest_mtime(&crate_dir) {
        assert!(
            wasm_mtime >= newest_src,
            "{subject} застаріло: джерело в {} новіше за зібраний .wasm ({}) — тест звірявся б \
             зі СТАРОЮ поведінкою мовчки.\nПеребудуйте командою: {build_cmd}",
            crate_dir.display(),
            wasm_path.display(),
        );
    }
    wasm_path.to_path_buf()
}
