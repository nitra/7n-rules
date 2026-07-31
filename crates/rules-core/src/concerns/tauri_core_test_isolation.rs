//! Native-порт `tauri/core_test_isolation` (`npm/rules/tauri/core_test_isolation/main.mjs`,
//! 154 рядки) — read-only detector: у Tauri-проєктах, що говорять з LLM,
//! agent/provider-логіка має жити у workspace-крейті окремо від `src-tauri`
//! — без залежності на `tauri`, щоб `cargo test -p <crate>` ганявся без
//! повної збірки застосунку. Немає T0-фіксу (`fixability: "structural"` у
//! `concern.json`) — переніс коду, виділення крейту потребують людського
//! розсуду, тож тут немає обмежень на форму `violation.data` (JS-версія
//! теж не кладе `data` у жоден зі своїх трьох `fail()`).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cargo_workspace::{
    find_ancestor_workspace_root, normalize_lexical, resolve_workspace_member_dirs,
};
use crate::concerns::find_src_tauri::{find_src_tauri_dirs, relative_posix};
use crate::concerns::glob_compat::scan_glob;
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason: LLM-залежність оголошена в app shell замість
/// core-крейта — порт `LLM_DEP_IN_APP_SHELL` (`main.mjs:20`).
pub const LLM_DEP_IN_APP_SHELL: &str = "llm-dep-in-app-shell";
/// Стабільний reason: core-крейт залежить від Tauri — ламає ізоляцію
/// unit-тестів від runtime — порт `CORE_CRATE_DEPENDS_ON_TAURI` (`main.mjs:22`).
pub const CORE_CRATE_DEPENDS_ON_TAURI: &str = "core-crate-depends-on-tauri";
/// Стабільний reason: у тестах core-крейта немає fake-провайдера LLM для
/// роботи без мережі — порт `MISSING_FAKE_LLM_PROVIDER` (`main.mjs:24`).
pub const MISSING_FAKE_LLM_PROVIDER: &str = "missing-fake-llm-provider";

/// Порт `LLM_DEP_RE` (`main.mjs:28-29`).
static LLM_DEP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(async-openai|openai(-api)?|anthropic|claude|genai|llm(-chain)?|ollama-rs|rig-core|langchain|mistralai)")
        .expect("valid regex")
});
/// Порт `TAURI_DEP_RE` (`main.mjs:30`).
static TAURI_DEP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^tauri(-|$)").expect("valid regex"));
/// Порт `FAKE_PROVIDER_RE` (`main.mjs:31`).
static FAKE_PROVIDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(Fake|Mock|Stub)\w*(Llm|Provider|Client)\b").expect("valid regex")
});

/// Витягує назви залежностей з розпарсеного `Cargo.toml` (лише
/// `[dependencies]`) — точний порт `dependencyNames` (`main.mjs:37-40`).
fn dependency_names(parsed: &toml::Table) -> Vec<String> {
    parsed
        .get("dependencies")
        .and_then(toml::Value::as_table)
        .map(|t| t.keys().cloned().collect())
        .unwrap_or_default()
}

