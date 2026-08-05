//! Оркестратор native-концерну `k8s/manifests` — точний порядок кроків
//! `lint(ctx)` (`npm/rules/k8s/manifests/main.mjs:6539-6615`).
//!
//! Сам по собі модуль логіки не має: вся вона живе у портованих шарах, які
//! збиралися по одному трьома зрізами міграції (#393, #401 і цей).
//!
//! # Чому концерн ще не в [`super::NATIVE_CONCERNS`]
//!
//! Гейт `npm/tests/check-mjs-contract.test.mjs` забороняє native-концерну
//! мати `main.mjs` («подвійна реалізація», Р1 спеки), тож заведення в реєстр
//! і видалення JS-канону — **один неподільний крок**. Він упирається не в
//! `lint()` (він тут повністю портований), а у fix-поверхню:
//! `fix-manifests.mjs` імпортує з `main.mjs` девʼять символів, а сам редагує
//! YAML через Document API пакета `yaml`, **зберігаючи коментарі**, чого
//! `serde_yaml` не вміє. Тобто наступний крок — рішення про
//! comment-preserving YAML у Rust, а не механічний порт.
//!
//! До того моменту цей модуль лишається зібраною й покритою тестами точкою
//! входу: увімкнення — один рядок у [`super::NATIVE_CONCERNS`] і один у
//! [`super::run_concern`].
//!
//! | Крок `lint()` | Native |
//! |---|---|
//! | `runKubescape` | [`super::k8s_manifests_kubescape::kubescape_violations`] |
//! | `findK8sYamlFiles` | [`super::k8s_common::find_k8s_yaml_files`] |
//! | `assertNoForbiddenK8sDevPaths` | [`super::k8s_manifests_cross_file::assert_no_forbidden_k8s_dev_paths`] |
//! | `detectGatewayHttpRouteV1beta1InK8sYamlFiles` | [`super::k8s_manifests_per_file::detect_gateway_http_route_v1beta1`] |
//! | `detectBatchV1beta1InK8sYamlFiles` | [`super::k8s_manifests_per_file::detect_batch_v1beta1`] |
//! | `runAllK8sRego` | [`super::k8s_manifests_rego::run_all_k8s_rego`] |
//! | цикл `checkK8sYamlFile` | [`super::k8s_manifests_per_file::check_k8s_yaml_files`] |
//! | `validateSvcYamlAndSvcHlPairs` | [`super::k8s_manifests_cross_file::validate_svc_yaml_and_svc_hl_pairs`] |
//! | `validateKustomizationIncludesSvcHlWithSvc` | [`super::k8s_manifests_cross_file::validate_kustomization_includes_svc_hl_with_svc`] |
//! | `validateKustomizationPathRefsExistOnDisk` | [`super::k8s_manifests_cross_file::validate_kustomization_path_refs_exist_on_disk`] |
//! | `validateKustomizationPatchTargetsResolved` | [`super::k8s_manifests_kustomize::validate_kustomization_patch_targets_resolved`] |
//! | `validateKustomizeHpaPdbOnlyWithBaseDeployment` | [`super::k8s_manifests_kustomize::validate_kustomize_hpa_pdb_only_with_base_deployment`] |
//! | `validateConfigMapNameMatchesDeployment` | [`super::k8s_manifests_cross_file::validate_configmap_name_matches_deployment`] |
//! | `validateDeploymentHpaPdbAndTopology` | [`super::k8s_manifests_workloads::validate_deployment_hpa_pdb_and_topology`] |
//! | `validateNetworkPoliciesForK8sWorkloads` | [`super::k8s_manifests_workloads::validate_network_policies_for_k8s_workloads`] |
//! | `validateProdKustomizationOverrides` | [`super::k8s_manifests_kustomize::validate_prod_kustomization_overrides`] |
//! | `validateHasuraOverlayEnabledApisOverride` | [`super::k8s_manifests_kustomize::validate_hasura_overlay_enabled_apis_override`] |
//! | `validateHasuraOverlayEnabledLogTypesOverride` | [`super::k8s_manifests_kustomize::validate_hasura_overlay_enabled_log_types_override`] |
//!
//! # `pass(...)` не переїжджає
//!
//! Канон, крім порушень, друкує інформаційні `pass(...)`-рядки («YAML у k8s:
//! N файл(ів)», «Rego-полісі виконано на N файл(ах)» тощо). Контракт
//! [`super::run_concern`] має лише список violations — жоден із 29 попередніх
//! native-концернів `pass` не проводить, і цей теж не проводить.
//!
//! # `ctx.files` ігнорується
//!
//! `concern.json` концерну — `"lint": { "scope": "full" }`, тобто дельта-
//! списку він не отримує взагалі; вибірка завжди рахується від `cwd`.

