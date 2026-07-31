//! Парсинг inline JSON6902-патчів у abie ua-kustomization — точний порт
//! `npm/rules/abie/lib/kustomization-patches.mjs` (211 рядків):
//!   - **nodeSelector** patch на `Deployment` (preem: false);
//!   - **HTTPRoute** patch (hostnames, parentRefs namespace, backendRefs namespace).
//!
//! Regex-и, бо `patch:` — YAML-string з вкладеним JSON6902, який не парситься
//! вдруге; підрядки на кшталт `path: /spec/hostnames` і `value: ua` достатньо
//! інформативні (той самий підхід, що й в оригіналі).

use std::sync::LazyLock;

use regex::Regex;

use super::abie_yaml::{parse_all_documents, strip_bom_and_modeline};

static PATCH_NODE_SELECTOR_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"path:\s*/spec/template/spec/nodeSelector\b").expect("valid regex")
});
static PATCH_PREEM_FALSE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bpreem:\s*['"]?false['"]?\b"#).expect("valid regex"));
static PATCH_HOSTNAMES_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"path:\s*/spec/hostnames\b").expect("valid regex"));
// Overlay namespaces: дозволено `ua` і `ua-*` (наприклад `ua-b2b`). `(?i)` —
// порт `i`-флагу оригіналу (case-insensitive на весь патерн, включно з
// символьними класами — той самий ефект, що й у JS).
static PATCH_PARENT_REF_NS_UA_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)path:\s*/spec/parentRefs/0/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)"#)
        .expect("valid regex")
});
static BACKEND_REF_NS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)path:\s*/spec/rules/\d+/backendRefs/\d+/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)"#)
        .expect("valid regex")
});

/// Домени `hostnames` для overlay `ua` (підрядки у JSON6902-тексті patch) —
/// точний порт `ABIE_UA_HTTPROUTE_HOST_MARKERS` (`kustomization-patches.mjs:21`).
const ABIE_UA_HTTPROUTE_HOST_MARKERS: &[&str] = &[
    "abie.app",
    "vybeerai.com.ua",
    "*.abie.app",
    "*.vybeerai.com.ua",
];

// ── nodeSelector (ua) ───────────────────────────────────────────────────

fn json_patch_text_has_ua_deployment_node_selector(patch_text: &str) -> bool {
    if patch_text.trim().is_empty() {
        return false;
    }
    if !PATCH_NODE_SELECTOR_PATH_RE.is_match(patch_text) {
        return false;
    }
    PATCH_PREEM_FALSE_RE.is_match(patch_text)
}

fn inline_kustomization_patch_matches_abie_mode(p: &serde_json::Value, mode: &str) -> bool {
    let Some(obj) = p.as_object() else {
        return false;
    };
    let Some(target) = obj.get("target").and_then(|t| t.as_object()) else {
        return false;
    };
    if target.get("kind").and_then(|k| k.as_str()) != Some("Deployment") {
        return false;
    }
    let Some(patch_str) = obj.get("patch").and_then(|v| v.as_str()) else {
        return false;
    };
    mode == "ua" && json_patch_text_has_ua_deployment_node_selector(patch_str)
}

fn kustomization_document_has_abie_deployment_node_selector_patch(
    doc: &serde_json::Value,
    mode: &str,
) -> bool {
    let Some(obj) = doc.as_object() else {
        return false;
    };
    if obj.get("kind").and_then(|k| k.as_str()) != Some("Kustomization") {
        return false;
    }
    let Some(patches) = obj.get("patches").and_then(|p| p.as_array()) else {
        return false;
    };
    patches
        .iter()
        .any(|p| inline_kustomization_patch_matches_abie_mode(p, mode))
}

/// Чи `kustomization.yaml` містить валідні inline patch для Deployment
/// nodeSelector (ua) — точний порт `kustomizationHasAbieDeploymentNodeSelectorPatch`
/// (`kustomization-patches.mjs:80-96`).
pub(crate) fn kustomization_has_abie_deployment_node_selector_patch(raw: &str, mode: &str) -> bool {
    let rest = strip_bom_and_modeline(raw);
    parse_all_documents(&rest)
        .iter()
        .any(|doc| kustomization_document_has_abie_deployment_node_selector_patch(doc, mode))
}

