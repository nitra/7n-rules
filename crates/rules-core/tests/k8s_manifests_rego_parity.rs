//! End-to-end parity-гейт rego-шару `k8s/manifests`: native
//! [`run_all_k8s_rego`] і JS-канон `runAllK8sRego` проганяються на одному
//! дереві, з **реальними** rego-полісі пакета і **реальним** `conftest`, а
//! отримані violations звіряються повністю (reason, message, file, data).
//!
//! Це єдине місце, де перевіряється гілка `--data`/`templateData`
//! ([`rules_core::conftest::run_conftest_batch_with_data`]): namespace
//! `k8s.network_policy` віддає rego два NetworkPolicy-сніпети, і без них
//! полісі мовчить — тобто розбіжність у серіалізації `--data` була б видима
//! як зникле порушення.
//!
//! # Чому окремий бінарник тесту
//!
//! Native-бік резолвить корінь пакета через `N_RULES_PACKAGE_ROOT`, а `cwd`
//! фікстури — tmp-каталог поза репо, де каскад `rules_package` нічого не
//! знайде. `set_var` — процес-глобальний, тож тест живе у власному файлі
//! (`tests/*.rs` = окремий процес) і в ньому він єдиний.
//!
//! # Пропуск
//!
//! Без `conftest`, `node` чи `node_modules` тест пропускається — та сама
//! умова, що в `hasura-native-parity.test.mjs`.

use std::path::{Path, PathBuf};
use std::process::Command;

use rules_core::concerns::find_k8s_yaml_files;
use rules_core::concerns::k8s_manifests_rego::run_all_k8s_rego;
use tempfile::TempDir;

/// Драйвер JS-боку: збирає violations рівно тим репортером, який використовує
/// `lint()` концерну, і друкує їх JSON-масивом.
const JS_DRIVER: &str = r#"import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [root, modulePath, reporterPath, filesJson] = process.argv.slice(2)
const canon = await import(pathToFileURL(modulePath).href)
const { createViolationReporter } = await import(pathToFileURL(reporterPath).href)
const files = JSON.parse(await readFile(filesJson, 'utf8'))

const reporter = createViolationReporter({ concernId: 'manifests' })
await canon.runAllK8sRego(root, files, reporter.fail)
process.stdout.write(JSON.stringify(reporter.result().violations))
"#;

/// Порівнювана форма порушення — рівно ті поля, які будує
/// `createViolationReporter` (`severity` жодна зі сторін тут не виставляє).
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Reported {
    reason: String,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

/// Корінь репо: `<repo>/crates/rules-core` → два рівні вгору.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/rules-core лежить на два рівні під коренем репо")
        .to_path_buf()
}

/// Чи є бінарник у PATH.
fn which_ok(bin: &str) -> bool {
    Command::new(bin)
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Чи є все потрібне (інакше тест пропускається).
fn prerequisites_met() -> bool {
    let root = repo_root();
    root.join("node_modules").is_dir()
        && root.join("npm/rules/k8s/manifest").is_dir()
        && ["node", "conftest"].iter().all(|bin| which_ok(bin))
}

/// Кладе файл із створенням батьківських каталогів.
fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    std::fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    std::fs::write(abs, content).expect("write");
}

/// Violations JS-канону на тому самому дереві й списку файлів.
fn js_reported(tmp: &TempDir, files: &[PathBuf]) -> Vec<Reported> {
    let root = tmp.path();
    let driver = root.join(".rego-parity-driver.mjs");
    std::fs::write(&driver, JS_DRIVER).expect("write driver");
    let files_json = root.join(".rego-parity-files.json");
    let payload: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    std::fs::write(
        &files_json,
        serde_json::to_string(&payload).expect("serialize"),
    )
    .expect("write files json");

    let repo = repo_root();
    let output = Command::new("node")
        .arg(&driver)
        .arg(root)
        .arg(repo.join("npm/rules/k8s/manifests/main.mjs"))
        .arg(repo.join("npm/scripts/lib/lint-surface/violation-reporter.mjs"))
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

/// Дерево з навмисними порушеннями у кількох namespace-ах одразу — щоб гейт
/// міряв і склад порушень, і наскрізний порядок між батчами.
fn build_fixture(tmp: &TempDir) {
    // Deployment без `spec.strategy: RollingUpdate`, без `resources` і без
    // `topologySpreadConstraints` — namespace `k8s.manifest`.
    write(
        tmp,
        "svc/k8s/base/deployment.yaml",
        r"apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: dev
spec:
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: app
          image: repo/app:1
",
    );
    // svc.yaml без `spec.type: ClusterIP` — namespace `k8s.svc_yaml`.
    write(
        tmp,
        "svc/k8s/base/svc.yaml",
        r"apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: dev
spec:
  selector:
    app: api
  ports:
    - port: 80
",
    );
    // svc-hl.yaml без `spec.clusterIP: None` — namespace `k8s.svc_hl_yaml`.
    write(
        tmp,
        "svc/k8s/base/svc-hl.yaml",
        r"apiVersion: v1
kind: Service
metadata:
  name: api-hl
  namespace: dev
spec:
  selector:
    app: api
  ports:
    - port: 80
",
    );
    // NetworkPolicy із неповним `egress` — namespace `k8s.network_policy`.
    // Саме ця ціль читає `data.template.*`, і текст її порушення містить
    // `json.marshal(canon_rule)`, тобто **вміст** `--data`: розбіжність у
    // серіалізації сніпета була б видна прямо в повідомленні.
    write(
        tmp,
        "svc/k8s/base/networkpolicy.yaml",
        r"apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api
  namespace: dev
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 80
",
    );
    // base/kustomization.yaml без `namespace:` — namespace `k8s.base_kustomization`
    // (і `k8s.kustomization` на тому ж файлі).
    write(
        tmp,
        "svc/k8s/base/kustomization.yaml",
        r"apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - svc.yaml
  - deployment.yaml
",
    );
}

/// Native і JS дають однаковий набір порушень у однаковому порядку — на
/// реальних rego-полісі, реальному `conftest` і з парою реальних сніпетів у
/// `--data`.
#[test]
fn rego_layer_matches_js_canon_end_to_end() {
    if !prerequisites_met() {
        eprintln!("k8s_manifests_rego_parity: пропуск — немає node/node_modules/conftest");
        return;
    }
    // Тест єдиний у своєму бінарнику (доккомент модуля), тож процес-глобальний
    // override безпечний.
    std::env::set_var("N_RULES_PACKAGE_ROOT", repo_root().join("npm"));

    let tmp = TempDir::new().expect("tempdir");
    build_fixture(&tmp);
    let files = find_k8s_yaml_files(tmp.path(), &[]);
    assert!(!files.is_empty(), "фікстура без YAML під k8s");

    let native: Vec<Reported> = run_all_k8s_rego(tmp.path(), &files)
        .expect("native rego-прогін")
        .into_iter()
        .map(|v| Reported {
            reason: v.reason,
            message: v.message,
            file: v.file,
            data: v.data,
        })
        .collect();
    let js = js_reported(&tmp, &files);

    assert!(
        !native.is_empty(),
        "фікстура нічого не порушує — гейт був би порожній"
    );
    assert_eq!(native, js, "розбіжність native ↔ JS у rego-шарі");
}
