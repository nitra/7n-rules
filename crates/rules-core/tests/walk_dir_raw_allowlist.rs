//! Анти-дрейф-тест для задачі «уніфікація поверхні обходу дерева»
//! (`docs/plans/2026-08-05-open-questions-register.md`, реєстр §2.27).
//!
//! # Що перевіряє
//!
//! [`rules_core::scan::walk_dir_raw`] — примітив: він НЕ читає consumer-репо
//! `.n-rules.json`/`.n-cursor.json` сам. Прямий виклик поза одним із трьох
//! обгорток [`rules_core::concerns::cursor_ignore`] (`walk_repo`/
//! `walk_under_repo`/`walk_with_ignore_paths`) — це або свідоме «1:1-порт»
//! рішення (задокументоване в коді самого викликача), або точковий регрес
//! того самого класу, що вже двічі стався в цьому репо (§2.25
//! `build_full_scope_files`, §2.26 `resolve_per_file_scope`) — обидва рази
//! `walk_dir(cwd, &[])` виглядав як норма, бо примітив і «свідомо без
//! ignore» мали однакову назву.
//!
//! Цей тест закриває саме цей клас: скановує production-код усіх крейтів
//! workspace-у (`crates/*/src/**/*.rs`, `#[cfg(test)]`-модулі виключені — за
//! конвенцією репо вони завжди в кінці файлу, доккомент нижче) і рахує
//! реальні виклики `walk_dir_raw(` (не doc-коментарі, не саме визначення
//! функції). Кожен файл із production-викликом має бути в [`ALLOWLIST`] з
//! ТОЧНОЮ кількістю — розбіжність у БУДЬ-ЯКИЙ бік (новий виклик деінде, чи
//! видалений виклик без оновлення списку) валить тест з поясненням, що
//! робити: або перевести виклик на обгортку `cursor_ignore`, або додати
//! новий, аргументований запис в [`ALLOWLIST`] (і в реєстр §2.27, розділ
//! «Відкрите питання», якщо це новий «1:1-порт»).
//!
//! # Чому не просто grep у CI
//!
//! Точний список (а не «заборонити взагалі») — бо `walk_dir_raw` ЗАКОННИЙ
//! прямий вибір у трьох задокументованих випадках (доккомент
//! `rules_core::scan`, секція «`_raw` — навмисно у назві»): напівфабрикат
//! (`rename_yaml`), napi-binding, що віддає нормалізацію JS-фасаду, і
//! «1:1-порти» (`sample_secret`, `hasura_migrations`,
//! `k8s_manifests_kubescape`). Прецедент такого «явного реєстру винятків
//! замість заборони» в репо вже є (`main.json`-рівня allow-списки в
//! lang-плагінах) — той самий принцип: виняток видимий і піддається ревʼю, а
//! не захований чи заборонений повністю.
//!
//! # Конвенція «`#[cfg(test)]` в кінці файлу»
//!
//! Увесь код цього repo (перевірено на кожному файлі, зачепленому цією
//! задачею) кладе `#[cfg(test)] mod tests { … }` ОСТАННІМ елементом файлу.
//! Тест довіряє цій конвенції: рахує лише вміст ДО першого рядка `#[cfg(test)]`
//! (trimmed). Якщо конвенція колись порушиться для файлу з production-викликом
//! `walk_dir_raw`, тест або недорахує (тестовий виклик формально «до»
//! маркера — практично неможливо, бо `mod tests` завжди після), або
//! перерахує (виклик у тестовому блоці ПЕРЕД production-кодом — не
//! трапляється в цьому стилі коду). Обидва боки — самі по собі сигнал
//! переглянути тест, не мовчазний false-negative.

use std::path::{Path, PathBuf};

/// `(суфікс шляху від кореня репо, скільки production-викликів
/// `walk_dir_raw(` дозволено саме тут)`.
///
/// Кожен запис — свідоме рішення, обґрунтоване в доккоменті самого
/// викликача (не тут, щоб обґрунтування жило поруч із кодом, який воно
/// пояснює):
/// - `rules-core/src/scan.rs` — саме ВИЗНАЧЕННЯ [`rules_core::scan::walk_dir_raw`]
///   викликає себе? Ні — рахунок 0, `fn walk_dir_raw(` явно виключається
///   нижче;
/// - `rules-core/src/concerns/cursor_ignore.rs` — 1 виклик: реалізація
///   [`rules_core::concerns::cursor_ignore::walk_with_ignore_paths`] САМА
///   (єдине місце, де примітив ховається за обгортку) — доккомент функції;
/// - `rules-core/src/rename_yaml.rs` — 1: напівфабрикат, `extra_ignore_globs`
///   від виклику вже нормалізовані (`rules-cli`'s власний, архітектурно
///   окремий читач конфігу) — доккомент модуля;
/// - `rules-core/src/concerns/k8s_manifests_kubescape.rs` — 2:
///   `find_kustomization_dirs`/`read_all_yaml_text_under_dir` обходять
///   ПІДДЕРЕВО, що вже пройшло фільтрацію на рівні вибору k8s-коренів
///   (`find_k8s_roots`) — доккомент обох функцій;
/// - `rules-napi/src/lib.rs` — 1: napi-binding `walk_dir`, що свідомо віддає
///   нормалізацію `ignorePaths` на бік JS-фасаду (`walkDir.mjs` сам читає
///   конфіг ДО виклику) — доккомент binding-а;
/// - `rules-cli/src/ci_cmd.rs` — 1: `collect_path_scoped_files`, корені
///   різні (`--path`), `rules-cli` тримає власний читач `.n-rules.json`
///   (`cursor_ignore`, Р5-виняток) — доккомент функції.
///
/// `sample_secret.rs` і `hasura_migrations.rs` — колишні «1:1-порти» реєстру
/// §2.27 — тут БІЛЬШЕ НЕМАЄ: §2.30 перевело обидва на обгортки
/// (`walk_repo`/`walk_under_repo` відповідно), тож прямих production-викликів
/// `walk_dir_raw(` у цих файлах не лишилось (доккомент обох модулів).
const ALLOWLIST: &[(&str, usize)] = &[
    ("rules-core/src/concerns/cursor_ignore.rs", 1),
    ("rules-core/src/rename_yaml.rs", 1),
    ("rules-core/src/concerns/k8s_manifests_kubescape.rs", 2),
    ("rules-napi/src/lib.rs", 1),
    ("rules-cli/src/ci_cmd.rs", 1),
];

