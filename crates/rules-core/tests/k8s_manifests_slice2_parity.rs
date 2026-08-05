//! Parity-гейт **зрізу 2** концерну `k8s/manifests`: per-file цикл
//! `checkK8sYamlFile` і дві великі самодостатні `validate*`
//! ([`rules_core::concerns::k8s_manifests_per_file`],
//! [`rules_core::concerns::k8s_manifests_workloads`]) проганяються на тих
//! самих фікстурах, що й JS-канон (`npm/rules/k8s/manifests/main.mjs` у
//! дочірньому `node`), а списки повідомлень звіряються посимвольно і в тому
//! самому порядку.
//!
//! Схема та сама, що в `k8s_manifests_parity.rs` (зріз 1), і з тієї ж
//! причини: `k8s/manifests` свідомо НЕ заведений у `NATIVE_CONCERNS` — він
//! неподільний для диспатчу і зайде туди, коли портовані всі чотири шари
//! його `lint()`. Тому шлях `runConcernDetector` недоступний, і паритет
//! доводиться «навпаки»: Rust-тест сам кличе JS.
//!
//! Список YAML-файлів рахує **Rust** ([`find_k8s_yaml_files`]) і передає в
//! node готовим — щоб гейт міряв рівно портовані шари, а не вже портований
//! раніше обхід дерева.
//!
//! Без `node` у PATH або без `node_modules` у корені репо тест пропускається.

use std::path::{Path, PathBuf};
use std::process::Command;

use rules_core::concerns::find_k8s_yaml_files;
use rules_core::concerns::k8s_manifests_per_file::check_k8s_yaml_files;
use rules_core::concerns::k8s_manifests_workloads::{
    validate_deployment_hpa_pdb_and_topology, validate_network_policies_for_k8s_workloads,
};
use tempfile::TempDir;

/// Драйвер JS-боку: ті самі три кроки у тому самому порядку, що й у `lint()`.
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

for (const abs of files) {
  await canon.checkK8sYamlFile(abs, root, fail, pass)
}
await canon.validateDeploymentHpaPdbAndTopology(root, files, fail, pass)
await canon.validateNetworkPoliciesForK8sWorkloads(root, files, fail, pass)

process.stdout.write(JSON.stringify(out))
"#;

/// Корінь репо: `<repo>/crates/rules-core` → два рівні вгору.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/rules-core лежить на два рівні під коренем репо")
        .to_path_buf()
}

/// Чи є все потрібне для JS-боку (інакше тест пропускається).
fn js_canon_available() -> bool {
    let root = repo_root();
    root.join("node_modules").is_dir()
        && root.join("npm/rules/k8s/manifests/main.mjs").is_file()
        && Command::new("node")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
}

/// Кладе файл із створенням батьківських каталогів.
fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    std::fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    std::fs::write(abs, content).expect("write");
}

/// Повідомлення native-боку — три кроки у порядку виклику з `lint()`.
fn native_messages(root: &Path, files: &[PathBuf]) -> Vec<String> {
    let mut out = Vec::new();
    out.extend(check_k8s_yaml_files(root, files));
    out.extend(validate_deployment_hpa_pdb_and_topology(root, files));
    out.extend(validate_network_policies_for_k8s_workloads(root, files));
    out.into_iter().map(|v| v.message).collect()
}

