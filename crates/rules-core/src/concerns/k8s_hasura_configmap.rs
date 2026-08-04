//! Native-порт `k8s/hasura_configmap` (`npm/rules/k8s/hasura_configmap/main.mjs`,
//! 35 рядків) разом із його ядром `validateHasuraConfigMapRemoteSchemaPermissions`
//! (`npm/rules/k8s/manifests/main.mjs:3613-3645`).
//!
//! # Що це за концерн
//!
//! **Gated detector**: rego-пакет `k8s.hasura_configmap` перевіряє обов'язкові
//! `HASURA_GRAPHQL_*` env у `data` ConfigMap, але прогнати його на всі
//! `configmap.yaml` під `k8s` не можна — це дало б false positive на будь-якому
//! ConfigMap звичайного Job/CronJob (реальний інцидент, доккомент JS-канону).
//! Тому перед rego стоїть cross-file гейт: ConfigMap валідується, тільки якщо в
//! його каталозі є Hasura-Deployment. Гейт — тут, канон перевірки — у rego
//! (`crate::conftest`, секція «Навіщо окремий модуль»).
//!
//! # Обсяг порту
//!
//! - цілі — `*.yaml` під `k8s` ([`find_k8s_yaml_files`]), відфільтровані за
//!   `CONFIGMAP_BASE_PATH_RE` (`manifests/main.mjs:3541`, `/\/k8s\/base\/configmap\.yaml$/`);
//! - гейт — [`dir_has_hasura_deployment`] (**полагоджений** відносно JS —
//!   секція «Полагоджений дефект канону» доккоменту [`super::k8s_hasura`]);
//! - валідація — один спавн `conftest` на namespace `k8s.hasura_configmap`;
//! - кожен `failure` rego → violation з `reason = "hasura-configmap-env"`,
//!   `file` = posix-relative шлях, `data = {"kind": "hasura-configmap-env"}`
//!   (підказка T0 для fix-фази; дзеркало `fail(...)` у `main.mjs:3639`).
//!
//! # `pass`-повідомлення не проводяться
//!
//! JS-версія на чистому прогоні кличе `passFn(...)` («Hasura-ConfigMap (N)
//! містить обов'язкові env …»). Контракт [`super::run_concern`] несе лише
//! violations — `pass` у ньому немає в принципі (як і `verbose` у
//! `k8s/kubeconform`), і заводити його заради одного концерну не варто (Р12:
//! поверхня не росте). На набір порушень це не впливає.
//!
//! # `ctx.files` ігнорується — концерн full-scope
//!
//! У `concern.json` немає блоку `lint`, тож поверхня похідна від `policy`
//! (`deriveLintFromPolicy`, `run-detectors.mjs:37-45`): `scope: 'full'`, а
//! `walkGlob` слугує лише тригером у дельта-режимі. Тому JS-`lint(ctx)` ніколи
//! не читає `ctx.files`, і порт так само бере повний обхід дерева.

use std::path::{Path, PathBuf};

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_yaml_files;
use crate::concerns::k8s_hasura::dir_has_hasura_deployment;
use crate::conftest::run_conftest_batch;
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::RulesError;

/// Каталог rego-полісі відносно `<корінь пакета>/rules` — `policyDirRel`
/// (`manifests/main.mjs:3634`).
const POLICY_DIR_REL: &str = "k8s/hasura_configmap";

/// Namespace rego-пакета (`manifests/main.mjs:3635`).
const NAMESPACE: &str = "k8s.hasura_configmap";

/// Стабільний machine code — явний `reason` JS-версії (`manifests/main.mjs:3639`).
const REASON: &str = "hasura-configmap-env";

/// Хвіст шляху цільового ConfigMap — порт `CONFIGMAP_BASE_PATH_RE`
/// (`manifests/main.mjs:3541`, `/\/k8s\/base\/configmap\.yaml$/u`, який
/// застосовується до `/${rel}`; для relative-шляху це рівно suffix-перевірка,
/// і вона ж покриває корінний випадок `k8s/base/configmap.yaml` — окрема
/// гілка `rel === '…'` у JS через ведучий слеш недосяжна).
const CONFIGMAP_BASE_PATH_SUFFIX: &str = "/k8s/base/configmap.yaml";

/// posix-relative шлях від `root`, або сам `abs`, якщо relativize не вдався —
/// порт `relative(root, x).replaceAll('\\','/') || x` (`manifests/main.mjs:3637`).
fn rel_posix(root: &Path, abs: &Path) -> String {
    match abs.strip_prefix(root) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        _ => abs.to_string_lossy().into_owned(),
    }
}

