//! Native-порт `abie/ua_http_route` (`npm/rules/abie/ua_http_route/main.mjs`,
//! 101 рядок) — коли в пакеті (батько `k8s/`) є `vite.config.*`, у
//! `…/k8s/ua/kustomization.yaml` має бути inline patch HTTPRoute
//! (hostnames+parentRefs.namespace). Без `vite.config` — patch не
//! вимагається. Без `ua/kustomization.yaml` взагалі — skip.
//!
//! # Без per-пакетного кешу
//!
//! JS-версія кешує `analyzeAbieSharedBackendRefsInPackageK8s(...)` за
//! `pkgAbs` у `Map` на час одного виклику `lint()` (`main.mjs:39-40,53-57`) —
//! оптимізація для декількох `ua/kustomization.yaml` в одному пакеті
//! (нетиповий, але можливий кейс). Тут — пряме повторне обчислення: чиста
//! функція без побічних ефектів, кеш не впливає на видиму поведінку (лише на
//! швидкість), той самий принцип спрощення, що й відсутність кешу в
//! `abie_k8s_tree` (докладніше — doc-комент цього модуля).

use std::path::Path;

use super::abie_http_route::analyze_abie_shared_backend_refs_in_package_k8s;
use super::abie_k8s_tree::find_k8s_yaml_files;
use super::abie_kustomization_patches::{
    get_combined_nginx_run_patch_text_from_kustomization,
    validate_abie_nginx_run_http_route_patches,
};
use super::abie_overlay_paths::{
    abie_overlay_requires_http_route_by_vite, abie_package_dir_from_k8s_overlay,
    is_ua_kustomization_path,
};
use super::abie_yaml::rel_posix_or_self;
use super::cursor_ignore::load_cursor_ignore_paths;
use crate::diagnostics::{Severity, Violation};

/// Дефолтний `reason` (`fail(msg)` без `opts` → `ctx.concernId` = `ua_http_route`).
const REASON: &str = "ua_http_route";

fn fail(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `abie/ua_http_route` — точний порт `lint(ctx)` (`main.mjs:25-80`).
pub fn ua_http_route(root: &Path) -> Vec<Violation> {
    let ignore_paths = load_cursor_ignore_paths(root);
    let yamls = find_k8s_yaml_files(root, &ignore_paths);

    let ua_abs_list: Vec<_> = yamls
        .iter()
        .filter(|abs| is_ua_kustomization_path(&rel_posix_or_self(root, abs)))
        .collect();

    if ua_abs_list.is_empty() {
        // «Немає ua/kustomization.yaml у дереві k8s — patch HTTPRoute (ua) не
        // вимагається» (`main.mjs:34-37`) — pass, не violation.
        return Vec::new();
    }

    let mut violations = Vec::new();

    for abs in ua_abs_list {
        let rel = rel_posix_or_self(root, abs);

        if !abie_overlay_requires_http_route_by_vite(root, abs) {
            // «HTTPRoute patch (ua) не застосовується — немає vite.config.*
            // у пакеті» (`main.mjs:45`) — pass, skip.
            continue;
        }

        let Some(pkg_abs) = abie_package_dir_from_k8s_overlay(root, abs) else {
            violations.push(fail(format!(
                "{rel}: внутрішня помилка abie overlay (немає каталогу пакета)"
            )));
            continue;
        };

        let analysis = analyze_abie_shared_backend_refs_in_package_k8s(root, &pkg_abs, &yamls);
        let mut has_base_error = false;
        for err in &analysis.base_errors {
            violations.push(fail(err.clone()));
            has_base_error = true;
        }
        if has_base_error {
            continue;
        }

        let raw = match std::fs::read_to_string(abs) {
            Ok(s) => s,
            Err(err) => {
                violations.push(fail(format!("{rel}: не вдалося прочитати ({err})")));
                continue;
            }
        };

        let combined = get_combined_nginx_run_patch_text_from_kustomization(&raw);
        let v = validate_abie_nginx_run_http_route_patches(
            &combined,
            "ua",
            analysis.ref_count as usize,
        );
        if let Some(v) = v {
            violations.push(fail(format!("{rel}: {v}")));
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    const KUSTOMIZATION_WITH_VALID_PATCH: &str = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\npatches:\n  - target: { kind: HTTPRoute, name: api-route }\n    patch: |\n      - op: replace\n        path: /spec/hostnames\n        value:\n          - api.abie.app\n      - op: replace\n        path: /spec/parentRefs/0/namespace\n        value: ua\n";

    const KUSTOMIZATION_WITHOUT_HOSTNAMES: &str = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\npatches:\n  - target: { kind: HTTPRoute, name: api-route }\n    patch: |\n      - op: replace\n        path: /spec/parentRefs/0/namespace\n        value: ua\n";

    // --- дзеркало tests/ua_http_route.test.mjs ---

    #[test]
    fn no_ua_kustomization_is_clean_skip() {
        let tmp = TempDir::new().unwrap();
        assert!(ua_http_route(tmp.path()).is_empty());
    }

    #[test]
    fn ua_kustomization_without_vite_config_is_clean_skip_per_file() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITH_VALID_PATCH,
        );
        assert!(ua_http_route(tmp.path()).is_empty());
    }

    #[test]
    fn vite_config_js_with_valid_http_route_patch_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/vite.config.js", "export default {}\n");
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITH_VALID_PATCH,
        );
        assert!(ua_http_route(tmp.path()).is_empty());
    }

    #[test]
    fn vite_config_mjs_with_patch_missing_hostnames_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/vite.config.mjs", "export default {}\n");
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITHOUT_HOSTNAMES,
        );
        assert!(!ua_http_route(tmp.path()).is_empty());
    }

    #[test]
    fn vite_config_ts_with_no_http_route_patch_at_all_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/vite.config.ts", "export default {}\n");
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\n",
        );
        assert!(!ua_http_route(tmp.path()).is_empty());
    }

    #[test]
    fn read_file_permission_denied_is_violation() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/vite.config.js", "export default {}\n");
        write(
            &tmp,
            "pkg/k8s/ua/kustomization.yaml",
            KUSTOMIZATION_WITH_VALID_PATCH,
        );
        let kusto = tmp.path().join("pkg/k8s/ua/kustomization.yaml");
        fs::set_permissions(&kusto, fs::Permissions::from_mode(0o000)).unwrap();

        let permission_check_effective = fs::read_to_string(&kusto).is_err();
        let violations = ua_http_route(tmp.path());

        fs::set_permissions(&kusto, fs::Permissions::from_mode(0o644)).unwrap();

        if permission_check_effective {
            assert!(!violations.is_empty());
        }
    }
}