/// Повідомлення JS-канону на тому самому дереві й тому самому списку файлів.
fn js_messages(tmp: &TempDir, files: &[PathBuf]) -> Vec<String> {
    let root = tmp.path();
    let driver = root.join(".parity-driver.mjs");
    std::fs::write(&driver, JS_DRIVER).expect("write driver");
    let files_json = root.join(".parity-files.json");
    let payload: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    std::fs::write(
        &files_json,
        serde_json::to_string(&payload).expect("serialize"),
    )
    .expect("write files json");

    let canon = repo_root().join("npm/rules/k8s/manifests/main.mjs");
    let output = Command::new("node")
        .arg(&driver)
        .arg(root)
        .arg(&canon)
        .arg(&files_json)
        .output()
        .expect("спавн node");
    assert!(
        output.status.success(),
        "JS-канон впав: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout драйвера не JSON ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

/// Звіряє native і JS на дереві, зібраному `build`.
fn assert_parity(label: &str, build: impl Fn(&TempDir)) {
    if !js_canon_available() {
        eprintln!("k8s_manifests_slice2_parity[{label}]: пропуск — немає node/node_modules");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    build(&tmp);
    let files = find_k8s_yaml_files(tmp.path(), &[]);
    assert!(!files.is_empty(), "[{label}] фікстура без YAML під k8s");
    let native = native_messages(tmp.path(), &files);
    let js = js_messages(&tmp, &files);
    assert_eq!(native, js, "[{label}] розбіжність native ↔ JS");
    assert!(
        !native.is_empty() || label.starts_with("clean"),
        "[{label}] фікстура нічого не репортує — гейт був би порожній"
    );
}

/// Канонічний Deployment із `topologySpreadConstraints`.
fn deployment(name: &str) -> String {
    format!(
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  selector:\n    \
         matchLabels:\n      app: {name}\n  template:\n    metadata:\n      labels:\n        app: \
         {name}\n    spec:\n      topologySpreadConstraints:\n        - maxSkew: 1\n          \
         topologyKey: kubernetes.io/hostname\n          whenUnsatisfiable: ScheduleAnyway\n          \
         labelSelector:\n            matchLabels:\n              app: {name}\n      containers:\n        \
         - name: app\n          image: repo/app:1\n"
    )
}

/// Канонічний NetworkPolicy поруч із workload.
fn network_policy(name: &str) -> String {
    format!(
        "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: {name}\nspec:\n  \
         podSelector:\n    matchLabels:\n      app: {name}\n  policyTypes:\n    - Ingress\n"
    )
}

/// Канонічний dev-like HPA для Kustomize Component.
fn components_hpa(name: &str) -> String {
    format!(
        "apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: \
         {name}\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: \
         {name}\n  minReplicas: 1\n  maxReplicas: 1\n  metrics:\n    - type: Resource\n  behavior:\n    \
         scaleUp:\n      policies:\n        - type: Percent\n          value: 100\n          \
         periodSeconds: 15\n    scaleDown:\n      policies:\n        - type: Percent\n          value: \
         100\n          periodSeconds: 15\n"
    )
}

/// Канонічний dev-like PDB для Kustomize Component.
fn components_pdb(name: &str) -> String {
    format!(
        "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: {name}\nspec:\n  \
         minAvailable: 0\n  selector:\n    matchLabels:\n      app: {name}\n"
    )
}

/// Повний канонічний `components/` для `svc/k8s`.
fn write_components(tmp: &TempDir, name: &str) {
    write(
        tmp,
        "svc/k8s/components/kustomization.yaml",
        "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - hpa.yaml\n  \
         - pdb.yaml\n",
    );
    write(tmp, "svc/k8s/components/hpa.yaml", &components_hpa(name));
    write(tmp, "svc/k8s/components/pdb.yaml", &components_pdb(name));
}

/// Дерево, на якому всі три кроки мовчать з обох боків.
#[test]
fn clean_base_layer_is_silent_on_both_sides() {
    assert_parity("clean", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            &network_policy("api"),
        );
        write_components(tmp, "api");
    });
}

/// Коректні modeline `$schema` для core-v1, групового API і kustomization —
/// обидві реалізації мають однаково не сказати нічого про схеми.
#[test]
fn clean_modelines_match_expected_schema_urls() {
    assert_parity("clean-modelines", |tmp| {
        let yannh = "https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/";
        write(
            tmp,
            "svc/k8s/base/svc.yaml",
            &format!(
                "# yaml-language-server: $schema={yannh}service-v1.json\napiVersion: v1\nkind: \
                 Service\nmetadata:\n  name: api\n"
            ),
        );
        write(
            tmp,
            "svc/k8s/base/np.yaml",
            &format!(
                "# yaml-language-server: $schema={yannh}networkpolicy-networking-v1.json\n{}",
                network_policy("api")
            ),
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json\nkind: \
             Kustomization\nnamespace: dev\nresources:\n  - svc.yaml\n",
        );
    });
}

/// Розширення `.yml`, modeline не в першому рядку, два modeline, `file:` і
/// не-https — весь набір коротких замикань per-file циклу.
#[test]
fn modeline_short_circuits_match() {
    assert_parity("modeline-short-circuits", |tmp| {
        write(tmp, "svc/k8s/base/legacy.yml", "kind: Service\n");
        write(
            tmp,
            "svc/k8s/base/below.yaml",
            "apiVersion: v1\n# yaml-language-server: $schema=https://a.test/s.json\nkind: Service\n",
        );
        write(
            tmp,
            "svc/k8s/base/twice.yaml",
            "# yaml-language-server: $schema=https://a.test/s.json\n# yaml-language-server: \
             $schema=https://b.test/s.json\napiVersion: v1\nkind: Service\n",
        );
        write(
            tmp,
            "svc/k8s/base/file-scheme.yaml",
            "# yaml-language-server: $schema=file:///tmp/s.json\napiVersion: v1\nkind: Service\n",
        );
        write(
            tmp,
            "svc/k8s/base/http.yaml",
            "# yaml-language-server: $schema=http://a.test/s.json\napiVersion: v1\nkind: Service\n",
        );
    });
}

/// Неправильні URL схем: core v1, група yannh, CRD поза yannh, явна таблиця
/// і `apiVersion` без слеша.
#[test]
fn wrong_schema_urls_match() {
    assert_parity("wrong-schema-urls", |tmp| {
        write(
            tmp,
            "svc/k8s/base/svc.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\napiVersion: v1\nkind: \
             Service\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/deployment.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\napiVersion: apps/v1\nkind: \
             Deployment\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/route.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\napiVersion: \
             gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/secret.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\napiVersion: v1\nkind: \
             Secret\nmetadata:\n  name: api\ntype: kubernetes.io/basic-auth\n",
        );
        write(
            tmp,
            "svc/k8s/base/weird.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\napiVersion: weird\nkind: \
             Thing\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/no-kind.yaml",
            "# yaml-language-server: $schema=https://a.test/wrong.json\nmetadata:\n  name: api\n",
        );
    });
}

/// Виняток ALB Yandex: `HttpBackendGroup` не має мати modeline ні першим
/// рядком, ні нижче по файлу.
#[test]
fn alb_http_backend_group_exception_matches() {
    assert_parity("alb-http-backend-group", |tmp| {
        write(
            tmp,
            "svc/k8s/base/bg-first.yaml",
            "# yaml-language-server: $schema=https://a.test/s.json\napiVersion: \
             alb.yc.io/v1alpha1\nkind: HttpBackendGroup\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/bg-below.yaml",
            "apiVersion: alb.yc.io/v1alpha1\nkind: HttpBackendGroup\nmetadata:\n  name: api\n# \
             yaml-language-server: $schema=https://a.test/s.json\n",
        );
        write(
            tmp,
            "svc/k8s/base/bg-clean.yaml",
            "apiVersion: alb.yc.io/v1alpha1\nkind: HttpBackendGroup\nmetadata:\n  name: api\n",
        );
    });
}

/// Відсутній `components/`, локальні `hpa.yaml`/`pdb.yaml` у `base/` і
/// Deployment без мітки `app`.
#[test]
fn base_layer_components_contract_matches() {
    assert_parity("components-contract", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/hpa.yaml",
            "apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/pdb.yaml",
            "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            &network_policy("api"),
        );
    });
}