/// Цільові ConfigMap серед знайдених YAML — фільтр `cmFiles`
/// (`manifests/main.mjs:3614-3617`).
fn configmap_targets(root: &Path, yaml_files: &[PathBuf]) -> Vec<PathBuf> {
    yaml_files
        .iter()
        .filter(|abs| format!("/{}", rel_posix(root, abs)).ends_with(CONFIGMAP_BASE_PATH_SUFFIX))
        .cloned()
        .collect()
}

/// Detector `k8s/hasura_configmap` — порт `lint(ctx)`
/// (`hasura_configmap/main.mjs:20-35`) + `validateHasuraConfigMapRemoteSchemaPermissions`.
pub fn k8s_hasura_configmap(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let yaml_files = find_k8s_yaml_files(cwd, &ignore_paths);
    if yaml_files.is_empty() {
        return Ok(Vec::new());
    }

    let paired: Vec<PathBuf> = configmap_targets(cwd, &yaml_files)
        .into_iter()
        .filter(|cm| cm.parent().is_some_and(dir_has_hasura_deployment))
        .collect();
    if paired.is_empty() {
        return Ok(Vec::new());
    }

    let policy_abs = rules_root(cwd)
        .ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?
        .join(POLICY_DIR_REL);
    let failures = run_conftest_batch(&policy_abs, NAMESPACE, &paired)?;

    Ok(failures
        .into_iter()
        .map(|failure| {
            let rel = rel_posix(cwd, Path::new(&failure.filename));
            Violation {
                reason: REASON.to_string(),
                message: format!("{rel}: {}", failure.message),
                file: Some(rel),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "kind": REASON })),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    const HASURA_DEPLOYMENT: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: db-h\nspec:\n  template:\n    spec:\n      containers:\n        - name: h\n          image: hasura/graphql-engine:v2.49.0\n";

    /// Порожнє дерево — 0 violations і жодного походу по rego (тула немає в
    /// tmp-оточенні тесту, тож будь-який спавн упав би fail-closed).
    #[test]
    fn empty_tree_returns_no_violations() {
        let tmp = TempDir::new().unwrap();
        assert!(k8s_hasura_configmap(tmp.path()).unwrap().is_empty());
    }

    /// ConfigMap без Hasura-Deployment поруч — гейт закритий, conftest не
    /// кличеться (інакше було б fail-closed на відсутній пакет/тул).
    #[test]
    fn configmap_without_hasura_sibling_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/configmap.yaml", "kind: ConfigMap\n");
        write(&tmp, "k8s/base/cronjob.yaml", "kind: CronJob\n");
        assert!(k8s_hasura_configmap(tmp.path()).unwrap().is_empty());
    }

    /// Фільтр цілей: беруться лише `**/k8s/base/configmap.yaml`, не будь-який
    /// `configmap.yaml` під `k8s` (overlay-и мають власні перевірки).
    #[test]
    fn only_base_configmaps_are_targets() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "k8s/base/configmap.yaml", "kind: ConfigMap\n");
        write(&tmp, "svc/k8s/base/configmap.yaml", "kind: ConfigMap\n");
        write(
            &tmp,
            "k8s/overlays/prod/configmap.yaml",
            "kind: ConfigMap\n",
        );
        write(&tmp, "k8s/base/deployment.yaml", "kind: Deployment\n");

        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            configmap_targets(root, &files),
            vec![
                root.join("k8s/base/configmap.yaml"),
                root.join("svc/k8s/base/configmap.yaml"),
            ]
        );
    }

    /// Гейт відкритий, але корінь пакета не резолвиться (порожнє tmp-дерево,
    /// override не виставлено) → fail-closed із підказкою, а не мовчазні 0
    /// violations: мовчазний пропуск сховав би зниклу перевірку.
    ///
    /// Тест свідомо НЕ мутує `N_RULES_PACKAGE_ROOT` — у тому ж тест-процесі
    /// паралельно біжать інші тести крейта.
    #[test]
    fn open_gate_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/configmap.yaml", "kind: ConfigMap\n");
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);

        let err = k8s_hasura_configmap(tmp.path()).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }

    /// `rel_posix` дає posix-форму від кореня, а на шляху поза коренем —
    /// вихідний рядок (гілка `|| x` JS-канону).
    #[test]
    fn rel_posix_falls_back_to_absolute_outside_root() {
        assert_eq!(
            rel_posix(
                Path::new("/repo"),
                Path::new("/repo/k8s/base/configmap.yaml")
            ),
            "k8s/base/configmap.yaml"
        );
        assert_eq!(
            rel_posix(Path::new("/repo"), Path::new("/other/x.yaml")),
            "/other/x.yaml"
        );
    }
}
