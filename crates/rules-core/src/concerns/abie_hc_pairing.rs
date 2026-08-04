//! Native-порт `abie/hc_pairing` (`npm/rules/abie/hc_pairing/main.mjs`, 52
//! рядки) — для кожної директорії з `kind: Deployment` під `k8s/` має існувати
//! `hc.yaml` поруч із коректним modeline (`yaml-language-server $schema`).

use std::path::Path;

use super::abie_hc_yaml::validate_abie_hc_modeline;
use super::abie_k8s_tree::{collect_deployment_dirs, find_k8s_yaml_files};
use super::abie_yaml::rel_posix_or_self;
use super::cursor_ignore::load_cursor_ignore_paths;
use crate::diagnostics::{Severity, Violation};

/// Дефолтний `reason` (`fail(msg)` без `opts` на всіх call site'ах
/// `main.mjs` → `ctx.concernId` = `hc_pairing`).
const REASON: &str = "hc_pairing";

fn fail(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `abie/hc_pairing` — точний порт `lint(ctx)` (`main.mjs:16-52`).
/// Обхід дерева й repo-локальний ignore-конфіг — той самий підхід, що й в
/// `env_dns`/`firebase_hosting`: [`load_cursor_ignore_paths`] читається
/// самим concern-ом (docs `cursor_ignore.rs`, секція «Відхилення від Р5»).
pub fn hc_pairing(root: &Path) -> Vec<Violation> {
    let ignore_paths = load_cursor_ignore_paths(root);
    let yamls = find_k8s_yaml_files(root, &ignore_paths);

    let mut violations = Vec::new();
    let deployment_dirs = collect_deployment_dirs(root, &yamls, |msg| violations.push(fail(msg)));

    if deployment_dirs.is_empty() {
        // «Немає Deployment у k8s/-дереві — перевірку hc.yaml пропущено»
        // (`main.mjs:25-28`) — pass, не violation.
        return violations;
    }

    // `[...deploymentDirs].toSorted(localeCompare)` (`main.mjs:31`) —
    // `BTreeSet` уже дає детермінований byte-lexicographic порядок.
    for dir in &deployment_dirs {
        let dir_path = Path::new(dir);
        let hc_abs = dir_path.join("hc.yaml");
        let rel_hc = rel_posix_or_self(root, &hc_abs);

        if !hc_abs.exists() {
            let rel_dir = rel_posix_or_self(root, dir_path);
            violations.push(fail(format!(
                "{rel_dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)"
            )));
            continue;
        }

        let raw = match std::fs::read_to_string(&hc_abs) {
            Ok(s) => s,
            Err(err) => {
                violations.push(fail(format!("{rel_hc}: не вдалося прочитати ({err})")));
                continue;
            }
        };

        if let Some(err) = validate_abie_hc_modeline(&raw, &rel_hc) {
            violations.push(fail(err));
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::abie_hc_yaml::ABIE_HC_SCHEMA_URL;
    use crate::concerns::test_support::write;

    const DEPLOYMENT_YAML: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  replicas: 1\n  template:\n    metadata: { labels: { app: api } }\n    spec:\n      containers:\n        - { name: api, image: example/api:latest }\n";

    fn valid_hc() -> String {
        format!(
            "# yaml-language-server: $schema={ABIE_HC_SCHEMA_URL}\napiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\nmetadata:\n  name: api-hc\nspec: {{ default: {{ config: {{ type: HTTP }} }} }}\n"
        )
    }

    // --- дзеркало tests/hc_pairing.test.mjs ---

    #[test]
    fn no_k8s_tree_is_clean_skip() {
        let tmp = TempDir::new().unwrap();
        assert!(hc_pairing(tmp.path()).is_empty());
    }

    #[test]
    fn deployment_with_valid_hc_yaml_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/deploy.yaml", DEPLOYMENT_YAML);
        write(&tmp, "pkg/k8s/hc.yaml", &valid_hc());
        assert!(hc_pairing(tmp.path()).is_empty());
    }

    #[test]
    fn deployment_without_hc_yaml_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/deploy.yaml", DEPLOYMENT_YAML);
        let violations = hc_pairing(tmp.path());
        assert!(!violations.is_empty());
        assert!(violations
            .iter()
            .any(|v| v.message.contains("немає hc.yaml поруч")));
    }

    #[test]
    fn deployment_with_wrong_schema_hc_yaml_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/deploy.yaml", DEPLOYMENT_YAML);
        write(
            &tmp,
            "pkg/k8s/hc.yaml",
            "# yaml-language-server: $schema=https://example.com/wrong.json\napiVersion: x\n",
        );
        let violations = hc_pairing(tmp.path());
        assert!(!violations.is_empty());
    }

    #[test]
    fn k8s_tree_without_deployment_is_clean_skip() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/k8s/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata: { name: x }\n",
        );
        assert!(hc_pairing(tmp.path()).is_empty());
    }

    #[test]
    fn two_packages_only_one_without_hc_yaml_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg-a/k8s/deploy.yaml", DEPLOYMENT_YAML);
        write(&tmp, "pkg-a/k8s/hc.yaml", &valid_hc());
        write(&tmp, "pkg-b/k8s/deploy.yaml", DEPLOYMENT_YAML);
        let violations = hc_pairing(tmp.path());
        assert!(!violations.is_empty());
    }

    #[test]
    fn all_violations_have_hc_pairing_reason() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/deploy.yaml", DEPLOYMENT_YAML);
        let violations = hc_pairing(tmp.path());
        assert!(violations.iter().all(|v| v.reason == "hc_pairing"));
    }
}