/// Каталог `components/` є, але його маніфест і файли зламані: не той
/// `apiVersion`/`kind`, порожні `resources`, прод-межі в dev-like шарі.
#[test]
fn broken_components_manifest_and_bounds_match() {
    assert_parity("components-broken", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            &network_policy("api"),
        );
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources: []\n",
        );
        write(
            tmp,
            "svc/k8s/components/hpa.yaml",
            "apiVersion: autoscaling/v1\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: \
             api\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v2\n    kind: StatefulSet\n    name: \
             api\n  minReplicas: 3\n  maxReplicas: 2\n  metrics: []\n  behavior:\n    scaleUp: {}\n",
        );
        write(
            tmp,
            "svc/k8s/components/pdb.yaml",
            "apiVersion: policy/v1beta1\nkind: PodDisruptionBudget\nmetadata:\n  name: api\nspec:\n  \
             minAvailable: 2\n  selector:\n    matchLabels:\n      app: other\n",
        );
    });
}

/// `components/hpa.yaml` і `components/pdb.yaml` відсутні як файли, а
/// `kustomization.yaml` про них усе одно заявляє.
#[test]
fn missing_components_files_match() {
    assert_parity("components-missing-files", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            &network_policy("api"),
        );
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - hpa.yaml\n  \
             - pdb.yaml\n",
        );
    });
}

