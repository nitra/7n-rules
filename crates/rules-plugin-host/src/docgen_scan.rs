//! Хост-бік `docgen-scan` — перелічення кандидатів (обхід дерева +
//! git-ignore фільтр) — рішення 2 фази 3 (крок 7 порядку реалізації спеки
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §12), задокументоване
//! планом `docs/plans/2026-08-31-full-rust-migration-plan.md` §7 «Нове»
//! п.1: `docgen-scan` (`npm/rules/doc-files/docgen-scan/main.mjs`) робить
//! РЕКУРСИВНИЙ `readdirSync`-обхід усього дерева репозиторію ПЛЮС
//! `git check-ignore --stdin` — жодне з двох гість не може зробити в межах
//! батчу/preopen (обхід — бо `docgen` сканує ВСЕ дерево, не передані host-ом
//! файли; git-ignore — бо це відповідь на VCS-питання, не «прогалина
//! exec»: додавати загальний `exec-process` capability заради вузького
//! питання «що ігнорує git» — саме та помилка, від якої план явно
//! застерігає).
//!
//! # Двигун — `rules_core::scan::walk_dir_raw`, НЕ `gix`
//!
//! План (§7 «Нове» п.1) розглядав `gix` (уже у воркспейсі, `rules-core`,
//! фіча `revision`+`sha1` для `merge_base`) як шлях до git-ignore-семантики
//! ціною розширення фіч (`excludes`, яка тягне `index`+`gix-worktree`).
//! Вимір показав дешевший шлях: [`rules_core::scan::walk_dir_raw`] (двигун
//! `ignore::WalkBuilder`, УЖЕ реалізований для `caps_file_reader`'s
//! `list-files`) вмикає `git_ignore(true)` — реальний `.gitignore`-парсер
//! (доккомент `rules_core::scan`, «Звірка семантики globby») — БЕЗ жодної
//! нової Cargo-залежності чи фічі. Різниця з чинним JS
//! (`execFileSync('git', ['check-ignore', ...])`) — `git_exclude(false)`/
//! `git_global(false)` (`walk_dir_raw` свідомо НЕ читає `.git/info/exclude`
//! чи global excludes, той самий вибір, що `globby`-паритет вимагав від
//! JS-сусіда `walk_dir_raw` захищає доккоментом модуля) — прийнятне,
//! неозвучене раніше розходження: ці два джерела ignore-правил рідкісні на
//! практиці й JS-оригінал теж не документував їх як критичні.
//!
//! # Що НЕ робить цей модуль (свідомо, не мовчки)
//!
//! - НЕ фільтрує за розширенням (`isSourceFile`/`pluginDocFilesExtensions`)
//!   і НЕ виключає тестові/story-файли (`isDocCandidate` у
//!   `crates/plugin-docgen/src/scan.rs`) — це домен-специфічна фільтрація,
//!   яку майбутній `docgen-stage`-консюмер (§5.4 розвідки, ще не
//!   реалізований) передасть у guest-batch НЕОБРОБЛЕНИМ списком, і гість
//!   застосує `plugin_docgen::scan::is_doc_candidate` сам (той самий
//!   поділ обов'язків, що вже є для `describe_file`/`scan_for_doc_files` —
//!   доккомент `crates/plugin-docgen/src/scan.rs`).
//! - НЕ виводить "сирітські" доки (`scanOrphanedDocs`) — ОКРЕМИЙ обхід, що
//!   спеціально ВХОДИТЬ у `docs/`-каталоги (цей модуль, навпаки, виключає
//!   їх через [`DOCGEN_IGNORE_GLOBS`] — той самий glob, що
//!   `plugin_docgen::ignore::DOCGEN_IGNORE_GLOBS` несе `"**/docs/**"`).
//!   Лишається явно НЕпортованим цим кроком — не змінює висновок «контракту
//!   не треба», лише більший обсяг роботи (окремий walker без цього
//!   ignore-запису).
//! - НЕ підключений до жодного диспетчера (`docgen-stage` — майбутня
//!   робота, §5.4 розвідки; той самий стан «написано, без консюмера», що
//!   `crates/plugin-docgen/src/scan.rs` цього кроку вже прийняв).

use std::path::Path;

use rules_core::scan::walk_dir_raw;

