//! Cross-документна аналітика abie HTTPRoute — точний порт
//! `npm/rules/abie/lib/http-route.mjs` (101 рядок): підрахунок `backendRefs`
//! до спільних сервісів (`auth-run-hl`, `file-link-hl`) у base-маніфестах
//! пакета (поза overlay `ua`).

use std::path::{Path, PathBuf};

use super::abie_overlay_paths::is_k8s_yaml_in_abie_package_excluding_ua_overlay;
use super::abie_yaml::{read_and_parse_yaml_docs, rel_posix_or_self};

/// Імена спільних headless-сервісів — точний порт
/// `ABIE_SHARED_CROSS_NS_BACKEND_NAMES` (`http-route.mjs:13`).
pub(crate) const ABIE_SHARED_CROSS_NS_BACKEND_NAMES: &[&str] = &["auth-run-hl", "file-link-hl"];

/// Результат [`analyze_abie_shared_backend_refs_in_package_k8s`] — точний
/// порт `{ refCount, baseErrors }` (`http-route.mjs:75`).
pub(crate) struct SharedBackendAnalysis {
    pub(crate) ref_count: u32,
    pub(crate) base_errors: Vec<String>,
}

/// Перевіряє один `backendRef` — точний порт `checkSharedBackendRef`
/// (`http-route.mjs:23-35`).
fn check_shared_backend_ref(br: &serde_json::Value, rel: &str, errors: &mut Vec<String>) -> u32 {
    let Some(obj) = br.as_object() else { return 0 };
    let Some(name) = obj.get("name").and_then(|n| n.as_str()) else {
        return 0;
    };
    if !ABIE_SHARED_CROSS_NS_BACKEND_NAMES.contains(&name) {
        return 0;
    }
    let namespace_ok = obj.get("namespace").and_then(|n| n.as_str()) == Some("dev");
    if !namespace_ok {
        errors.push(format!(
            "{rel}: HTTPRoute backendRefs до {name} має містити namespace: dev (abie.mdc)"
        ));
    }
    // `!==` порівняння з числом 8080 у JS — `as_f64` покриває і int, і float
    // YAML-числа; рядкове значення (`as_f64` → `None`) теж коректно НЕ
    // проходить перевірку, як і в оригіналі.
    let port_ok = obj.get("port").and_then(|p| p.as_f64()) == Some(8080.0);
    if !port_ok {
        errors.push(format!(
            "{rel}: HTTPRoute backendRefs до {name} має містити port: 8080 (abie.mdc)"
        ));
    }
    1
}

/// Збирає по HTTPRoute-документу кількість посилань на shared backends і
/// порушення namespace/port — точний порт `httpRouteDocSharedCrossNsBackendStats`
/// (`http-route.mjs:43-67`).
fn http_route_doc_shared_cross_ns_backend_stats(
    obj: &serde_json::Value,
    rel: &str,
) -> (u32, Vec<String>) {
    let mut errors = Vec::new();
    let Some(map) = obj.as_object() else {
        return (0, errors);
    };
    if map.get("kind").and_then(|k| k.as_str()) != Some("HTTPRoute") {
        return (0, errors);
    }
    let Some(spec) = map.get("spec").and_then(|s| s.as_object()) else {
        return (0, errors);
    };
    let Some(rules) = spec.get("rules").and_then(|r| r.as_array()) else {
        return (0, errors);
    };
    let mut ref_count = 0;
    for rule in rules {
        let Some(rule_obj) = rule.as_object() else {
            continue;
        };
        let Some(brs) = rule_obj.get("backendRefs").and_then(|b| b.as_array()) else {
            continue;
        };
        for br in brs {
            ref_count += check_shared_backend_ref(br, rel, &mut errors);
        }
    }
    (ref_count, errors)
}