/// Deployment без `metadata.name` і без мітки `app` — обидві гілки раннього
/// виходу `validateSingleDeploymentHpaPdbTopology`.
#[test]
fn deployment_without_name_or_app_label_matches() {
    assert_parity("deployment-degenerate", |tmp| {
        write(
            tmp,
            "svc/k8s/base/anon.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nspec:\n  selector:\n    matchLabels:\n      app: \
             api\n",
        );
        write(
            tmp,
            "svc/k8s/base/no-label.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    \
             spec:\n      containers: []\n",
        );
    });
}

/// NetworkPolicy: відсутній файл, розбіжність мітки, StatefulSet, Job і
/// CronJob (мітка з pod-template, не з селектора).
#[test]
fn network_policy_workload_kinds_match() {
    assert_parity("network-policy-kinds", |tmp| {
        write(tmp, "svc/k8s/base/deploy.yaml", &deployment("api"));
        write_components(tmp, "api");
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: api\nspec:\n  \
             podSelector:\n    matchLabels:\n      app: other\n",
        );
        write(
            tmp,
            "worker/k8s/base/sts.yaml",
            "apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: db\nspec:\n  selector:\n    \
             matchLabels:\n      app: db\n",
        );
        write(
            tmp,
            "worker/k8s/base/job.yaml",
            "apiVersion: batch/v1\nkind: Job\nmetadata:\n  name: seed\nspec:\n  template:\n    \
             metadata:\n      labels:\n        app: seed\n",
        );
        write(
            tmp,
            "worker/k8s/base/cron.yaml",
            "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: rotate\nspec:\n  jobTemplate:\n    \
             spec:\n      template:\n        metadata:\n          labels:\n            app: rotate\n",
        );
        write(
            tmp,
            "worker/k8s/base/no-label.yaml",
            "apiVersion: apps/v1\nkind: DaemonSet\nmetadata:\n  name: agent\nspec: {}\n",
        );
    });
}

/// Прод-overlay (`k8s/prod/…`) із Deployment: перша перевірка його зовсім не
/// бачить (фільтр `isK8sYamlUnderBaseDirectory`), друга — бачить.
#[test]
fn non_base_overlay_is_seen_only_by_network_policy_check() {
    assert_parity("non-base-overlay", |tmp| {
        write(tmp, "svc/k8s/prod/deploy.yaml", &deployment("api"));
    });
}

/// Кілька Deployment у одному каталозі й кілька файлів — злиття по каталогу
/// і порядок обходу.
#[test]
fn multiple_deployments_in_one_directory_match() {
    assert_parity("multi-deployment", |tmp| {
        write(
            tmp,
            "svc/k8s/base/a.yaml",
            &format!("{}---\n{}", deployment("alpha"), deployment("beta")),
        );
        write(tmp, "svc/k8s/base/z.yaml", &deployment("gamma"));
        write(
            tmp,
            "svc/k8s/base/networkpolicy.yaml",
            &format!(
                "{}---\n{}",
                network_policy("alpha"),
                network_policy("gamma")
            ),
        );
    });
}
