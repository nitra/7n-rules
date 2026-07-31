//! Native-порти детермінованих lint-concern-ів + registry (E1 фази 5
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! Кожен підмодуль — 1:1 порт відповідного `main.mjs` з `npm/rules/<rule>/<concern>/`
//! (три пілоти без зовнішніх tool-залежностей — обраний за спекою порядок
//! «від чистих текстових/структурних перевірок»). Registry ([`NATIVE_CONCERNS`],
//! [`run_concern`]) — точка диспатчу для `rules-napi`-binding-а: JS-оркестратор
//! перевіряє належність `ruleId/concernId`-ключа до [`NATIVE_CONCERNS`] і, якщо
//! так, викликає native замість `import(main.mjs)` (співіснування, не fallback —
//! секція «Фаза 5» спеки).

use std::path::Path;

use crate::{diagnostics::Violation, RulesError};

mod abie_hc_pairing;
mod abie_hc_yaml;
mod abie_http_route;
mod abie_k8s_tree;
mod abie_kustomization_patches;
mod abie_overlay_paths;
mod abie_ua_http_route;
mod abie_ua_node_selector;
mod abie_yaml;
mod adr_hooks;
mod capacitor_platforms;
mod cargo_workspace;
mod change_file;
mod changelog_presence;
pub(crate) mod cursor_ignore;
mod dremio_logging;
mod env_dns;
mod find_src_tauri;
mod firebase_hosting;
mod forbidden_prettier;
mod gha_workflow;
mod glob_compat;
mod hasura_internal_urls;
mod hasura_migrations;
mod image_avif_generation;
mod image_compress_package_setup;
mod marksman_config;
mod package_manifest;
mod rego_tooling;
mod sample_secret;
mod security_trufflehog;
mod tauri_cargo_mutants_config;
mod tauri_core_test_isolation;
mod tauri_gitignore_target;
mod tauri_linux_deps;
mod tauri_release;
mod tauri_tool_surface;
mod tauri_updater;
mod template_subset;
mod text_formatting;
mod workspaces;

pub use abie_hc_pairing::hc_pairing as abie_hc_pairing;
pub use abie_ua_http_route::ua_http_route as abie_ua_http_route;
pub use abie_ua_node_selector::ua_node_selector as abie_ua_node_selector;
pub use adr_hooks::adr_hooks;
pub use capacitor_platforms::capacitor_platforms;
pub use changelog_presence::changelog_presence;
pub use dremio_logging::{dremio_logging, zk_logback_root_level_violation};
pub use env_dns::env_dns;
pub use firebase_hosting::firebase_hosting;
pub use forbidden_prettier::forbidden_prettier;
pub use hasura_internal_urls::hasura_internal_urls;
pub use hasura_migrations::hasura_migrations;
pub use image_avif_generation::image_avif_generation;
pub use image_compress_package_setup::image_compress_package_setup;
pub use marksman_config::marksman_config;
pub use rego_tooling::rego_tooling;
pub use sample_secret::sample_secret;
pub use security_trufflehog::security_trufflehog;
pub use tauri_cargo_mutants_config::tauri_cargo_mutants_config;
pub use tauri_core_test_isolation::tauri_core_test_isolation;
pub use tauri_gitignore_target::tauri_gitignore_target;
pub use tauri_linux_deps::tauri_linux_deps;
pub use tauri_release::tauri_release;
pub use tauri_tool_surface::tauri_tool_surface;
pub use tauri_updater::tauri_updater;
pub use text_formatting::text_formatting;

/// Ключі native-портованих concern-ів у форматі `ruleId/concernId` — той
/// самий формат, що й `progressKey` у JS-оркестраторі
/// (`npm/scripts/lib/lint-surface/run-detectors.mjs`), тож JS-шар може
/// використати ключ registry напряму без додаткового мапінгу.
pub const NATIVE_CONCERNS: &[&str] = &[
    "text/forbidden-prettier",
    "security/sample_secret",
    "k8s/dremio_logging",
    "rego/tooling",
    "doc-files/marksman_config",
    "abie/firebase_hosting",
    "abie/env_dns",
    "hasura/migrations",
    "image-compress/package_setup",
    "tauri/cargo_mutants_config",
    "tauri/gitignore_target",
    "tauri/linux_deps",
    "tauri/core_test_isolation",
    "abie/hc_pairing",
    "abie/ua_node_selector",
    "abie/ua_http_route",
    "hasura/internal_urls",
    "text/formatting",
    "tauri/release",
    "tauri/updater",
    "tauri/tool_surface",
    "security/trufflehog",
    "changelog/presence",
    "adr/hooks",
    "capacitor/platforms",
    "image-avif/avif_generation",
];

