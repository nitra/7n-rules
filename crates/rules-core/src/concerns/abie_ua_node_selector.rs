//! Native-порт `abie/ua_node_selector` (`npm/rules/abie/ua_node_selector/main.mjs`,
//! 62 рядки) — коли в дереві `…/k8s/` пакета є `Deployment`, у
//! `…/k8s/ua/kustomization.yaml` має бути inline patch на `Deployment` з
//! `path: /spec/template/spec/nodeSelector` і `preem: false`.

use std::path::Path;

use super::abie_k8s_tree::{collect_deployment_dirs, find_k8s_yaml_files};
use super::abie_kustomization_patches::kustomization_has_abie_deployment_node_selector_patch;
use super::abie_overlay_paths::{abie_overlay_k8s_tree_has_deployment, is_ua_kustomization_path};
use super::abie_yaml::rel_posix_or_self;
use super::cursor_ignore::load_cursor_ignore_paths;
use crate::diagnostics::{Severity, Violation};

/// Дефолтний `reason` (`fail(msg)` без `opts` → `ctx.concernId` = `ua_node_selector`).
const REASON: &str = "ua_node_selector";

fn fail(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `abie/ua_node_selector` — точний порт `lint(ctx)` (`main.mjs:16-62`).
pub fn ua_node_selector(root: &Path) -> Vec<Violation> {
    let ignore_paths = load_cursor_ignore_paths(root);
    let yamls = find_k8s_yaml_files(root, &ignore_paths);

    let mut violations = Vec::new();
    let deployment_dirs = collect_deployment_dirs(root, &yamls, |msg| violations.push(fail(msg)));

    if deployment_dirs.is_empty() {
        // «Немає Deployment у k8s — patch nodeSelector (ua) не вимагається»
        // (`main.mjs:25-28`) — pass, не violation.
        return violations;
    }

    let ua_abs_list: Vec<_> = yamls
        .iter()
        .filter(|abs| is_ua_kustomization_path(&rel_posix_or_self(root, abs)))
        .collect();

    if ua_abs_list.is_empty() {
        violations.push(fail(
            "Є Deployment у k8s — додай ua/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, preem false (abie.mdc)"
                .to_string(),
        ));
        return violations;
    }

    for abs in ua_abs_list {
        let rel = rel_posix_or_self(root, abs);
        if !abie_overlay_k8s_tree_has_deployment(&deployment_dirs, root, abs) {
            // «nodeSelector patch (ua) не застосовується — немає Deployment
            // у дереві k8s цього пакета» (`main.mjs:41`) — pass, skip.
            continue;
        }

        let raw = match std::fs::read_to_string(abs) {
            Ok(s) => s,
            Err(err) => {
                violations.push(fail(format!("{rel}: не вдалося прочитати ({err})")));
                continue;
            }
        };

        if !kustomization_has_abie_deployment_node_selector_patch(&raw, "ua") {
            violations.push(fail(format!(
                "{rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та preem: false (abie.mdc)"
            )));
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    const DEPLOYMENT_YAML: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: api }\nspec:\n  template:\n    metadata: { labels: { app: api } }\n    spec: { containers: [{ name: api, image: example/api:latest }] }\n";

    const KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH: &str = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\npatches:\n  - target: { kind: Deployment }\n    patch: |\n      - op: add\n        path: /spec/template/spec/nodeSelector\n        value:\n          preem: 'false'\n";

    const KUSTOMIZATION_WITHOUT_PATCH: &str =
        "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\n";

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    // --- дзеркало tests/ua_node_selector.test.mjs ---

    #[test]
    fn no_deployment_in_k8s_is_clean_skip() {
        let tmp = TempDir::new().unwrap();
        assert!(ua_node_selector(tmp.path()).is_empty());
    }

    #[test]
    fn deployment_with_correct_patch_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/base/deploy.yaml", DEPLOYMENT_YAML);
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH,
        );
        assert!(ua_node_selector(tmp.path()).is_empty());
    }

    #[test]
    fn deployment_without_any_ua_kustomization_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/base/deploy.yaml", DEPLOYMENT_YAML);
        assert!(!ua_node_selector(tmp.path()).is_empty());
    }

    #[test]
    fn deployment_with_ua_kustomization_without_patch_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/base/deploy.yaml", DEPLOYMENT_YAML);
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITHOUT_PATCH,
        );
        assert!(!ua_node_selector(tmp.path()).is_empty());
    }

    #[test]
    fn ua_kustomization_for_package_without_deployment_is_clean_skip_per_file() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg-a/k8s/base/deploy.yaml", DEPLOYMENT_YAML);
        write(
            &tmp,
            "pkg-a/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH,
        );
        write(
            &tmp,
            "pkg-b/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITHOUT_PATCH,
        );
        assert!(ua_node_selector(tmp.path()).is_empty());
    }
}