/// Byte-exact дзеркало `plugin_docgen::ignore::DOCGEN_IGNORE_GLOBS`
/// (`crates/plugin-docgen/src/ignore.rs`). Дублювання — свідоме рішення,
/// не недогляд: `plugin-docgen` — `crate-type = ["cdylib"]` (wasm-компонент,
/// доккомент `plugin-docgen/Cargo.toml`), тож НЕ може бути звичайною Rust
/// rlib-залежністю ЖОДНОГО host-крейта (сам факт компіляції wit-bindgen
/// host-імпортів `llm-call`/`log`/`report-progress` під non-wasm ціль —
/// непідтримана площина, не варта ризику заради 16 рядків статичного
/// списку). Той самий підхід, що [`rules_core::concerns::cursor_ignore`]
/// (host-ignore, `.n-rules.json`) свідомо НЕ ділить логіку з
/// domain-специфічними ignore-списками інших концернів.
const DOCGEN_IGNORE_GLOBS: &[&str] = &[
    "**/node_modules/**",
    "**/dist/**",
    "**/target/**",
    ".git/**",
    "**/__pycache__/**",
    "**/coverage/**",
    ".cursor/**",
    ".claude/**",
    ".pi/**",
    ".pi-template/**",
    ".worktrees/**",
    "**/benchmarks/**",
    "**/demo/**",
    "**/docs/**",
    "npm/reports/**",
    "npm/bin/**",
];

/// Порт `isSystemWideDocsRoot` (`docgen-scan/main.mjs:21-23`): чи корінь
/// зарезервований під репозиторні `docs/adr`/`docs/explanation` (тоді
/// file-level docs у корені НЕ пишемо — доккомент
/// `plugin_docgen::scan::is_doc_candidate`, параметр `is_system_wide_docs_root`).
pub fn is_system_wide_docs_root(root: &Path) -> bool {
    root.join("docs").join("adr").exists() || root.join("docs").join("explanation").exists()
}

/// Хост-бік перелічення кандидатів `docgen-scan` — рішення 2 (доккомент
/// модуля): обхід дерева ВІД `root` + ignore-фільтр (`DOCGEN_IGNORE_GLOBS` +
/// реальний `.gitignore` через `walk_dir_raw`). Повертає posix-relative
/// шляхи ВСІХ файлів, що пройшли фільтр — БЕЗ фільтрації за розширенням
/// (доккомент модуля, «Що НЕ робить»): майбутній консюмер комбінує це з
/// `plugin_docgen::scan::is_doc_candidate`.
///
/// Порожній `Vec`, якщо `root` не існує чи не каталог (той самий
/// graceful-фолбек, що `walk_dir_raw`/чинний JS `scanForDocFiles`,
/// доккомент `rules_core::scan::walk_dir_raw`).
pub fn list_docgen_candidate_paths(root: &Path) -> Vec<String> {
    let extra_globs: Vec<String> = DOCGEN_IGNORE_GLOBS.iter().map(|s| s.to_string()).collect();
    walk_dir_raw(root, &extra_globs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir -p");
        }
        fs::write(path, content).expect("write fixture file");
    }

    #[test]
    fn lists_plain_files_recursively() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write(tmp.path(), "src/lib.rs", "fn a(){}");
        write(tmp.path(), "src/nested/mod.rs", "fn b(){}");

        let mut paths = list_docgen_candidate_paths(tmp.path());
        paths.sort();
        assert_eq!(paths, vec!["src/lib.rs", "src/nested/mod.rs"]);
    }

    #[test]
    fn excludes_docgen_ignore_glob_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write(tmp.path(), "src/lib.rs", "fn a(){}");
        write(tmp.path(), "node_modules/pkg/index.js", "module.exports = {}");
        write(tmp.path(), "target/debug/out.txt", "x");
        write(tmp.path(), "src/docs/lib.md", "# doc");

        let paths = list_docgen_candidate_paths(tmp.path());
        assert!(paths.contains(&"src/lib.rs".to_string()));
        assert!(!paths.iter().any(|p| p.starts_with("node_modules/")));
        assert!(!paths.iter().any(|p| p.starts_with("target/")));
        assert!(!paths.iter().any(|p| p.contains("/docs/")));
    }

    #[test]
    fn respects_real_gitignore_without_a_git_repo() {
        // `walk_dir_raw`'s `require_git(false)` (доккомент модуля) — той
        // самий паритет, що globby/чинний JS: `.gitignore` діє навіть поза
        // git-репозиторієм.
        let tmp = tempfile::tempdir().expect("tempdir");
        write(tmp.path(), ".gitignore", "ignored.rs\n");
        write(tmp.path(), "ignored.rs", "fn ignored(){}");
        write(tmp.path(), "kept.rs", "fn kept(){}");

        let paths = list_docgen_candidate_paths(tmp.path());
        assert!(paths.contains(&"kept.rs".to_string()));
        assert!(!paths.contains(&"ignored.rs".to_string()));
    }

    #[test]
    fn empty_vec_for_nonexistent_root() {
        let missing = Path::new("/tmp/does-not-exist-docgen-scan-fixture-xyz");
        assert_eq!(list_docgen_candidate_paths(missing), Vec::<String>::new());
    }

    #[test]
    fn is_system_wide_docs_root_detects_adr_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert!(!is_system_wide_docs_root(tmp.path()));
        write(tmp.path(), "docs/adr/0001.md", "# ADR");
        assert!(is_system_wide_docs_root(tmp.path()));
    }
}
