//! Path-хелпери для overlay-перевірок abie — точний порт
//! `npm/rules/abie/lib/overlay-paths.mjs` (97 рядків).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use super::abie_yaml::rel_posix_or_self;

static UA_KUSTOMIZATION_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^|/)ua/kustomization\.yaml$").expect("valid regex"));
static OVERLAY_PACKAGE_DIR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+)/k8s/ua/kustomization\.yaml$").expect("valid regex"));
static BASE_SEGMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^|/)base/").expect("valid regex"));

/// Чи `rel` — це `…/ua/kustomization.yaml` (abie overlay) — точний порт
/// `isUaKustomizationPath` (`overlay-paths.mjs:22-25`).
pub(crate) fn is_ua_kustomization_path(rel: &str) -> bool {
    UA_KUSTOMIZATION_PATH_RE.is_match(&rel.replace('\\', "/"))
}

/// Каталог пакета (батько `k8s/`) для overlay `…/k8s/ua/kustomization.yaml`
/// — точний порт `abiePackageDirFromK8sOverlay` (`overlay-paths.mjs:33-37`).
pub(crate) fn abie_package_dir_from_k8s_overlay(
    root: &Path,
    kustomization_abs: &Path,
) -> Option<PathBuf> {
    let rel = rel_posix_or_self(root, kustomization_abs);
    let caps = OVERLAY_PACKAGE_DIR_RE.captures(&rel)?;
    Some(root.join(&caps[1]))
}

/// Чи у каталозі пакета є `vite.config.{js,mjs,ts}` — точний порт
/// `abieOverlayRequiresHttpRouteByVite` (`overlay-paths.mjs:46-54`).
pub(crate) fn abie_overlay_requires_http_route_by_vite(
    root: &Path,
    kustomization_abs: &Path,
) -> bool {
    let Some(pkg) = abie_package_dir_from_k8s_overlay(root, kustomization_abs) else {
        return false;
    };
    pkg.join("vite.config.js").exists()
        || pkg.join("vite.config.mjs").exists()
        || pkg.join("vite.config.ts").exists()
}

/// Чи у дереві `k8s/` пакета є `Deployment` — точний порт
/// `abieOverlayK8sTreeHasDeployment` (`overlay-paths.mjs:63-72`).
pub(crate) fn abie_overlay_k8s_tree_has_deployment(
    deployment_dirs: &BTreeSet<String>,
    root: &Path,
    kustomization_abs: &Path,
) -> bool {
    let Some(pkg) = abie_package_dir_from_k8s_overlay(root, kustomization_abs) else {
        return false;
    };
    let k8s_root = pkg.join("k8s").to_string_lossy().replace('\\', "/");
    deployment_dirs.iter().any(|dir| {
        let norm = dir.replace('\\', "/");
        norm == k8s_root || norm.starts_with(&format!("{k8s_root}/"))
    })
}

/// Чи rel-шлях `…/k8s/base/…` (base-шар abie, не overlay) — точний порт
/// `isAbieK8sBaseYamlPath` (`overlay-paths.mjs:79-82`). Не використовується
/// жодним із трьох H1-концернів напряму (лишається неекспортованим із
/// `run_concern`, портовано для повноти дзеркала lib-модуля — той самий
/// статус, що й в оригіналі, де ця функція експортується, але жоден
/// `main.mjs` кластеру її не імпортує).
#[allow(dead_code)]
pub(crate) fn is_abie_k8s_base_yaml_path(rel: &str) -> bool {
    BASE_SEGMENT_RE.is_match(&rel.replace('\\', "/"))
}

/// Чи yaml належить до `<pkgRel>/k8s/**` поза `ua/` піддеревом (base-шар
/// abie) — точний порт `isK8sYamlInAbiePackageExcludingUaOverlay`
/// (`overlay-paths.mjs:90-97`).
pub(crate) fn is_k8s_yaml_in_abie_package_excluding_ua_overlay(
    rel_from_root: &str,
    pkg_rel_from_root: &str,
) -> bool {
    let norm_rel = rel_from_root.replace('\\', "/");
    let pkg = pkg_rel_from_root.replace('\\', "/");
    let pkg = pkg.trim_end_matches('/');
    let prefix = format!("{pkg}/k8s/");
    let Some(after) = norm_rel.strip_prefix(prefix.as_str()) else {
        return false;
    };
    !after.starts_with("ua/")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    // --- дзеркало lib/tests/overlay-paths.test.mjs ---

    #[test]
    fn is_ua_kustomization_path_matches_ua_kustomization() {
        assert!(is_ua_kustomization_path(
            "app/k8s/overlays/ua/kustomization.yaml"
        ));
        assert!(is_ua_kustomization_path(r"x\k8s\ua\kustomization.yaml"));
        assert!(!is_ua_kustomization_path("app/k8s/base/kustomization.yaml"));
        assert!(!is_ua_kustomization_path("app/k8s/ua/foo.yaml"));
    }

    #[test]
    fn abie_package_dir_from_k8s_overlay_extracts_package_root() {
        let root = Path::new("/repo");
        assert_eq!(
            abie_package_dir_from_k8s_overlay(root, &root.join("app/k8s/ua/kustomization.yaml")),
            Some(root.join("app"))
        );
        assert_eq!(
            abie_package_dir_from_k8s_overlay(root, &root.join("app/k8s/base/kustomization.yaml")),
            None
        );
    }

    #[test]
    fn abie_overlay_k8s_tree_has_deployment_checks_prefix() {
        let root = Path::new("/r");
        let ua_k = root.join("pkg/k8s/ua/kustomization.yaml");
        let dirs: BTreeSet<String> =
            [root.join("pkg/k8s/base").to_string_lossy().into_owned()].into();
        assert!(abie_overlay_k8s_tree_has_deployment(&dirs, root, &ua_k));
        let other: BTreeSet<String> =
            [root.join("other/k8s/base").to_string_lossy().into_owned()].into();
        assert!(!abie_overlay_k8s_tree_has_deployment(&other, root, &ua_k));
    }

    #[test]
    fn abie_overlay_requires_http_route_by_vite_checks_package_dir() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("svc/k8s/ua")).unwrap();
        let ua_abs = root.join("svc/k8s/ua/kustomization.yaml");
        fs::write(&ua_abs, "kind: Kustomization\n").unwrap();
        assert!(!abie_overlay_requires_http_route_by_vite(root, &ua_abs));
        fs::write(root.join("svc/vite.config.js"), "export default {}\n").unwrap();
        assert!(abie_overlay_requires_http_route_by_vite(root, &ua_abs));
    }

    #[test]
    fn is_abie_k8s_base_yaml_path_matches_base_segment() {
        assert!(is_abie_k8s_base_yaml_path("app/k8s/base/deploy.yaml"));
        assert!(is_abie_k8s_base_yaml_path(r"pkg\k8s\base\a.yaml"));
        assert!(!is_abie_k8s_base_yaml_path("app/k8s/ua/kustomization.yaml"));
    }

    #[test]
    fn is_k8s_yaml_in_abie_package_excluding_ua_overlay_filters_correctly() {
        assert!(is_k8s_yaml_in_abie_package_excluding_ua_overlay(
            "app/k8s/base/hr.yaml",
            "app"
        ));
        assert!(!is_k8s_yaml_in_abie_package_excluding_ua_overlay(
            "app/k8s/ua/kustomization.yaml",
            "app"
        ));
        assert!(!is_k8s_yaml_in_abie_package_excluding_ua_overlay(
            "other/k8s/base/x.yaml",
            "app"
        ));
    }
}