/// Корінь workspace (`CARGO_MANIFEST_DIR` цього крейта — `crates/rules-core`
/// — тож `../../` дає корінь репо, де лежить `crates/`).
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root: crates/rules-core/../.. існує")
        .to_path_buf()
}

/// Рахує production-виклики `walk_dir_raw(` в одному `.rs`-файлі: пропускає
/// коментарі (`trim()` починається з `//`) і саме визначення функції
/// (`fn walk_dir_raw(`), обрізає вміст на першому `#[cfg(test)]` (конвенція
/// репо, доккомент модуля).
fn count_production_calls(source: &str) -> usize {
    let production = match source.find("#[cfg(test)]") {
        Some(idx) => &source[..idx],
        None => source,
    };
    production
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !trimmed.starts_with("//") && !trimmed.contains("fn walk_dir_raw(")
        })
        .map(|line| line.matches("walk_dir_raw(").count())
        .sum()
}

/// Рекурсивно збирає всі `*.rs` під `dir` (без `target/`, без `tests/` —
/// production `src/`-код лише).
fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn walk_dir_raw_production_calls_match_allowlist() {
    let root = workspace_root();
    let crates_dir = root.join("crates");
    assert!(
        crates_dir.is_dir(),
        "очікував {} — перевір workspace_root()",
        crates_dir.display()
    );

    // Збираємо лише `src/` кожного крейта — `tests/`/`target/`/wasm-гості
    // поза обсягом (production native-код лише).
    let mut rs_files = Vec::new();
    for entry in std::fs::read_dir(&crates_dir).expect("read crates/") {
        let entry = entry.expect("dir entry");
        let src = entry.path().join("src");
        if src.is_dir() {
            collect_rs_files(&src, &mut rs_files);
        }
    }
    assert!(
        rs_files.len() > 10,
        "забагато мало .rs-файлів знайдено ({}) — перевір обхід",
        rs_files.len()
    );

    let mut actual: Vec<(String, usize)> = Vec::new();
    for path in &rs_files {
        let source = std::fs::read_to_string(path).unwrap_or_default();
        let count = count_production_calls(&source);
        if count == 0 {
            continue;
        }
        let suffix = path
            .strip_prefix(&crates_dir)
            .expect("під crates/")
            .to_string_lossy()
            .replace('\\', "/");
        actual.push((format!("crates/{suffix}"), count));
    }
    actual.sort();

    let mut expected: Vec<(String, usize)> = ALLOWLIST
        .iter()
        .map(|(suffix, n)| (format!("crates/{suffix}"), *n))
        .collect();
    expected.sort();

    assert_eq!(
        actual, expected,
        "\n\nПоверхня прямих викликів `walk_dir_raw(` розійшлася з ALLOWLIST \
         у `crates/rules-core/tests/walk_dir_raw_allowlist.rs`.\n\
         Якщо зʼявився НОВИЙ прямий виклик — спершу перевір, чи не мало це \
         бути `cursor_ignore::walk_repo`/`walk_under_repo`/`walk_with_ignore_paths` \
         (доккомент `rules_core::scan`, секція «`_raw` — навмисно у назві»). \
         Якщо виклик справді законний «1:1-порт» — додай рядок в ALLOWLIST і \
         обґрунтування в доккомент викликача (і, якщо це новий «1:1-порт», у \
         реєстр §2.27). Якщо виклик зник — просто онови число/видали рядок.\n"
    );
}

/// Сама функція визначена лише раз (`fn walk_dir_raw(` у `scan.rs`) — сторож
/// на випадок, якщо хтось скопіює примітив в інший модуль замість реюзу.
#[test]
fn walk_dir_raw_defined_exactly_once() {
    let root = workspace_root();
    let scan_rs = root.join("crates/rules-core/src/scan.rs");
    let source = std::fs::read_to_string(&scan_rs).expect("read scan.rs");
    let count = source.matches("fn walk_dir_raw(").count();
    assert_eq!(
        count,
        1,
        "`fn walk_dir_raw(` має визначатись рівно раз, у {}",
        scan_rs.display()
    );
}
