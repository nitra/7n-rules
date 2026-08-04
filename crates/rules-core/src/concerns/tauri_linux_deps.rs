//! Native-порт `tauri/linux_deps` (`npm/rules/tauri/linux_deps/main.mjs`,
//! 101 рядок) — read-only detector: у Tauri-проєкті `.github/workflows/lint-rust.yml`
//! повинен ставити системні залежності Linux (`apt-get install` з
//! webkit2gtk/appindicator/rsvg dev-пакетами) перед Clippy.
//!
//! JS-фікс (`fix-linux_deps.mjs`) не читає `violation.data.missing` напряму
//! для побудови патчу — він повторно сканує вміст файла через
//! `scanLinuxDeps` (незмінений `main.mjs`); але `test()`-предикати обох
//! T0-патернів матчать саме по `v.data?.kind` і `v.file`, тож ці два поля
//! мають збігатися з JS 1:1.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::find_src_tauri::find_src_tauri_dirs;
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason: у CI-workflow немає apt-кроку встановлення Linux-залежностей
/// Tauri — порт `MISSING_LINUX_DEPS_STEP` (`main.mjs:22`).
pub const MISSING_LINUX_DEPS_STEP: &str = "missing-linux-deps-step";
/// Стабільний reason: apt-крок є, але в ньому бракує канонічних пакетів —
/// порт `MISSING_LINUX_DEPS_PACKAGES` (`main.mjs:24`).
pub const MISSING_LINUX_DEPS_PACKAGES: &str = "missing-linux-deps-packages";

/// Цільовий workflow-файл (канон `rust.lint_rust_yml`) — порт `LINT_RUST_YML`
/// (`main.mjs:27`).
const LINT_RUST_YML: &str = ".github/workflows/lint-rust.yml";

/// Канонічні dev-пакети для компіляції Tauri v2 на ubuntu-runner-і — порт
/// `REQUIRED_LINUX_PACKAGES` (`main.mjs:29-33`). `pub(crate)` — перевикористовує
/// native-фікс цього concern-а (`super::fix`, T2 зрізу 5 фази 7).
pub(crate) const REQUIRED_LINUX_PACKAGES: &[&str] = &[
    "libwebkit2gtk-4.1-dev",
    "libayatana-appindicator3-dev",
    "librsvg2-dev",
];

/// Порт `APT_INSTALL_RE` (`main.mjs:35`, `/\bapt-get install\b/u`).
/// `pub(crate)` — перевикористовує native-фікс (`super::fix`).
pub(crate) static APT_INSTALL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bapt-get install\b").expect("valid regex"));

/// Результат сканування `lint-rust.yml` — точний порт `LinuxDepsScan`
/// (`main.mjs:41-46`): індекс першого рядка з `apt-get install` (`None`,
/// якщо немає) і канонічні пакети, відсутні у вмісті файла.
struct LinuxDepsScan {
    apt_line_found: bool,
    missing: Vec<&'static str>,
}

/// Сканує вміст workflow: перший `apt-get install`-рядок і перелік
/// канонічних пакетів, яких немає ніде у файлі (substring — пакет може
/// стояти на continuation-рядку багаторядкового `run: |`) — точний порт
/// `scanLinuxDeps` (`main.mjs:53-58`).
fn scan_linux_deps(content: &str) -> LinuxDepsScan {
    let apt_line_found = content.lines().any(|l| APT_INSTALL_RE.is_match(l));
    let missing = REQUIRED_LINUX_PACKAGES
        .iter()
        .copied()
        .filter(|p| !content.contains(p))
        .collect();
    LinuxDepsScan {
        apt_line_found,
        missing,
    }
}

