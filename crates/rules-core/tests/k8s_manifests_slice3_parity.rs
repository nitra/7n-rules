//! Parity-гейт **зрізу 3** концерну `k8s/manifests`: kustomize-резолюція з
//! пʼятьма залежними `validate*`
//! ([`rules_core::concerns::k8s_manifests_kustomize`]) і два детектори
//! застарілих `apiVersion`
//! ([`rules_core::concerns::k8s_manifests_per_file`]) проганяються на тих
//! самих фікстурах, що й JS-канон (`npm/rules/k8s/manifests/main.mjs` у
//! дочірньому `node`), а списки повідомлень звіряються посимвольно і в тому
//! самому порядку.
//!
//! Схема та сама, що в `k8s_manifests_parity.rs` (зріз 1) і
//! `k8s_manifests_slice2_parity.rs` (зріз 2) — спільна обвʼязка живе в
//! `tests/common/mod.rs`.
//!
//! # Чому детектори `apiVersion` тут, а не в зрізі 2
//!
//! Їх обидва **пропустили** попередні інвентаризації: реєстр
//! (`docs/plans/2026-08-05-open-questions-register.md` §5.1) називав два
//! шари, що лишились, а насправді їх було три. Порт заодно полагодив дефект
//! канону, через який жоден із детекторів не спрацьовував (секція
//! «Полагоджений дефект канону» в доккоменті
//! [`rules_core::concerns::k8s_manifests_per_file`]), тож саме на них гейт
//! показує **нову** спільну поведінку, а не збережену.
//!
//! Без `node` у PATH або без `node_modules` у корені репо тест пропускається.
//!
//! # Канон живе у фікстурі, а не в дочірньому `node`
//!
//! JS-оригінал видалено разом із заведенням концерну в `NATIVE_CONCERNS`,
//! тож звірятися напряму більше нема з чим. Фікстура
//! (`fixtures/js-k8s-parity.json`) — його ЗБЕРЕЖЕНИЙ вихід на цих самих
//! сценаріях: та сама сила перевірки, лише без спавна. Перезняти можна,
//! повернувши `main.mjs` з історії й прогнавши з
//! `N_K8S_PARITY_CAPTURE=<тека>`.

mod common;

use std::path::{Path, PathBuf};

use rules_core::concerns::k8s_manifests_kustomize::{
    validate_hasura_overlay_enabled_apis_override,
    validate_hasura_overlay_enabled_log_types_override,
    validate_kustomization_patch_targets_resolved,
    validate_kustomize_hpa_pdb_only_with_base_deployment, validate_prod_kustomization_overrides,
};
use rules_core::concerns::k8s_manifests_per_file::{
    detect_batch_v1beta1, detect_gateway_http_route_v1beta1,
};
use tempfile::TempDir;

use common::write;

/// Драйвер JS-боку: ті самі сім кроків у тому самому порядку, що й у `lint()`.
const JS_DRIVER: &str = r#"import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [root, modulePath, filesJson] = process.argv.slice(2)
const canon = await import(pathToFileURL(modulePath).href)
const files = JSON.parse(await readFile(filesJson, 'utf8'))
const out = []
const fail = msg => {
  out.push(msg)
}
const pass = () => {}

await canon.detectGatewayHttpRouteV1beta1InK8sYamlFiles(files, root, fail)
await canon.detectBatchV1beta1InK8sYamlFiles(files, root, fail)
await canon.validateKustomizationPatchTargetsResolved(root, files, fail)
await canon.validateKustomizeHpaPdbOnlyWithBaseDeployment(root, files, fail, pass)
await canon.validateProdKustomizationOverrides(root, files, fail, pass)
await canon.validateHasuraOverlayEnabledApisOverride(root, files, fail, pass)
await canon.validateHasuraOverlayEnabledLogTypesOverride(root, files, fail, pass)

process.stdout.write(JSON.stringify(out))
"#;