/// Витягує масив рядків `table.workspace.members` — той самий контракт, що
/// й у `cargo_workspace::string_array_field` (тут окрема копія, бо той
/// helper приватний до свого модуля).
fn workspace_members(parsed: &toml::Table) -> Vec<String> {
    parsed
        .get("workspace")
        .and_then(toml::Value::as_table)
        .and_then(|t| t.get("members"))
        .and_then(toml::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Рекурсивно шукає в дереві крейту рядок, що відповідає
/// `FAKE_PROVIDER_RE` (fake/mock/stub-реалізацію LLM-провайдера, зазвичай у
/// `tests/` чи `src/`) — точний порт `hasFakeLlmProviderMarker` (`main.mjs:63-70`).
fn has_fake_llm_provider_marker(crate_dir: &Path) -> bool {
    for rel_path in scan_glob("**/*.rs", crate_dir) {
        if rel_path.contains("target/") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(crate_dir.join(&rel_path)) else {
            continue;
        };
        if FAKE_PROVIDER_RE.is_match(&content) {
            return true;
        }
    }
    false
}

/// Перевіряє один `src-tauri/` каталог: чи LLM-залежність лежить у
/// app-shell крейті, чи окремий crate з LLM-залежністю сам не тягне
/// `tauri`, чи є fake-провайдер у тестах — точний порт `checkOneSrcTauri`
/// (`main.mjs:79-133`).
fn check_one_src_tauri(src_tauri_dir: &Path, cwd: &Path, violations: &mut Vec<Violation>) {
    let cargo_path = src_tauri_dir.join("Cargo.toml");
    let Ok(content) = std::fs::read_to_string(&cargo_path) else {
        return;
    };
    let Ok(parsed) = toml::from_str::<toml::Table>(&content) else {
        return;
    };
    let rel_cargo = relative_posix(cwd, &cargo_path);

    let shell_deps = dependency_names(&parsed);
    if shell_deps.iter().any(|d| LLM_DEP_RE.is_match(d)) {
        violations.push(Violation {
            reason: LLM_DEP_IN_APP_SHELL.to_string(),
            message: format!(
                "{rel_cargo}: LLM-провайдер залежність лежить у app-shell крейті src-tauri — кожна ітерація \
prompt/tool перезбирає весь Tauri-застосунок. Винеси agent-логіку у окремий workspace crate \
(без залежності на tauri) і тестуй `cargo test -p <crate>` (core_test_isolation.mdc)"
            ),
            file: Some(rel_cargo),
            severity: Severity::Error,
            data: None,
        });
        return;
    }

    // `[workspace]` живе або у самому src-tauri/Cargo.toml (старий/standalone
    // патерн), або — канонічно (rust/workspace_root.mdc) — у предку-workspace
    // root над src-tauri/.
    let mut workspace_root_dir: PathBuf = src_tauri_dir.to_path_buf();
    let mut members = workspace_members(&parsed);
    if members.is_empty() {
        let Some(ancestor) = find_ancestor_workspace_root(src_tauri_dir, cwd) else {
            return;
        };
        let ancestor_members = workspace_members(&ancestor.parsed);
        if ancestor_members.is_empty() {
            return;
        }
        workspace_root_dir = ancestor.root_dir;
        members = ancestor_members;
    }

    let member_dirs = resolve_workspace_member_dirs(&workspace_root_dir, &members);
    let src_tauri_norm = normalize_lexical(src_tauri_dir);
    let other_member_dirs: Vec<PathBuf> = member_dirs
        .into_iter()
        .filter(|d| normalize_lexical(d) != src_tauri_norm)
        .collect();

    for member_dir in other_member_dirs {
        let member_cargo_path = member_dir.join("Cargo.toml");
        let Ok(member_content) = std::fs::read_to_string(&member_cargo_path) else {
            continue;
        };
        let Ok(member_parsed) = toml::from_str::<toml::Table>(&member_content) else {
            continue;
        };
        let member_deps = dependency_names(&member_parsed);
        if member_deps.iter().all(|d| !LLM_DEP_RE.is_match(d)) {
            continue;
        }

        let rel_member_cargo = relative_posix(cwd, &member_cargo_path);
        if member_deps.iter().any(|d| TAURI_DEP_RE.is_match(d)) {
            violations.push(Violation {
                reason: CORE_CRATE_DEPENDS_ON_TAURI.to_string(),
                message: format!(
                    "{rel_member_cargo}: agent/LLM crate залежить від tauri — `cargo test -p` цього крейту все \
одно потягне збірку Tauri runtime. Прибери залежність на tauri з цього крейту (core_test_isolation.mdc)"
                ),
                file: Some(rel_member_cargo),
                severity: Severity::Error,
                data: None,
            });
            continue;
        }

        if !has_fake_llm_provider_marker(&member_dir) {
            let crate_name = member_dir
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            violations.push(Violation {
                reason: MISSING_FAKE_LLM_PROVIDER.to_string(),
                message: format!(
                    "{rel_member_cargo}: немає fake/mock LLM-провайдера для інтеграційних тестів — прогін \
`cargo test -p {crate_name}` буде або мовчки пропускати LLM-логіку, або бити по реальному провайдеру. \
Додай Fake/Mock-реалізацію провайдера в tests/ (core_test_isolation.mdc)"
                ),
                file: Some(rel_member_cargo),
                severity: Severity::Error,
                data: None,
            });
        }
    }
}

/// Detector `tauri/core_test_isolation` — точний порт `lint(ctx)` (`main.mjs:138-146`).
pub fn tauri_core_test_isolation(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();
    for dir in find_src_tauri_dirs(cwd) {
        check_one_src_tauri(&dir, cwd, &mut violations);
    }
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    /// «без src-tauri у проєкті → без порушень» (`:14-19`).
    #[test]
    fn no_src_tauri_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        assert!(tauri_core_test_isolation(tmp.path()).is_empty());
    }

    /// «src-tauri без workspace-членів і без LLM-залежності → без порушень» (`:21-28`).
    #[test]
    fn src_tauri_without_workspace_members_or_llm_dep_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\n\n[dependencies]\nserde = \"1\"\n",
        );
        assert!(tauri_core_test_isolation(tmp.path()).is_empty());
    }

    /// «LLM-залежність напряму в app-shell src-tauri → фейл» (`:30-40`).
    #[test]
    fn llm_dep_directly_in_app_shell_fails() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\n\n[dependencies]\nasync-openai = \"0.1\"\ntauri = \"2\"\n",
        );
        let violations = tauri_core_test_isolation(tmp.path());
        assert!(violations.iter().any(|v| v.reason == LLM_DEP_IN_APP_SHELL));
    }

    /// «окремий crate з LLM-залежністю сам залежить від tauri → фейл» (`:42-58`).
    #[test]
    fn separate_crate_with_llm_dep_depending_on_tauri_fails() {
        let tmp = TempDir::new().unwrap();
        // Cargo-валідний layout: [workspace] живе у product-root Cargo.toml НАД
        // src-tauri/ і agent-core/ (не всередині src-tauri/, бо `members` за межами
        // дерева workspace root — помилка Cargo).
        write(
            &tmp,
            "Cargo.toml",
            "[workspace]\nresolver = \"2\"\nmembers = [\"src-tauri\", \"agent-core\"]\n",
        );
        write(
            &tmp,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\n\n[dependencies]\ntauri = \"2\"\n",
        );
        write(
            &tmp,
            "agent-core/Cargo.toml",
            "[package]\nname = \"agent-core\"\n\n[dependencies]\nasync-openai = \"0.1\"\ntauri = \"2\"\n",
        );
        let violations = tauri_core_test_isolation(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == CORE_CRATE_DEPENDS_ON_TAURI));
    }

    /// «окремий crate без tauri, без fake-провайдера у тестах → фейл» (`:60-74`).
    #[test]
    fn separate_crate_without_tauri_or_fake_provider_fails() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "Cargo.toml",
            "[workspace]\nresolver = \"2\"\nmembers = [\"src-tauri\", \"agent-core\"]\n",
        );
        write(
            &tmp,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\n\n[dependencies]\ntauri = \"2\"\n",
        );
        write(
            &tmp,
            "agent-core/Cargo.toml",
            "[package]\nname = \"agent-core\"\n\n[dependencies]\nasync-openai = \"0.1\"\n",
        );
        write(&tmp, "agent-core/src/lib.rs", "pub fn run() {}\n");
        let violations = tauri_core_test_isolation(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == MISSING_FAKE_LLM_PROVIDER));
    }

    /// «окремий crate без tauri, з fake-провайдером у tests/ → без порушень» (`:76-93`).
    #[test]
    fn separate_crate_with_fake_provider_in_tests_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "Cargo.toml",
            "[workspace]\nresolver = \"2\"\nmembers = [\"src-tauri\", \"agent-core\"]\n",
        );
        write(
            &tmp,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\n\n[dependencies]\ntauri = \"2\"\n",
        );
        write(
            &tmp,
            "agent-core/Cargo.toml",
            "[package]\nname = \"agent-core\"\n\n[dependencies]\nasync-openai = \"0.1\"\n",
        );
        write(
            &tmp,
            "agent-core/tests/fake_provider.rs",
            "struct FakeLlmProvider;\n#[test]\nfn it_works() {}\n",
        );
        assert!(tauri_core_test_isolation(tmp.path()).is_empty());
    }
}
