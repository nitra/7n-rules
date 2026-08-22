//! Дзеркальний набір резолвера доменів — сценарій-у-сценарій із
//! `tests/domain-resolver.test.mjs`. Фікстури будуються програмно з того
//! самого вмісту, що лежить у `tests/fixtures/domains/`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rules_docs::domains::{
    canonical_domain_name, resolve_documentation_domains, resolve_domain_for_path,
};

fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-domains-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    // Канонічний шлях: на macOS `/var` — symlink на `/private/var`, і без
    // цього порівняння коренів у резолвері порівнювало б різні рядки.
    std::fs::canonicalize(&root).expect("корінь канонізується")
}

fn write(root: &Path, relative: &str, content: &str) {
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().expect("є батьківська тека")).expect("тека");
    std::fs::write(target, content).expect("запис фікстури");
}

/// Фікстура `monorepo` — пʼять маніфестів чотирьох екосистем.
fn monorepo(root: &Path) {
    write(
        root,
        "package.json",
        "{\n  \"name\": \"@fixture/root\"\n}\n",
    );
    write(
        root,
        "packages/engine/Cargo.toml",
        "[package]\nname = \"fixture-engine\"\nversion = \"0.1.0\"\n",
    );
    write(
        root,
        "packages/web/package.json",
        "{\n  \"name\": \"@fixture/web\"\n}\n",
    );
    write(
        root,
        "services/orders/pyproject.toml",
        "[project]\nname = \"Orders_API\"\nversion = \"0.1.0\"\n",
    );
    write(
        root,
        "tools/library/composer.json",
        "{\n  \"name\": \"Fixture/Library\"\n}\n",
    );
}

/// Фікстура `diagnostics` — зламаний JSON, маніфест без назви і дві однакові
/// канонічні ідентичності.
fn diagnostics_fixture(root: &Path) {
    write(root, "bad/package.json", "{\n  \"name\":\n}\n");
    write(
        root,
        "missing/Cargo.toml",
        "[package]\nversion = \"0.1.0\"\n",
    );
    write(
        root,
        "python-one/pyproject.toml",
        "[project]\nname = \"Orders_API\"\n",
    );
    write(
        root,
        "python-two/pyproject.toml",
        "[tool.poetry]\nname = \"orders-api\"\n",
    );
}