use std::path::Path;

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_yaml_files;
use crate::concerns::k8s_manifests_cross_file::{
    assert_no_forbidden_k8s_dev_paths, validate_configmap_name_matches_deployment,
    validate_kustomization_includes_svc_hl_with_svc,
    validate_kustomization_path_refs_exist_on_disk, validate_svc_yaml_and_svc_hl_pairs,
};
use crate::concerns::k8s_manifests_kubescape::kubescape_violations;
use crate::concerns::k8s_manifests_kustomize::{
    validate_hasura_overlay_enabled_apis_override,
    validate_hasura_overlay_enabled_log_types_override,
    validate_kustomization_patch_targets_resolved,
    validate_kustomize_hpa_pdb_only_with_base_deployment, validate_prod_kustomization_overrides,
};
use crate::concerns::k8s_manifests_per_file::{
    check_k8s_yaml_files, detect_batch_v1beta1, detect_gateway_http_route_v1beta1,
};
use crate::concerns::k8s_manifests_rego::run_all_k8s_rego;
use crate::concerns::k8s_manifests_workloads::{
    validate_deployment_hpa_pdb_and_topology, validate_network_policies_for_k8s_workloads,
};
use crate::diagnostics::Violation;
use crate::RulesError;

/// Detector `k8s/manifests` — порт `lint(ctx)` (`main.mjs:6539-6615`).
pub fn k8s_manifests(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let mut out = kubescape_violations(cwd)?;

    let ignore_paths = load_cursor_ignore_paths(cwd);
    let yaml_files = find_k8s_yaml_files(cwd, &ignore_paths);
    if yaml_files.is_empty() {
        // `pass('Немає *.yaml під k8s — перевірку $schema пропущено')`.
        return Ok(out);
    }

    out.extend(assert_no_forbidden_k8s_dev_paths(cwd, &yaml_files));
    out.extend(detect_gateway_http_route_v1beta1(cwd, &yaml_files));
    out.extend(detect_batch_v1beta1(cwd, &yaml_files));
    out.extend(run_all_k8s_rego(cwd, &yaml_files)?);
    out.extend(check_k8s_yaml_files(cwd, &yaml_files));
    out.extend(validate_svc_yaml_and_svc_hl_pairs(cwd, &yaml_files));
    out.extend(validate_kustomization_includes_svc_hl_with_svc(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_kustomization_path_refs_exist_on_disk(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_kustomization_patch_targets_resolved(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_kustomize_hpa_pdb_only_with_base_deployment(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_configmap_name_matches_deployment(cwd, &yaml_files));
    out.extend(validate_deployment_hpa_pdb_and_topology(cwd, &yaml_files));
    out.extend(validate_network_policies_for_k8s_workloads(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_prod_kustomization_overrides(cwd, &yaml_files));
    out.extend(validate_hasura_overlay_enabled_apis_override(
        cwd,
        &yaml_files,
    ));
    out.extend(validate_hasura_overlay_enabled_log_types_override(
        cwd,
        &yaml_files,
    ));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    /// Репо без жодного `k8s`-каталогу не смикає ані kubescape, ані conftest —
    /// інакше результат тесту залежав би від того, що встановлено на машині.
    #[test]
    fn repo_without_k8s_tree_is_clean_without_spawning_tools() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("readme.md"), "x").unwrap();
        assert!(k8s_manifests(tmp.path()).unwrap().is_empty());
    }
}