/// Повідомлення native-боку — ті самі сім кроків у порядку виклику з `lint()`.
fn native_messages(root: &Path, files: &[PathBuf]) -> Vec<String> {
    let mut out = Vec::new();
    out.extend(detect_gateway_http_route_v1beta1(root, files));
    out.extend(detect_batch_v1beta1(root, files));
    out.extend(validate_kustomization_patch_targets_resolved(root, files));
    out.extend(validate_kustomize_hpa_pdb_only_with_base_deployment(
        root, files,
    ));
    out.extend(validate_prod_kustomization_overrides(root, files));
    out.extend(validate_hasura_overlay_enabled_apis_override(root, files));
    out.extend(validate_hasura_overlay_enabled_log_types_override(
        root, files,
    ));
    out.into_iter().map(|v| v.message).collect()
}

/// Звіряє native і JS на дереві, зібраному `build`.
fn assert_parity(label: &str, build: impl Fn(&TempDir)) {
    common::assert_parity(
        "k8s_manifests_slice3_parity",
        label,
        JS_DRIVER,
        native_messages,
        build,
    );
}

/// Канонічний Deployment без HPA/PDB поруч.
fn deployment(name: &str) -> String {
    format!(
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  selector:\n    \
         matchLabels:\n      app: {name}\n  template:\n    metadata:\n      labels:\n        app: \
         {name}\n    spec:\n      containers:\n        - name: app\n          image: repo/app:1\n"
    )
}

/// Hasura-Deployment (маркер — образ `hasura/graphql-engine`).
fn hasura_deployment(name: &str) -> String {
    format!(
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  selector:\n    \
         matchLabels:\n      app: {name}\n  template:\n    metadata:\n      labels:\n        app: \
         {name}\n    spec:\n      containers:\n        - name: hasura\n          image: \
         hasura/graphql-engine:v2.40.0\n"
    )
}

/// HPA для Component-каталогу.
fn hpa(name: &str) -> String {
    format!(
        "apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: \
         {name}\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: \
         {name}\n  minReplicas: 1\n  maxReplicas: 1\n"
    )
}

/// PDB для Component-каталогу.
fn pdb(name: &str) -> String {
    format!(
        "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: {name}\nspec:\n  \
         minAvailable: 0\n  selector:\n    matchLabels:\n      app: {name}\n"
    )
}

/// Base-kustomization із переліком ресурсів.
fn base_kustomization(resources: &[&str]) -> String {
    let list = resources
        .iter()
        .map(|r| format!("  - {r}\n"))
        .collect::<String>();
    format!(
        "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
         dev\nresources:\n{list}"
    )
}

// ─── detect* (полагоджений дефект канону) ────────────────────────────────────

#[test]
fn deprecated_batch_api_version_is_reported_on_a_real_manifest() {
    assert_parity("batch-v1beta1", |tmp| {
        write(
            tmp,
            "svc/k8s/base/cronjob.yaml",
            "apiVersion: batch/v1beta1\nkind: CronJob\nmetadata:\n  name: nightly\nspec:\n  \
             schedule: '0 1 * * *'\n",
        );
    });
}

#[test]
fn deprecated_batch_api_version_in_quotes_and_with_indent_is_reported() {
    assert_parity("batch-v1beta1-quoted", |tmp| {
        write(
            tmp,
            "svc/k8s/base/job.yaml",
            "kind: Job\napiVersion: \"batch/v1beta1\"\nmetadata:\n  name: migrate\n",
        );
    });
}

#[test]
fn commented_out_deprecated_api_version_is_not_reported() {
    assert_parity("clean-batch-comment", |tmp| {
        write(
            tmp,
            "svc/k8s/base/job.yaml",
            "# apiVersion: batch/v1beta1\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: m\n",
        );
    });
}

#[test]
fn deprecated_gateway_api_version_needs_http_route_kind() {
    assert_parity("gateway-v1beta1", |tmp| {
        write(
            tmp,
            "svc/k8s/base/httproute.yaml",
            "apiVersion: gateway.networking.k8s.io/v1beta1\nkind: HTTPRoute\nmetadata:\n  name: \
             api\n",
        );
        // Той самий застарілий apiVersion, але без `kind: HTTPRoute` — канон
        // мовчить, і порт теж.
        write(
            tmp,
            "svc/k8s/base/tcp-route.yaml",
            "apiVersion: gateway.networking.k8s.io/v1beta1\nkind: TCPRoute\nmetadata:\n  name: \
             tcp\n",
        );
    });
}

// ─── validateKustomizationPatchTargetsResolved ───────────────────────────────