// ── HTTPRoute (ua) ───────────────────────────────────────────────────────

fn extract_http_route_patch_string(p: &serde_json::Value) -> Option<String> {
    let obj = p.as_object()?;
    let target = obj.get("target")?.as_object()?;
    if target.get("kind").and_then(|k| k.as_str()) != Some("HTTPRoute") {
        return None;
    }
    let name = target.get("name").and_then(|n| n.as_str())?;
    if name.trim().is_empty() {
        return None;
    }
    let patch_str = obj.get("patch").and_then(|v| v.as_str())?;
    if patch_str.trim().is_empty() {
        None
    } else {
        Some(patch_str.to_string())
    }
}

fn collect_abie_http_route_patch_strings_from_kustomization_doc(
    doc: &serde_json::Value,
) -> Vec<String> {
    let Some(obj) = doc.as_object() else {
        return Vec::new();
    };
    if obj.get("kind").and_then(|k| k.as_str()) != Some("Kustomization") {
        return Vec::new();
    }
    let Some(patches) = obj.get("patches").and_then(|p| p.as_array()) else {
        return Vec::new();
    };
    patches
        .iter()
        .filter_map(extract_http_route_patch_string)
        .collect()
}

/// Збирає всі inline JSON6902-фрагменти HTTPRoute (непорожній `target.name`)
/// у kustomization.yaml — точний порт `getCombinedNginxRunPatchTextFromKustomization`
/// (`kustomization-patches.mjs:140-158`).
pub(crate) fn get_combined_nginx_run_patch_text_from_kustomization(raw: &str) -> String {
    let rest = strip_bom_and_modeline(raw);
    let chunks: Vec<String> = parse_all_documents(&rest)
        .iter()
        .flat_map(collect_abie_http_route_patch_strings_from_kustomization_doc)
        .collect();
    chunks.join("\n")
}

fn count_abie_http_route_backend_ref_namespace_patches_in_combined(
    combined: &str,
    mode: &str,
) -> usize {
    if mode != "ua" {
        return 0;
    }
    BACKEND_REF_NS_RE.find_iter(combined).count()
}