/// Запускає native-порт concern-а за ключем `ruleId/concernId`.
///
/// - `cwd` — абсолютний корінь consumer-репо (дзеркало `LintContext.cwd`).
/// - `files` — posix-relative файли для per-file concern-ів (дзеркало
///   `LintContext.files`); ігнорується whole-repo концернами
///   (`forbidden-prettier`, `sample_secret`) — так само, як їхні JS-версії
///   не читають `ctx.files` узагалі.
///
/// Невідомий ключ → [`RulesError::Concern`] (JS-loader має звіряти
/// приналежність до [`NATIVE_CONCERNS`] ДО виклику — це остання лінія
/// захисту, не основний контракт).
pub fn run_concern(
    key: &str,
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<Vec<Violation>, RulesError> {
    match key {
        "text/forbidden-prettier" => Ok(forbidden_prettier(cwd)),
        "security/sample_secret" => Ok(sample_secret(cwd)),
        "k8s/dremio_logging" => Ok(dremio_logging(cwd, files)),
        "rego/tooling" => Ok(rego_tooling(cwd)),
        "doc-files/marksman_config" => Ok(marksman_config(cwd)),
        "abie/firebase_hosting" => Ok(firebase_hosting(cwd)),
        "abie/env_dns" => Ok(env_dns(cwd)),
        "hasura/migrations" => Ok(hasura_migrations(cwd)),
        "image-compress/package_setup" => Ok(image_compress_package_setup(cwd)),
        "tauri/cargo_mutants_config" => Ok(tauri_cargo_mutants_config(cwd)),
        "tauri/gitignore_target" => Ok(tauri_gitignore_target(cwd)),
        "tauri/linux_deps" => Ok(tauri_linux_deps(cwd)),
        "tauri/core_test_isolation" => Ok(tauri_core_test_isolation(cwd)),
        "abie/hc_pairing" => Ok(abie_hc_pairing(cwd)),
        "abie/ua_node_selector" => Ok(abie_ua_node_selector(cwd)),
        "abie/ua_http_route" => Ok(abie_ua_http_route(cwd)),
        "hasura/internal_urls" => Ok(hasura_internal_urls(cwd)),
        "text/formatting" => Ok(text_formatting(cwd)),
        "tauri/release" => Ok(tauri_release(cwd)),
        "tauri/updater" => tauri_updater(cwd),
        "tauri/tool_surface" => tauri_tool_surface(cwd),
        "security/trufflehog" => Ok(security_trufflehog(cwd)),
        "changelog/presence" => changelog_presence(cwd, files),
        "adr/hooks" => Ok(adr_hooks(cwd)),
        "capacitor/platforms" => Ok(capacitor_platforms(cwd)),
        "image-avif/avif_generation" => Ok(image_avif_generation(cwd)),
        other => Err(RulesError::Concern(format!(
            "невідомий native concern: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_concerns_lists_all_twenty_six_entries() {
        assert_eq!(
            NATIVE_CONCERNS,
            &[
                "text/forbidden-prettier",
                "security/sample_secret",
                "k8s/dremio_logging",
                "rego/tooling",
                "doc-files/marksman_config",
                "abie/firebase_hosting",
                "abie/env_dns",
                "hasura/migrations",
                "image-compress/package_setup",
                "tauri/cargo_mutants_config",
                "tauri/gitignore_target",
                "tauri/linux_deps",
                "tauri/core_test_isolation",
                "abie/hc_pairing",
                "abie/ua_node_selector",
                "abie/ua_http_route",
                "hasura/internal_urls",
                "text/formatting",
                "tauri/release",
                "tauri/updater",
                "tauri/tool_surface",
                "security/trufflehog",
                "changelog/presence",
                "adr/hooks",
                "capacitor/platforms",
                "image-avif/avif_generation",
            ]
        );
    }

    #[test]
    fn run_concern_dispatches_known_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let violations = run_concern("text/forbidden-prettier", tmp.path(), None).unwrap();
        assert!(violations.is_empty());
    }

    /// Кожен із шести нових ключів F1 батчу 2 диспатчиться на свою функцію
    /// (не лише перевірені окремо в підмодулях) — smoke-перевірка самого
    /// `match` у `run_concern`, не повторних сценаріїв concern-ів.
    #[test]
    fn run_concern_dispatches_all_batch2_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in [
            "rego/tooling",
            "doc-files/marksman_config",
            "abie/firebase_hosting",
            "abie/env_dns",
            "hasura/migrations",
            "image-compress/package_setup",
        ] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    /// Кожен із чотирьох ключів G1 TOML-кластеру (фаза 5, батч 3) диспатчиться
    /// на свою функцію — smoke-перевірка самого `match` у `run_concern`, не
    /// повторних сценаріїв concern-ів (ті — у власних підмодулях).
    #[test]
    fn run_concern_dispatches_all_g1_toml_cluster_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in [
            "tauri/cargo_mutants_config",
            "tauri/gitignore_target",
            "tauri/linux_deps",
            "tauri/core_test_isolation",
        ] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    /// Кожен із трьох ключів H1 YAML-кластеру (фаза 5, батч 4 частина 1)
    /// диспатчиться на свою функцію — smoke-перевірка самого `match` у
    /// `run_concern` (не повторних сценаріїв concern-ів — ті у власних
    /// підмодулях).
    #[test]
    fn run_concern_dispatches_all_h1_yaml_cluster_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in [
            "abie/hc_pairing",
            "abie/ua_node_selector",
            "abie/ua_http_route",
        ] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    /// Кожен із трьох ключів I1 YAML-кластеру (фаза 5, батч 4 частина 2)
    /// диспатчиться на свою функцію — smoke-перевірка самого `match` у
    /// `run_concern` (не повторних сценаріїв concern-ів — ті у власних
    /// підмодулях).
    #[test]
    fn run_concern_dispatches_all_i1_yaml_cluster_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in ["hasura/internal_urls", "text/formatting", "tauri/release"] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    /// Кожен із чотирьох ключів PURE ч.1 батчу (фаза 5, фінальний важкий
    /// батч) диспатчиться на свою функцію — smoke-перевірка самого `match` у
    /// `run_concern` (не повторних сценаріїв concern-ів — ті у власних
    /// підмодулях). `changelog/presence` — per-file scope: `files: None`
    /// (full-режим) дає порожній результат без походу у файлову систему
    /// `.changes/`, той самий early-return, що й JS `lint()`.
    #[test]
    fn run_concern_dispatches_all_pure1_batch_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in [
            "tauri/updater",
            "tauri/tool_surface",
            "security/trufflehog",
            "changelog/presence",
        ] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    /// Кожен із трьох ключів PURE-фіналу (фаза 5, останній батч: адр/hooks,
    /// capacitor/platforms, image-avif/avif_generation) диспатчиться на свою
    /// функцію — smoke-перевірка самого `match` у `run_concern` (не
    /// повторних сценаріїв concern-ів — ті у власних підмодулях). Порожній
    /// tmp-каталог без `package.json`/`.vue` → жоден concern не падає (усі
    /// три fail-safe на відсутні файли/каталоги).
    #[test]
    fn run_concern_dispatches_all_pure_final_batch_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in [
            "adr/hooks",
            "capacitor/platforms",
            "image-avif/avif_generation",
        ] {
            assert!(
                run_concern(key, tmp.path(), None).is_ok(),
                "run_concern має прийняти ключ {key}"
            );
        }
    }

    #[test]
    fn run_concern_rejects_unknown_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let err = run_concern("k8s/unknown-concern", tmp.path(), None).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("k8s/unknown-concern"));
    }
}
