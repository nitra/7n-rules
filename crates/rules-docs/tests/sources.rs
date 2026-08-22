//! Дзеркальний набір завантажувача джерел — сценарій-у-сценарій із
//! `tests/source-loader.test.mjs`.
//!
//! Три сценарії тут про МЕЖУ домену: вкладений пакет, згенероване дерево і
//! symlink назовні. Кожен із них — спосіб тихо втягнути в документацію код,
//! якого домен не має описувати.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rules_docs::sources::{discover_domain_code_extensions, load_domain_sources, DomainScope};

fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-sources-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    std::fs::canonicalize(&root).expect("корінь канонізується")
}

fn write(root: &Path, relative: &str, content: &str) {
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().expect("є батьківська тека")).expect("тека");
    std::fs::write(target, content).expect("запис фікстури");
}

/// Той самий фікстурний домен, що в JS: корінь `.`, виключений
/// `packages/nested`.
fn scope<'a>(root: &'a Path, excluded: &'a [String]) -> DomainScope<'a> {
    DomainScope {
        root,
        source_root: ".",
        excluded_source_roots: excluded,
    }
}

fn nested() -> Vec<String> {
    vec!["packages/nested".to_string()]
}

fn extensions(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn sources_load_in_stable_order_and_nested_or_generated_trees_are_excluded() {
    let root = temp_root("load");
    write(&root, "src/z.mjs", "z");
    write(&root, "src/a.ts", "a");
    write(&root, "packages/nested/hidden.mjs", "nested");
    write(&root, "dist/generated.mjs", "generated");
    let excluded = nested();

    let sources = load_domain_sources(&scope(&root, &excluded), &extensions(&[".mjs", ".ts"]))
        .expect("джерела читаються");
    assert_eq!(
        sources
            .iter()
            .map(|source| (source.path.as_str(), source.content.as_str()))
            .collect::<Vec<_>>(),
        vec![("src/a.ts", "a"), ("src/z.mjs", "z")],
        "вкладений пакет і згенероване дерево не належать цьому домену"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Symlink назовні — не «ще одна тека»: пройшовши за ним, домен описав би
/// чужий код як свій.
#[test]
fn a_symlink_pointing_outside_the_domain_is_not_followed() {
    let parent = temp_root("symlink");
    let root = parent.join("domain");
    let outside = parent.join("outside");
    std::fs::create_dir_all(&root).expect("корінь домену");
    std::fs::create_dir_all(&outside).expect("зовнішня тека");
    std::fs::write(outside.join("secret.mjs"), "secret").expect("зовнішній файл");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");

    let excluded = nested();
    let sources =
        load_domain_sources(&scope(&root, &excluded), &extensions(&[".mjs"])).expect("джерела");
    assert!(sources.is_empty(), "прочитано зайве: {sources:?}");
    let _ = std::fs::remove_dir_all(&parent);
}

#[test]
fn invalid_roots_and_extension_contracts_are_rejected() {
    let excluded = nested();
    let relative = Path::new("relative");
    let codes = |result: Result<
        Vec<rules_docs::sources::SourceFile>,
        Vec<rules_docs::sources::Diagnostic>,
    >| {
        result
            .expect_err("очікувався блокер")
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        codes(load_domain_sources(
            &scope(relative, &excluded),
            &extensions(&[".mjs"])
        )),
        vec!["invalid-domain-root".to_string()]
    );

    let root = temp_root("contracts");
    assert_eq!(
        codes(load_domain_sources(
            &scope(&root, &excluded),
            &extensions(&["mjs"])
        )),
        vec!["invalid-source-extensions".to_string()],
        "розширення без крапки — зламаний контракт, а не привід здогадатись"
    );
    assert_eq!(
        codes(load_domain_sources(&scope(&root, &excluded), &[])),
        vec!["invalid-source-extensions".to_string()]
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn the_inventory_returns_sorted_extensions_across_supported_ecosystems() {
    let root = temp_root("inventory");
    for name in [
        "server.js",
        "legacy.cjs",
        "module.mjs",
        "component.jsx",
        "component.tsx",
        "types.ts",
        "view.vue",
        "worker.rs",
        "worker.py",
        "endpoint.php",
    ] {
        write(&root, &format!("src/{name}"), "");
    }
    let excluded = nested();

    let found = discover_domain_code_extensions(&scope(&root, &excluded)).expect("інвентар");
    assert_eq!(
        found,
        extensions(&[".cjs", ".js", ".jsx", ".mjs", ".php", ".py", ".rs", ".ts", ".tsx", ".vue"])
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Порожній інвентар — це валідна відповідь: домен без коду проходить
/// contract-only шляхом, а не падає.
#[test]
fn nested_domains_are_excluded_and_an_empty_inventory_is_valid() {
    let root = temp_root("empty");
    write(&root, "packages/nested/hidden.py", "");
    let excluded = nested();

    let found = discover_domain_code_extensions(&scope(&root, &excluded)).expect("інвентар");
    assert!(found.is_empty(), "знайдено зайве: {found:?}");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_symlinked_code_tree_outside_the_domain_is_not_inventoried() {
    let parent = temp_root("symlink-inventory");
    let root = parent.join("domain");
    let outside = parent.join("outside");
    std::fs::create_dir_all(&root).expect("корінь домену");
    std::fs::create_dir_all(&outside).expect("зовнішня тека");
    std::fs::write(outside.join("secret.ts"), "").expect("зовнішній файл");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");

    let excluded = nested();
    let found = discover_domain_code_extensions(&scope(&root, &excluded)).expect("інвентар");
    assert!(found.is_empty(), "знайдено зайве: {found:?}");
    let _ = std::fs::remove_dir_all(&parent);
}

/// Понад JS-набір: `.gitignore` поважається так само, як у `globby`
/// (`gitignore: true`) — і навіть коли тека не є git-репозиторієм.
#[test]
fn gitignored_sources_are_skipped_even_outside_a_git_repository() {
    let root = temp_root("gitignore");
    write(&root, ".gitignore", "ignored/\n*.generated.mjs\n");
    write(&root, "src/kept.mjs", "kept");
    write(&root, "ignored/skipped.mjs", "skipped");
    write(&root, "src/thing.generated.mjs", "skipped");
    let excluded = nested();

    let sources =
        load_domain_sources(&scope(&root, &excluded), &extensions(&[".mjs"])).expect("джерела");
    assert_eq!(
        sources
            .iter()
            .map(|source| source.path.as_str())
            .collect::<Vec<_>>(),
        vec!["src/kept.mjs"]
    );
    let _ = std::fs::remove_dir_all(&root);
}