/// Перевіряє сукупний текст patch(ів) HTTPRoute на відповідність abie.mdc —
/// точний порт `validateAbieNginxRunHttpRoutePatches` (`kustomization-patches.mjs:181-211`).
/// `shared_cross_ns_backend_ref_count` — беззнаковий (на відміну від JS
/// `Math.max(0, Math.floor(...))` NaN-guard, тут неможливе від'ємне/нецілісне
/// значення за конструкцією типу — Rust-типізація вже гарантує інваріант,
/// який JS перевіряв уручну).
pub(crate) fn validate_abie_nginx_run_http_route_patches(
    combined: &str,
    mode: &str,
    shared_cross_ns_backend_ref_count: usize,
) -> Option<String> {
    if combined.trim().is_empty() {
        return Some(format!(
            "очікується patch target kind HTTPRoute з непорожнім target.name (hostnames, parentRefs namespace {mode}) — abie.mdc"
        ));
    }
    if !PATCH_HOSTNAMES_PATH_RE.is_match(combined) {
        return Some("HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)".to_string());
    }
    if ABIE_UA_HTTPROUTE_HOST_MARKERS
        .iter()
        .all(|m| !combined.contains(m))
    {
        return Some(format!(
            "HTTPRoute: у value для /spec/hostnames має бути один із доменів abie ({}) — abie.mdc",
            ABIE_UA_HTTPROUTE_HOST_MARKERS.join(", ")
        ));
    }
    if !PATCH_PARENT_REF_NS_UA_RE.is_match(combined) {
        return Some(format!(
            "HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value {mode} (abie.mdc)"
        ));
    }
    if shared_cross_ns_backend_ref_count > 0 {
        let patch_hits =
            count_abie_http_route_backend_ref_namespace_patches_in_combined(combined, mode);
        if patch_hits < shared_cross_ns_backend_ref_count {
            return Some(format!(
                "HTTPRoute: для backendRefs до спільних сервісів auth-run-hl, file-link-hl очікується {shared_cross_ns_backend_ref_count} JSON6902 patch(ів) з path /spec/rules/…/backendRefs/…/namespace та value {mode} (зараз {patch_hits}) — abie.mdc"
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const UA_KUSTOMIZATION_NODE_SELECTOR_PATCH: &str = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\npatches:\n  - target:\n      kind: Deployment\n      name: x\n    patch: |-\n      - op: add\n        path: /spec/template/spec/nodeSelector\n        value:\n          preem: 'false'\n";

    const UA_KUSTOMIZATION_HTTPROUTE: &str = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\npatches:\n  - target:\n      kind: HTTPRoute\n      name: my-httproute\n    patch: |-\n      - op: replace\n        path: /spec/hostnames\n        value:\n          - \"abie.app\"\n      - op: replace\n        path: /spec/parentRefs/0/namespace\n        value: ua\n";

    // --- дзеркало lib/tests/kustomization-patches.test.mjs ---

    #[test]
    fn node_selector_patch_ua_detected() {
        assert!(kustomization_has_abie_deployment_node_selector_patch(
            UA_KUSTOMIZATION_NODE_SELECTOR_PATCH,
            "ua"
        ));
    }

    #[test]
    fn node_selector_patch_op_replace_also_matches() {
        let ua_replace = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace("op: add", "op: replace");
        assert!(kustomization_has_abie_deployment_node_selector_patch(
            &ua_replace,
            "ua"
        ));
    }

    #[test]
    fn node_selector_patch_without_preem_false_is_rejected() {
        let bad = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace("preem: 'false'", "preem: 'true'");
        assert!(!kustomization_has_abie_deployment_node_selector_patch(
            &bad, "ua"
        ));
    }

    #[test]
    fn combined_patch_text_collects_httproute_with_any_target_name() {
        let joined =
            get_combined_nginx_run_patch_text_from_kustomization(UA_KUSTOMIZATION_HTTPROUTE);
        assert!(joined.contains("/spec/hostnames"));
        assert!(joined.contains("abie.app"));
    }

    #[test]
    fn combined_patch_text_skips_httproute_without_target_name() {
        let raw = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\npatches:\n  - target:\n      kind: HTTPRoute\n    patch: |-\n      - op: replace\n        path: /spec/hostnames\n        value:\n          - \"abie.app\"\n";
        assert_eq!(
            get_combined_nginx_run_patch_text_from_kustomization(raw).trim(),
            ""
        );
    }

    #[test]
    fn validate_http_route_patches_ua_no_errors() {
        let combined =
            get_combined_nginx_run_patch_text_from_kustomization(UA_KUSTOMIZATION_HTTPROUTE);
        assert!(validate_abie_nginx_run_http_route_patches(&combined, "ua", 0).is_none());
    }

    #[test]
    fn validate_http_route_patches_ua_b2b_also_valid() {
        let ua_b2b = UA_KUSTOMIZATION_HTTPROUTE
            .replace("\n        value: ua\n", "\n        value: ua-b2b\n");
        let combined = get_combined_nginx_run_patch_text_from_kustomization(&ua_b2b);
        assert!(validate_abie_nginx_run_http_route_patches(&combined, "ua", 0).is_none());
    }

    #[test]
    fn validate_http_route_patches_shared_ref_count_without_patch_is_error() {
        let combined =
            get_combined_nginx_run_patch_text_from_kustomization(UA_KUSTOMIZATION_HTTPROUTE);
        let err = validate_abie_nginx_run_http_route_patches(&combined, "ua", 1).unwrap();
        assert!(err.contains("auth-run-hl"));
    }

    #[test]
    fn validate_http_route_patches_shared_ref_count_with_patch_is_ok() {
        let raw = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\npatches:\n  - target:\n      kind: HTTPRoute\n      name: my-httproute\n    patch: |-\n      - op: replace\n        path: /spec/hostnames\n        value:\n          - \"abie.app\"\n      - op: replace\n        path: /spec/parentRefs/0/namespace\n        value: ua\n      - op: replace\n        path: /spec/rules/0/backendRefs/0/namespace\n        value: ua-b2b\n";
        let combined = get_combined_nginx_run_patch_text_from_kustomization(raw);
        assert!(validate_abie_nginx_run_http_route_patches(&combined, "ua", 1).is_none());
    }
}