/// Збирає по yaml-файлах пакета (поза overlay ua) кількість shared-`-hl`
/// `backendRefs` і базові помилки (без `namespace: dev`/`port: 8080`) —
/// точний порт `analyzeAbieSharedBackendRefsInPackageK8s` (`http-route.mjs:77-101`).
/// Помилки читання файлу — мовчки пропускаються (`silentFail` у JS-версії:
/// `readAndParseYamlDocs(abs, rel, silentFail)`, не свій `fail`).
pub(crate) fn analyze_abie_shared_backend_refs_in_package_k8s(
    root: &Path,
    pkg_abs: &Path,
    yaml_files_abs: &[PathBuf],
) -> SharedBackendAnalysis {
    let pkg_rel = rel_posix_or_self(root, pkg_abs);
    let mut ref_count = 0;
    let mut base_errors = Vec::new();
    for abs in yaml_files_abs {
        let rel = rel_posix_or_self(root, abs);
        if !is_k8s_yaml_in_abie_package_excluding_ua_overlay(&rel, &pkg_rel) {
            continue;
        }
        if let Ok(docs) = read_and_parse_yaml_docs(abs, &rel) {
            for doc in docs {
                let (rc, errs) = http_route_doc_shared_cross_ns_backend_stats(&doc, &rel);
                ref_count += rc;
                base_errors.extend(errs);
            }
        }
    }
    SharedBackendAnalysis {
        ref_count,
        base_errors,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn shared_names_are_canonical() {
        assert!(ABIE_SHARED_CROSS_NS_BACKEND_NAMES.contains(&"auth-run-hl"));
        assert!(ABIE_SHARED_CROSS_NS_BACKEND_NAMES.contains(&"file-link-hl"));
    }

    // --- дзеркало lib/tests/http-route.test.mjs ---

    #[test]
    fn missing_namespace_dev_is_error_then_ok_with_namespace() {
        let tmp = TempDir::new().unwrap();
        let hr_path = "p/k8s/base/hr.yaml";
        write(
            &tmp,
            hr_path,
            "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: x\nspec:\n  rules:\n    - backendRefs:\n        - name: auth-run-hl\n          port: 8080\n",
        );
        let hr_abs = tmp.path().join(hr_path);
        let yaml_files_abs = vec![hr_abs.clone()];
        let bad = analyze_abie_shared_backend_refs_in_package_k8s(
            tmp.path(),
            &tmp.path().join("p"),
            &yaml_files_abs,
        );
        assert_eq!(bad.ref_count, 1);
        assert_eq!(bad.base_errors.len(), 1);

        write(
            &tmp,
            hr_path,
            "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: x\nspec:\n  rules:\n    - backendRefs:\n        - name: auth-run-hl\n          namespace: dev\n          port: 8080\n",
        );
        let ok = analyze_abie_shared_backend_refs_in_package_k8s(
            tmp.path(),
            &tmp.path().join("p"),
            &yaml_files_abs,
        );
        assert_eq!(ok.ref_count, 1);
        assert_eq!(ok.base_errors.len(), 0);
    }

    #[test]
    fn missing_or_wrong_port_is_error() {
        let tmp = TempDir::new().unwrap();
        let hr_path = "p/k8s/base/hr.yaml";
        write(
            &tmp,
            hr_path,
            "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: x\nspec:\n  rules:\n    - backendRefs:\n        - name: file-link-hl\n          namespace: dev\n",
        );
        let hr_abs = tmp.path().join(hr_path);
        let yaml_files_abs = vec![hr_abs.clone()];
        let no_port = analyze_abie_shared_backend_refs_in_package_k8s(
            tmp.path(),
            &tmp.path().join("p"),
            &yaml_files_abs,
        );
        assert_eq!(no_port.ref_count, 1);
        assert_eq!(no_port.base_errors.len(), 1);
        assert!(no_port.base_errors[0].contains("port: 8080"));

        write(
            &tmp,
            hr_path,
            "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: x\nspec:\n  rules:\n    - backendRefs:\n        - name: file-link-hl\n          namespace: dev\n          port: 9090\n",
        );
        let wrong_port = analyze_abie_shared_backend_refs_in_package_k8s(
            tmp.path(),
            &tmp.path().join("p"),
            &yaml_files_abs,
        );
        assert_eq!(wrong_port.ref_count, 1);
        assert_eq!(wrong_port.base_errors.len(), 1);
        assert!(wrong_port.base_errors[0].contains("port: 8080"));
    }
}
