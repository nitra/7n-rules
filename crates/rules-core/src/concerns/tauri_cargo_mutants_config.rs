//! Native-порт `tauri/cargo_mutants_config`
//! (`npm/rules/tauri/cargo_mutants_config/main.mjs`, 152 рядки) — read-only
//! detector: лише ЗВІТУЄ про відсутній чи неповний
//! `<ws>/src-tauri/.cargo/mutants.toml` (відсутні канонічні Tauri-ключі).
//!
//! Автофікс (створення/доповнення baseline) лишається у JS
//! `fix-cargo_mutants_config.mjs` — той файл і далі імпортує
//! `buildBaseline`/`buildAppended`/`detectMissingKeys`/`findSrcTauriDirs`
//! напряму з незміненого `main.mjs`, не з `violation.data` цього native-порту
//! (у відрізняється від `tauri/gitignore_target`, де фікс читає саме
//! `violation.data.missing`). Тож тут важливий лише 1:1 контракт
//! `reason`/`file` — по `reason` fix-пайплайн вирішує, чи запускати T0-патерн
//! узагалі (`fix-cargo_mutants_config.mjs:29`: `v.reason === MUTANTS_CONFIG_MISSING
//! || v.reason === MUTANTS_KEYS_MISSING`).

use std::path::Path;

use crate::concerns::find_src_tauri::{find_src_tauri_dirs, relative_posix};
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason: файл mutants-конфігу відсутній узагалі — порт
/// `MUTANTS_CONFIG_MISSING` (`main.mjs:18`).
pub const MUTANTS_CONFIG_MISSING: &str = "mutants-config-missing";
/// Стабільний reason: mutants-конфіг є, але бракує канонічних Tauri-ключів —
/// порт `MUTANTS_KEYS_MISSING` (`main.mjs:20`).
pub const MUTANTS_KEYS_MISSING: &str = "mutants-keys-missing";

/// Канонічні top-level ключі mutants-конфігу Tauri, у порядку — точний порт
/// `TAURI_CANONICAL_KEYS = Object.keys(TAURI_KEY_SNIPPETS)` (`main.mjs:29,50`).
/// `pub(crate)` — перевикористовує native-фікс цього concern-а (`super::fix`,
/// T2 зрізу 5 фази 7: порядок append-блоку той самий, що порядок ключів тут).
pub(crate) const TAURI_CANONICAL_KEYS: &[&str] = &["additional_cargo_test_args", "exclude_globs"];

/// Зчитує існуючий `.cargo/mutants.toml` і повертає top-level ключі, яких ще
/// немає — точний порт `detectMissingKeys` (`main.mjs:80-84`) для щасливого
/// шляху.
///
/// Fail-safe відхилення від JS: якщо файл нечитабельний чи TOML побитий
/// (гонитва між перевіркою `existsSync` викликом і цим читанням, чи ручна
/// правка з синтаксичною помилкою), JS-версія кидає (`parseToml` синхронно
/// в `async`-функції → rejected promise); тут — той самий fail-safe принцип,
/// що й в інших native-концернах цього крейту (`workspaces`-модуль,
/// doc-комент там): деградує до «усі канонічні ключі відсутні», не панікує.
/// `pub(crate)` — перевикористовує native-фікс (`super::fix`) для
/// augment-гілки (той самий скан, що й detector).
pub(crate) fn detect_missing_keys(target_path: &Path) -> Vec<&'static str> {
    let table = std::fs::read_to_string(target_path)
        .ok()
        .and_then(|content| toml::from_str::<toml::Table>(&content).ok())
        .unwrap_or_default();
    TAURI_CANONICAL_KEYS
        .iter()
        .copied()
        .filter(|k| !table.contains_key(*k))
        .collect()
}

