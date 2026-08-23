//! Black-box дзеркало двох сценаріїв `npm/rules/graphql/tooling/tests/tooling.test.mjs`
//! (`describe('check (tooling.mjs)')`, рядки 74-97), яких не можна відтворити
//! у `src/concerns/graphql_tooling.rs` без реального `conftest` і без
//! override кореня пакета `@7n/rules`:
//!
//! - «exit 0 — gql знайдено, `.graphqlrc.yml` є, `extensions.json` з
//!   `graphql.vscode-graphql`»;
//! - «exit 1 — gql знайдено, `.graphqlrc.yml` є, `extensions.json` без
//!   `graphql.vscode-graphql`».
//!
//! Обидва спавнять справжній `conftest` проти справжнього rego-пакета
//! `npm/rules/graphql/vscode_extensions` — той самий принцип пропуску за
//! відсутності тула, що в `tests/rego_conftest_verify.rs`.
//!
//! Корінь пакета резолвиться природно, без override і без мутації
//! `N_RULES_PACKAGE_ROOT` (якого паралельно читають/перевіряють інші тести
//! того ж процесу): tmp-дерево кладеться ВСЕРЕДИНІ цього ж репозиторію
//! (`tempdir_in(CARGO_MANIFEST_DIR)`), тож `rules_package::package_root_from_tree`
//! знаходить `npm/package.json` (`"name": "@7n/rules"`) серед предків — той
//! самий каскад «крок 3: dev-репо самого пакета» (доккомент
//! `crates/rules-core/src/rules_package.rs`).

use std::fs;
use std::path::Path;

use rules_core::concerns::graphql_tooling;
use rules_core::tool_resolve::resolve_cmd;
use tempfile::TempDir;

/// Чи резолвиться `conftest` у цьому середовищі — той самий голий резолв,
/// що використовує сам концерн (`crate::conftest::run_conftest_batch`).
fn conftest_available() -> bool {
    resolve_cmd("conftest").is_some()
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("є батько")).expect("тека");
    fs::write(path, content).expect("файл");
}

/// tmp-дерево ВСЕРЕДИНІ репозиторію (не системний `/tmp`) — щоб
/// `rules_package::rules_root` знайшов `npm/package.json` серед предків без
/// `N_RULES_PACKAGE_ROOT`-override.
fn tmp_in_repo() -> TempDir {
    tempfile::Builder::new()
        .prefix("graphql-tooling-test-")
        .tempdir_in(env!("CARGO_MANIFEST_DIR"))
        .expect("tempdir у репозиторії")
}

/// «exit 0 — gql знайдено, .graphqlrc.yml є, extensions.json з
/// graphql.vscode-graphql» (`tooling.test.mjs:74-84`).
#[test]
fn valid_setup_with_recommended_extension_is_clean() {
    if !conftest_available() {
        eprintln!("graphql/tooling: пропуск — conftest недоступний у середовищі");
        return;
    }
    let tmp = tmp_in_repo();
    write(tmp.path(), "api.js", "const q = gql`query { me { id } }`\n");
    write(tmp.path(), ".graphqlrc.yml", "schema: schema.graphql\n");
    write(
        tmp.path(),
        ".vscode/extensions.json",
        r#"{"recommendations":["graphql.vscode-graphql"]}"#,
    );

    let violations = graphql_tooling(tmp.path()).expect("conftest і корінь пакета резолвляться");
    assert!(violations.is_empty(), "{violations:?}");
}

/// «exit 1 — gql знайдено, .graphqlrc.yml є, extensions.json без
/// graphql.vscode-graphql» (`tooling.test.mjs:86-97`) — rego-полісі
/// `graphql.vscode_extensions` дає одну violation з `reason: "tooling"`.
#[test]
fn missing_recommended_extension_yields_violation() {
    if !conftest_available() {
        eprintln!("graphql/tooling: пропуск — conftest недоступний у середовищі");
        return;
    }
    let tmp = tmp_in_repo();
    write(tmp.path(), "api.js", "const q = gql`query { me { id } }`\n");
    write(tmp.path(), ".graphqlrc.yml", "schema: schema.graphql\n");
    write(
        tmp.path(),
        ".vscode/extensions.json",
        r#"{"recommendations":["eslint.vscode-eslint"]}"#,
    );

    let violations = graphql_tooling(tmp.path()).expect("conftest і корінь пакета резолвляться");
    assert_eq!(violations.len(), 1, "{violations:?}");
    assert_eq!(violations[0].reason, "tooling");
    assert!(violations[0].message.contains("graphql.vscode-graphql"));
}