#[test]
fn patch_target_missing_from_catalog_is_reported() {
    assert_parity("patch-target-missing", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             dev\nresources:\n  - deploy.yaml\npatches:\n  - target:\n      kind: StatefulSet\n      \
             name: ghost\n    patch: |\n      - op: replace\n        path: /spec/replicas\n        \
             value: 2\n",
        );
    });
}

#[test]
fn redundant_group_and_version_in_patch_target_are_reported() {
    assert_parity("patch-target-redundant-gv", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             dev\nresources:\n  - deploy.yaml\npatches:\n  - target:\n      group: apps\n      \
             version: v1\n      kind: Deployment\n      name: api\n    patch: |\n      - op: \
             replace\n        path: /spec/replicas\n        value: 2\n",
        );
    });
}

#[test]
fn strategic_merge_file_outside_catalog_is_reported() {
    assert_parity("strategic-merge-missing", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/patch.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: other\n",
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             dev\nresources:\n  - deploy.yaml\npatchesStrategicMerge:\n  - patch.yaml\n",
        );
    });
}

#[test]
fn path_only_patch_is_checked_against_the_catalog() {
    assert_parity("path-only-patch-missing", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/only-path.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nowhere\n",
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             dev\nresources:\n  - deploy.yaml\npatches:\n  - path: only-path.yaml\n",
        );
    });
}

#[test]
fn nested_kustomization_tree_feeds_the_catalog() {
    assert_parity("clean-nested-catalog", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        // Overlay бачить Deployment лише через рекурсію в base.
        write(
            tmp,
            "svc/k8s/prod/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             prod\nresources:\n  - ../base\npatches:\n  - target:\n      kind: Deployment\n      \
             name: api\n    patch: |\n      - op: replace\n        path: /spec/replicas\n        \
             value: 3\n",
        );
    });
}

// ─── validateKustomizeHpaPdbOnlyWithBaseDeployment ───────────────────────────

#[test]
fn hpa_inside_base_tree_is_forbidden() {
    assert_parity("base-tree-has-hpa", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(tmp, "svc/k8s/base/hpa.yaml", &hpa("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml", "hpa.yaml"]),
        );
    });
}

#[test]
fn overlay_hpa_without_deployment_in_base_is_reported() {
    assert_parity("overlay-hpa-no-base-deployment", |tmp| {
        write(
            tmp,
            "svc/k8s/base/cm.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: api\ndata:\n  A: b\n",
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["cm.yaml"]),
        );
        write(tmp, "svc/k8s/stage/hpa.yaml", &hpa("api"));
        write(
            tmp,
            "svc/k8s/stage/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             stage\nresources:\n  - ../base\n  - hpa.yaml\n",
        );
    });
}

// ─── validateProdKustomizationOverrides ──────────────────────────────────────

#[test]
fn prod_overlay_without_hpa_and_pdb_patches_is_reported() {
    assert_parity("prod-overrides-missing", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        write(tmp, "svc/k8s/components/hpa.yaml", &hpa("api"));
        write(tmp, "svc/k8s/components/pdb.yaml", &pdb("api"));
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - \
             hpa.yaml\n  - pdb.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/prod/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             prod\nresources:\n  - ../base\ncomponents:\n  - ../components\n",
        );
    });
}

#[test]
fn prod_overlay_with_all_three_patches_is_clean() {
    assert_parity("clean-prod-overrides", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        write(tmp, "svc/k8s/components/hpa.yaml", &hpa("api"));
        write(tmp, "svc/k8s/components/pdb.yaml", &pdb("api"));
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - \
             hpa.yaml\n  - pdb.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/prod/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             prod\nresources:\n  - ../base\ncomponents:\n  - ../components\npatches:\n  - target:\n      \
             kind: HorizontalPodAutoscaler\n      name: api\n    patch: |\n      - op: replace\n        \
             path: /spec/minReplicas\n        value: 2\n      - op: replace\n        path: \
             /spec/maxReplicas\n        value: 5\n  - target:\n      kind: PodDisruptionBudget\n      \
             name: api\n    patch: |\n      - op: replace\n        path: /spec/minAvailable\n        \
             value: 1\n",
        );
    });
}