/// Detector `tauri/linux_deps` — точний порт `lint(ctx)` (`main.mjs:64-96`).
pub fn tauri_linux_deps(cwd: &Path) -> Vec<Violation> {
    if find_src_tauri_dirs(cwd).is_empty() {
        return Vec::new();
    }

    let abs = cwd.join(LINT_RUST_YML);
    if !abs.exists() {
        // Існування самого lint-rust.yml перевіряє rust.lint_rust_yml (policy required).
        return Vec::new();
    }

    let Ok(content) = std::fs::read_to_string(&abs) else {
        return Vec::new();
    };
    let scan = scan_linux_deps(&content);

    if !scan.apt_line_found {
        return vec![Violation {
            reason: MISSING_LINUX_DEPS_STEP.to_string(),
            message: format!(
                "{LINT_RUST_YML}: Tauri-проєкт потребує кроку системних залежностей Linux (apt-get install {}) перед Clippy (tauri.mdc)",
                REQUIRED_LINUX_PACKAGES.join(" ")
            ),
            file: Some(LINT_RUST_YML.to_string()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": MISSING_LINUX_DEPS_STEP })),
        }];
    }

    if !scan.missing.is_empty() {
        return vec![Violation {
            reason: MISSING_LINUX_DEPS_PACKAGES.to_string(),
            message: format!(
                "{LINT_RUST_YML}: apt-крок без канонічних Tauri-пакетів [{}] (tauri.mdc)",
                scan.missing.join(", ")
            ),
            file: Some(LINT_RUST_YML.to_string()),
            severity: Severity::Error,
            data: Some(
                serde_json::json!({ "kind": MISSING_LINUX_DEPS_PACKAGES, "missing": scan.missing }),
            ),
        }];
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    fn make_src_tauri(tmp: &TempDir) {
        write(tmp, "src-tauri/Cargo.toml", "[package]\nname=\"t\"\n");
    }

    const NO_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: dtolnay/rust-toolchain@stable\n        with:\n          components: rustfmt, clippy\n      - uses: Swatinem/rust-cache@v2\n      - run: cargo fmt --all -- --check\n      - run: cargo clippy --all-targets --all-features -- -D warnings\n";

    const FULL_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - name: Системні залежності Tauri (Linux)\n        run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev\n      - uses: dtolnay/rust-toolchain@stable\n      - run: cargo clippy --all-targets --all-features -- -D warnings\n";

    const PARTIAL_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.1-dev\n      - uses: dtolnay/rust-toolchain@stable\n";

    /// «без src-tauri/Cargo.toml правило не активується» (`:99-108`).
    #[test]
    fn no_src_tauri_disables_rule() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".github/workflows/lint-rust.yml", NO_DEPS_YML);
        assert!(tauri_linux_deps(tmp.path()).is_empty());
    }

    /// «Tauri-проєкт без apt-кроку → missing-linux-deps-step» (`:110-120`).
    #[test]
    fn tauri_project_without_apt_step_reports_missing_step() {
        let tmp = TempDir::new().unwrap();
        make_src_tauri(&tmp);
        write(&tmp, ".github/workflows/lint-rust.yml", NO_DEPS_YML);
        let violations = tauri_linux_deps(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == MISSING_LINUX_DEPS_STEP));
    }

    /// «apt-крок без канонічних пакетів → missing-linux-deps-packages з переліком» (`:122-133`).
    #[test]
    fn apt_step_without_canonical_packages_reports_missing_list() {
        let tmp = TempDir::new().unwrap();
        make_src_tauri(&tmp);
        write(&tmp, ".github/workflows/lint-rust.yml", PARTIAL_DEPS_YML);
        let violations = tauri_linux_deps(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_LINUX_DEPS_PACKAGES)
            .unwrap();
        assert_eq!(
            v.data.as_ref().unwrap()["missing"],
            serde_json::json!(["libayatana-appindicator3-dev", "librsvg2-dev"])
        );
    }

    /// «повний канонічний блок → чисто» (`:135-145`).
    #[test]
    fn full_canonical_block_is_clean() {
        let tmp = TempDir::new().unwrap();
        make_src_tauri(&tmp);
        write(&tmp, ".github/workflows/lint-rust.yml", FULL_DEPS_YML);
        assert!(tauri_linux_deps(tmp.path()).is_empty());
    }

    /// «lint-rust.yml відсутній → чисто (існування — rust.lint_rust_yml)» (`:147-156`).
    #[test]
    fn missing_lint_rust_yml_is_clean() {
        let tmp = TempDir::new().unwrap();
        make_src_tauri(&tmp);
        assert!(tauri_linux_deps(tmp.path()).is_empty());
    }
}