/// Ідентичність домену НЕ залежить від шляху: `Orders_API` у Python і
/// `Fixture/Library` у composer канонізуються, npm і cargo лишаються як є.
#[test]
fn every_supported_manifest_gives_a_path_independent_canonical_identity() {
    let root = temp_root("monorepo");
    monorepo(&root);
    let resolved = resolve_documentation_domains(&root).expect("резолв не падає");

    assert!(
        resolved.diagnostics.is_empty(),
        "несподівані діагностики: {:?}",
        resolved.diagnostics
    );
    let seen: Vec<(&str, &str, &str)> = resolved
        .domains
        .iter()
        .map(|domain| {
            (
                domain.id.as_str(),
                domain.ecosystem.as_str(),
                domain.root_manifest.as_str(),
            )
        })
        .collect();
    assert_eq!(
        seen,
        vec![
            (
                "cargo:fixture-engine",
                "cargo",
                "packages/engine/Cargo.toml"
            ),
            (
                "composer:fixture/library",
                "composer",
                "tools/library/composer.json"
            ),
            ("npm:@fixture/root", "npm", "package.json"),
            ("npm:@fixture/web", "npm", "packages/web/package.json"),
            (
                "python:orders-api",
                "python",
                "services/orders/pyproject.toml"
            ),
        ]
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Вкладений домен документує СЕБЕ: батьківський виключає його корінь, а
/// власником файла стає найглибший домен.
#[test]
fn nested_roots_are_excluded_from_the_parent_and_the_deepest_domain_wins() {
    let root = temp_root("nested");
    monorepo(&root);
    let resolved = resolve_documentation_domains(&root).expect("резолв не падає");
    let parent = resolved
        .domains
        .iter()
        .find(|domain| domain.id == "npm:@fixture/root")
        .expect("кореневий домен знайдено");

    assert_eq!(parent.source_roots, vec![".".to_string()]);
    assert_eq!(
        parent.excluded_source_roots,
        vec![
            "packages/engine".to_string(),
            "packages/web".to_string(),
            "services/orders".to_string(),
            "tools/library".to_string()
        ]
    );
    assert_eq!(
        resolve_domain_for_path(
            &resolved.domains,
            Path::new("packages/web/src/app.mjs"),
            &root
        )
        .map(|domain| domain.id.as_str()),
        Some("npm:@fixture/web")
    );
    assert_eq!(
        resolve_domain_for_path(&resolved.domains, Path::new("src/index.mjs"), &root)
            .map(|domain| domain.id.as_str()),
        Some("npm:@fixture/root")
    );
    assert!(
        resolve_domain_for_path(&resolved.domains, &root.join("../outside.mjs"), &root).is_none(),
        "шлях поза репозиторієм не належить жодному домену"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Замість fallback-ідентичності з шляху — стабільні блокери. Ідентичність,
/// вигадана зі шляху, тихо роздвоїла б знання про той самий пакет.
#[test]
fn blocking_diagnostics_replace_path_based_fallback_identities() {
    let root = temp_root("diagnostics");
    diagnostics_fixture(&root);
    let resolved = resolve_documentation_domains(&root).expect("резолв не падає");

    assert_eq!(
        resolved
            .domains
            .iter()
            .map(|domain| domain.id.as_str())
            .collect::<Vec<_>>(),
        vec!["python:orders-api", "python:orders-api"],
        "обидва домени лишаються — це діагностика, а не мовчазне відкидання"
    );
    let codes: Vec<&str> = resolved
        .diagnostics
        .iter()
        .map(|item| item.code.as_str())
        .collect();
    assert_eq!(
        codes,
        vec![
            "duplicate-domain-id",
            "manifest-name-missing",
            "manifest-parse-failed"
        ]
    );
    let duplicate = &resolved.diagnostics[0];
    assert_eq!(duplicate.domain_id.as_deref(), Some("python:orders-api"));
    assert_eq!(
        duplicate.manifests.as_deref(),
        Some(
            [
                "python-one/pyproject.toml".to_string(),
                "python-two/pyproject.toml".to_string()
            ]
            .as_slice()
        )
    );
    assert_eq!(resolved.diagnostics[1].manifest, "missing/Cargo.toml");
    assert_eq!(resolved.diagnostics[2].manifest, "bad/package.json");
    assert!(
        resolved
            .diagnostics
            .iter()
            .all(|item| item.severity == "error"),
        "усі діагностики резолвера блокують публікацію"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn only_ecosystem_defined_name_variants_are_canonicalized() {
    assert_eq!(
        canonical_domain_name("python", Some("Orders_API")).as_deref(),
        Some("orders-api")
    );
    assert_eq!(
        canonical_domain_name("composer", Some("Fixture/Library")).as_deref(),
        Some("fixture/library")
    );
    assert_eq!(
        canonical_domain_name("npm", Some("@fixture/pkg")).as_deref(),
        Some("@fixture/pkg"),
        "npm уже визначає канонічну ідентичність сам"
    );
    assert_eq!(canonical_domain_name("cargo", Some("")), None);
    assert_eq!(canonical_domain_name("cargo", None), None);
}

/// Маніфест, що не визначає пакета, — не помилка й не домен.
#[test]
fn workspace_only_cargo_and_config_only_python_manifests_are_skipped() {
    let root = temp_root("skips");
    write(
        &root,
        "Cargo.toml",
        "[workspace]\nmembers = [\"crates/*\"]\n",
    );
    write(&root, "pyproject.toml", "[tool.ruff]\nline-length = 120\n");

    let resolved = resolve_documentation_domains(&root).expect("резолв не падає");
    assert!(resolved.domains.is_empty());
    assert!(resolved.diagnostics.is_empty());
    let _ = std::fs::remove_dir_all(&root);
}