#[test]
fn dev_like_overlay_needs_no_prod_overrides() {
    assert_parity("clean-dev-like-overlay", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        write(tmp, "svc/k8s/components/hpa.yaml", &hpa("api"));
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - \
             hpa.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/tr-qa/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             qa\nresources:\n  - ../base\ncomponents:\n  - ../components\n",
        );
    });
}

#[test]
fn strategic_merge_patch_counts_as_an_override() {
    assert_parity("prod-overrides-strategic-merge", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        write(tmp, "svc/k8s/components/hpa.yaml", &hpa("api"));
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - \
             hpa.yaml\n",
        );
        // Strategic-merge без `target` — `kind` береться з тіла патчу, і
        // покрито лише `minReplicas`, тож `maxReplicas` лишається порушенням.
        write(
            tmp,
            "svc/k8s/prod/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             prod\nresources:\n  - ../base\ncomponents:\n  - ../components\npatches:\n  - patch: |\n      \
             apiVersion: autoscaling/v2\n      kind: HorizontalPodAutoscaler\n      metadata:\n        \
             name: api\n      spec:\n        minReplicas: 2\n",
        );
    });
}

// ─── Hasura-overlay overrides ────────────────────────────────────────────────

/// Дерево «Hasura-base + один overlay `prod`»: сам overlay різниться лише
/// вмістом `patches[]`, тож три фікстури нижче ділять усе інше.
fn write_hasura_base_and_prod_overlay(tmp: &TempDir, prod_patches: &str) {
    write(
        tmp,
        "svc/k8s/base/deploy.yaml",
        &hasura_deployment("hasura"),
    );
    write(
        tmp,
        "svc/k8s/base/kustomization.yaml",
        &base_kustomization(&["deploy.yaml"]),
    );
    write(
        tmp,
        "svc/k8s/prod/kustomization.yaml",
        &format!(
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: \
             prod\nresources:\n  - ../base\n{prod_patches}"
        ),
    );
}

#[test]
fn hasura_overlay_without_both_overrides_is_reported() {
    assert_parity("hasura-overlay-missing-overrides", |tmp| {
        write_hasura_base_and_prod_overlay(tmp, "");
    });
}

#[test]
fn hasura_overlay_with_wrong_values_reports_current_value() {
    assert_parity("hasura-overlay-wrong-values", |tmp| {
        // Перший patch — JSON6902 із неканонічним значенням, другий —
        // Strategic Merge: обидві форми читання значення під гейтом.
        write_hasura_base_and_prod_overlay(
            tmp,
            "patches:\n  - target:\n      kind: ConfigMap\n      name: hasura\n    patch: |\n      \
             - op: replace\n        path: /data/HASURA_GRAPHQL_ENABLED_APIS\n        value: \
             metadata\n  - target:\n      kind: ConfigMap\n      name: hasura\n    patch: |\n      \
             apiVersion: v1\n      kind: ConfigMap\n      metadata:\n        name: hasura\n      \
             data:\n        HASURA_GRAPHQL_ENABLED_LOG_TYPES: startup,http-log\n",
        );
    });
}

#[test]
fn hasura_overlay_with_canonical_overrides_is_clean() {
    assert_parity("clean-hasura-overlay", |tmp| {
        write_hasura_base_and_prod_overlay(
            tmp,
            "patches:\n  - target:\n      kind: ConfigMap\n      name: hasura\n    patch: |\n      \
             - op: replace\n        path: /data/HASURA_GRAPHQL_ENABLED_APIS\n        value: \
             metadata,graphql\n      - op: replace\n        path: \
             /data/HASURA_GRAPHQL_ENABLED_LOG_TYPES\n        value: startup\n",
        );
    });
}

#[test]
fn component_kustomization_is_not_treated_as_an_overlay() {
    assert_parity("clean-hasura-component", |tmp| {
        write(
            tmp,
            "svc/k8s/base/deploy.yaml",
            &hasura_deployment("hasura"),
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            &base_kustomization(&["deploy.yaml"]),
        );
        // `kind: Component` у non-dev сегменті — джерело ресурсів, не overlay.
        write(tmp, "svc/k8s/shared/hpa.yaml", &hpa("hasura"));
        write(
            tmp,
            "svc/k8s/shared/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - \
             ../base\n  - hpa.yaml\n",
        );
    });
}