/// Detector `tauri/cargo_mutants_config` — точний порт `lint(ctx)`
/// (`main.mjs:141-152` + `reportOneSrcTauri`, `main.mjs:118-138`).
pub fn tauri_cargo_mutants_config(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();
    for dir in find_src_tauri_dirs(cwd) {
        let target = dir.join(".cargo").join("mutants.toml");
        let rel = relative_posix(cwd, &target);

        if !target.exists() {
            violations.push(Violation {
                reason: MUTANTS_CONFIG_MISSING.to_string(),
                message: format!(
                    ".cargo/mutants.toml відсутній ({rel}) — запусти `npx @7n/rules lint tauri` для Tauri canonical baseline (tauri.mdc)"
                ),
                file: Some(rel),
                severity: Severity::Error,
                data: None,
            });
            continue;
        }

        let missing = detect_missing_keys(&target);
        if missing.is_empty() {
            continue;
        }

        violations.push(Violation {
            reason: MUTANTS_KEYS_MISSING.to_string(),
            message: format!(
                ".cargo/mutants.toml: бракує канонічних Tauri-ключів [{}] ({rel}) — запусти `npx @7n/rules lint tauri` (tauri.mdc)",
                missing.join(", ")
            ),
            file: Some(rel),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "missing": missing })),
        });
    }
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    /// Реальний Tauri monorepo-layout: workspace `app` з власним
    /// `package.json` (JS-frontend) + `src-tauri` (Rust-backend) — дзеркало
    /// `makeProj({ layout: 'tauri' })` (`cargo_mutants_config.test.mjs:55-63`).
    fn make_tauri_proj(tmp: &TempDir) {
        write(tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(
            tmp,
            "app/package.json",
            r#"{"name":"app","version":"0.0.0"}"#,
        );
        write(
            tmp,
            "app/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\nversion=\"0.1.0\"\n",
        );
    }

    /// «немає src-tauri/ — silent skip» (`:97-102`).
    #[test]
    fn missing_src_tauri_is_silent_skip() {
        let tmp = TempDir::new().unwrap();
        assert!(tauri_cargo_mutants_config(tmp.path()).is_empty());
    }

    /// «src-tauri є, mutants.toml відсутній — detector звітує, нічого не пише» (`:104-110`).
    #[test]
    fn missing_mutants_toml_reports_without_writing() {
        let tmp = TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let violations = tauri_cargo_mutants_config(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == MUTANTS_CONFIG_MISSING));
        assert!(!tmp
            .path()
            .join("app/src-tauri/.cargo/mutants.toml")
            .exists());
    }

    /// «усі канонічні ключі вже є з manual values — detector чистий» (`:139-154`).
    #[test]
    fn all_canonical_keys_present_with_manual_values_is_clean() {
        let tmp = TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        write(
            &tmp,
            "app/src-tauri/.cargo/mutants.toml",
            "# manual cargo-mutants tuning\nadditional_cargo_test_args = [\"--lib\"]\nexclude_globs = [\"src/custom.rs\"]\ntimeout_multiplier = 5.0\n"
        );
        assert!(tauri_cargo_mutants_config(tmp.path()).is_empty());
    }

    /// «частково сконфігурований файл — detector звітує keys-missing» (`:156-179`).
    #[test]
    fn partially_configured_file_reports_keys_missing() {
        let tmp = TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let manual = "additional_cargo_test_args = [\"--lib\"]\ntimeout_multiplier = 5.0\n";
        write(&tmp, "app/src-tauri/.cargo/mutants.toml", manual);
        let violations = tauri_cargo_mutants_config(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MUTANTS_KEYS_MISSING)
            .unwrap();
        assert_eq!(
            v.data,
            Some(serde_json::json!({ "missing": ["exclude_globs"] }))
        );
        // read-only: файл не змінився.
        assert_eq!(
            fs::read_to_string(tmp.path().join("app/src-tauri/.cargo/mutants.toml")).unwrap(),
            manual
        );
    }

    /// «кілька src-tauri у різних workspace-пакетах оброблюються незалежно» (`:181-189`).
    #[test]
    fn multiple_src_tauri_in_different_workspaces_are_independent() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app","desktop"]}"#);
        write(
            &tmp,
            "app/package.json",
            r#"{"name":"app","version":"0.0.0"}"#,
        );
        write(
            &tmp,
            "desktop/package.json",
            r#"{"name":"desktop","version":"0.0.0"}"#,
        );
        write(
            &tmp,
            "app/src-tauri/Cargo.toml",
            "[package]\nname=\"a\"\nversion=\"0.1.0\"\n",
        );
        write(
            &tmp,
            "desktop/src-tauri/Cargo.toml",
            "[package]\nname=\"d\"\nversion=\"0.1.0\"\n",
        );
        let violations = tauri_cargo_mutants_config(tmp.path());
        assert_eq!(
            violations
                .iter()
                .filter(|v| v.reason == MUTANTS_CONFIG_MISSING)
                .count(),
            2
        );
    }

    /// «test-rule нейтральний baseline (лише коментар) — обидва канонічні
    /// ключі бракує» (дзеркало `:191-207`, лише детекторна половина —
    /// T0-augmentation лишається в JS).
    #[test]
    fn neutral_test_rule_baseline_reports_both_missing_keys() {
        let tmp = TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        write(
            &tmp,
            "app/src-tauri/.cargo/mutants.toml",
            "# .cargo/mutants.toml — universal cargo-mutants baseline (test.mdc).\n",
        );
        let violations = tauri_cargo_mutants_config(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MUTANTS_KEYS_MISSING)
            .unwrap();
        assert_eq!(
            v.data,
            Some(serde_json::json!({ "missing": ["additional_cargo_test_args", "exclude_globs"] }))
        );
    }
}
