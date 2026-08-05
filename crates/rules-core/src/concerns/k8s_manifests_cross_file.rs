//! Native-порт **самодостатніх** cross-file перевірок концерну `k8s/manifests`
//! (`npm/rules/k8s/manifests/main.mjs`) — тобто тих, що не спираються на
//! рекурсивну kustomize-резолюцію.
//!
//! # Уточнення розбору: самодостатніх `validate*` — шість, не дві
//!
//! `lint()` кличе одинадцять `validate*`. Попередній розбір (PR #381)
//! стверджував, що девʼять із них стоять на спільній kustomize-резолюції.
//! Насправді на ній стоять **пʼять**:
//!
//! | На kustomize-резолюції | На чому саме стоїть |
//! |---|---|
//! | `validateKustomizationPatchTargetsResolved` | `collectResourceDescriptorsForKustomizationWalk` |
//! | `validateKustomizeHpaPdbOnlyWithBaseDeployment` | `kustomizeResourceTreeHpaPdbDeploymentFlags` |
//! | `validateProdKustomizationOverrides` | `prodOverlayHpaPdbOverrideNeeds` |
//! | `validateHasuraOverlayEnabledApisOverride` | `kustomizationTreeHasHasuraDeployment` |
//! | `validateHasuraOverlayEnabledLogTypesOverride` | те саме |
//!
//! Решта шість самодостатні: чотири дрібні (портовані тут) і дві великі, що
//! ходять по каталогах, але дерево kustomization не резолвлять —
//! `validateDeploymentHpaPdbAndTopology` (≈400 рядків HPA/PDB/topology-канону)
//! і `validateNetworkPoliciesForK8sWorkloads`. Обидві лишились поза цим зрізом
//! свідомо: вони самі по собі більші за весь портований набір і заслуговують
//! окремого PR.
//!
//! # Обсяг цього модуля
//!
//! | Rust | JS |
//! |---|---|
//! | [`assert_no_forbidden_k8s_dev_paths`] | `assertNoForbiddenK8sDevPaths` (`main.mjs:3377-3384`) |
//! | [`validate_svc_yaml_and_svc_hl_pairs`] | `validateSvcYamlAndSvcHlPairs` (`main.mjs:3067-3074`) |
//! | [`validate_kustomization_path_refs_exist_on_disk`] | `validateKustomizationPathRefsExistOnDisk` (`main.mjs:638-644`) |
//! | [`validate_kustomization_includes_svc_hl_with_svc`] | `validateKustomizationIncludesSvcHlWithSvc` (`main.mjs:727-732`) |
//! | [`validate_configmap_name_matches_deployment`] | `validateConfigMapNameMatchesDeployment` (`main.mjs:3447-3456`) |
//!
//! Усі пʼять мають однакову сигнатуру «`(root, yaml_files)` → violations» і
//! стану між собою не поділяють, тож порядок виклику у майбутньому `lint()`
//! відтворюється тривіально.
//!
//! # Полагоджений дефект канону: ConfigMap звіряється з ПЕРШИМ Deployment
//!
//! `validateSingleConfigMapNameMatch` (`main.mjs:3425`) брав
//! `findDeploymentDocInDir(dir)` — «перший документ `kind: Deployment` серед
//! YAML-файлів каталогу за порядком `readdir`». Це той самий дефект, що вже
//! полагодив гейт `k8s/hasura_configmap` (доккомент [`super::k8s_hasura`]), у
//! двох проявах:
//!
//! 1. **Недетермінізм.** Порядок `readdir` — порядок файлової системи: APFS
//!    віддає імена впорядковано, ext4 — у hash-порядку. Каталог із двома
//!    Deployment давав різний вислід на macOS і на Linux-раннері CI.
//! 2. **False negative.** Якщо першим трапився Deployment, що взагалі не
//!    посилається на ConfigMap (або посилається на два), гілка
//!    `cmRefs.size !== 1` мовчки закривала перевірку — і назва ConfigMap не
//!    звірялась ні з ким, хоча поруч стояв Deployment рівно з одним рефом.
//!
//! [`configmap_owner_deployment`] лагодить обидва: файли обходяться
//! **відсортовано**, і серед усіх Deployment каталогу береться перший (у тому
//! ж відсортованому порядку), що посилається рівно на один ConfigMap; якщо
//! хоч один такий Deployment має ім'я, що збігається з ConfigMap, порушення
//! немає взагалі. Напрямок зміни — fail-closed: під звірку потрапляє строго
//! більше ConfigMap, жоден не випадає.
//!
//! # Де паритет свідомо не побайтовий
//!
//! Гілки «не вдалося прочитати/розібрати» вставляють у текст повідомлення
//! рядок помилки рантайму (`error.message` Node vs `std::io::Error`). Ці
//! гілки недосяжні на нормальному вході (шляхи приходять із
//! `findK8sYamlFiles`, тобто щойно існували), а решта тексту збігається
//! посимвольно — Р11 п.4 (побайтова рівність лише там, де її споживає хтось
//! зовні).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::concerns::k8s_hasura::{manifest_metadata_name, parse_k8s_yaml_docs};
use crate::concerns::k8s_manifests_rego::{rel_posix, DEFAULT_REASON};
use crate::diagnostics::{Severity, Violation};

/// Суфікс `metadata.name` headless-сервісу — порт `SVC_HL_NAME_SUFFIX`
/// (`main.mjs:2500`).
const SVC_HL_NAME_SUFFIX: &str = "-hl";

/// Порушення без machine-специфічного `reason` — так їх реєструє `fail(msg)`
/// концерну (`reason` = `ctx.concernId`).
fn violation(message: String) -> Violation {
    Violation {
        reason: DEFAULT_REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Ім'я файла у нижньому регістрі (для case-insensitive порівнянь JS-канону).
fn basename_lower(abs: &Path) -> String {
    abs.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

// ─── assertNoForbiddenK8sDevPaths ────────────────────────────────────────────

/// Заборонена окрема директорія `k8s/dev/` — порт
/// `assertNoForbiddenK8sDevPaths` (`main.mjs:3377-3384`) поверх
/// `isForbiddenK8sDevPath` (`main.mjs:242-245`).
///
/// Предикат JS — буквально `rel.includes('/k8s/dev/')`, тобто вимагає сегмент
/// **перед** `k8s`. Порт це відтворює: `k8s/dev/x.yaml` у самому корені репо
/// не ловиться ні там, ні тут. Це вужче, ніж сусідні предикати того ж файлу
/// (`K8S_BASE_SEGMENT_RE` має анкер `(^|\/)`), але змінювати поведінку
/// разом із портом тут не варто — `isForbiddenK8sDevPath` експортований і має
/// власні JS-тести, тож розбіжність між двома реалізаціями одного предиката
/// коштувала б дорожче за сам edge-case.
pub fn assert_no_forbidden_k8s_dev_paths(root: &Path, yaml_files: &[PathBuf]) -> Vec<Violation> {
    yaml_files
        .iter()
        .filter(|abs| rel_posix(root, abs).contains("/k8s/dev/"))
        .map(|abs| {
            violation(format!(
                "{}: заборонена директорія k8s/dev/ — середовище dev відповідає base (див. k8s.mdc)",
                rel_posix(root, abs)
            ))
        })
        .collect()
}

// ─── validateSvcYamlAndSvcHlPairs ────────────────────────────────────────────

/// `metadata.name` усіх `kind: Service` документа — порт
/// `appendServiceNamesFromSvcRoots` (`main.mjs:2933-2955`). `Err(message)` —
/// перший зламаний Service (JS реєструє порушення і припиняє обробку пари).
fn service_names(
    docs: &[Value],
    rel_for_msg: &str,
    file_label: &str,
) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for (index, doc) in docs.iter().enumerate() {
        let Some(rec) = doc.as_object() else { continue };
        if rec.get("kind").and_then(Value::as_str) != Some("Service") {
            continue;
        }
        let position = index + 1;
        let Some(meta) = rec.get("metadata").and_then(Value::as_object) else {
            return Err(format!(
                "{rel_for_msg}: {file_label} (документ {position}): Service без metadata (див. k8s.mdc)"
            ));
        };
        let Some(name) = meta.get("name").and_then(Value::as_str) else {
            return Err(format!(
                "{rel_for_msg}: {file_label} (документ {position}): Service без metadata.name (див. k8s.mdc)"
            ));
        };
        names.push(name.to_string());
    }
    Ok(names)
}

/// Узгодженість імен Service між `svc.yaml` і `svc-hl.yaml` — порт
/// `validateSvcHlServiceNamePairing` (`main.mjs:2962-2994`).
fn svc_hl_name_pairing(
    rel_svc: &str,
    rel_hl: &str,
    svc_names: &[String],
    hl_names: &[String],
) -> Vec<Violation> {
    if svc_names.is_empty() {
        return vec![violation(format!(
            "{rel_svc}: svc.yaml має містити принаймні один kind: Service (див. k8s.mdc)"
        ))];
    }
    if hl_names.is_empty() {
        return vec![violation(format!(
            "{rel_hl}: svc-hl.yaml має містити принаймні один kind: Service (див. k8s.mdc)"
        ))];
    }
    let hl_set: BTreeSet<&str> = hl_names.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    for name in svc_names {
        let expect_hl = format!("{name}{SVC_HL_NAME_SUFFIX}");
        if !hl_set.contains(expect_hl.as_str()) {
            out.push(violation(format!(
                "{rel_svc}: для Service «{name}» у svc.yaml у svc-hl.yaml має бути Service з metadata.name «{expect_hl}» (див. k8s.mdc)"
            )));
        }
    }
    for hl in hl_names {
        match hl.strip_suffix(SVC_HL_NAME_SUFFIX) {
            Some(base) => {
                if !svc_names.iter().any(|n| n == base) {
                    out.push(violation(format!(
                        "{rel_hl}: Service «{hl}» у svc-hl.yaml не відповідає жодному Service у svc.yaml (очікується базове ім’я «{base}»; див. k8s.mdc)"
                    )));
                }
            }
            None => out.push(violation(format!(
                "{rel_hl}: Service «{hl}» у svc-hl.yaml: metadata.name має закінчуватися на «{SVC_HL_NAME_SUFFIX}» (див. k8s.mdc)"
            ))),
        }
    }
    out
}

/// Одна пара `svc.yaml`/`svc-hl.yaml` — порт `validateOneSvcYamlHlPair`
/// (`main.mjs:3023-3058`).
fn one_svc_hl_pair(root: &Path, present: &BTreeSet<PathBuf>, svc_abs: &Path) -> Vec<Violation> {
    let rel = rel_posix(root, svc_abs);
    let Some(dir) = svc_abs.parent() else {
        return Vec::new();
    };
    let hl_abs = dir.join("svc-hl.yaml");
    if !present.contains(&hl_abs) {
        return vec![violation(format!(
            "{rel}: поруч обов’язковий svc-hl.yaml (headless-копія з суфіксом -hl у metadata.name; див. k8s.mdc)"
        ))];
    }
    let hl_rel = rel_posix(root, &hl_abs);
    for path in [svc_abs, hl_abs.as_path()] {
        if let Err(error) = std::fs::read_to_string(path) {
            return vec![violation(format!(
                "{rel}: не вдалося прочитати svc.yaml / svc-hl.yaml ({error})"
            ))];
        }
    }
    let svc_names = match service_names(&parse_k8s_yaml_docs(svc_abs), &rel, "svc.yaml") {
        Ok(names) => names,
        Err(message) => return vec![violation(message)],
    };
    let hl_names = match service_names(&parse_k8s_yaml_docs(&hl_abs), &hl_rel, "svc-hl.yaml") {
        Ok(names) => names,
        Err(message) => return vec![violation(message)],
    };
    svc_hl_name_pairing(&rel, &hl_rel, &svc_names, &hl_names)
}

/// Пари `svc.yaml`/`svc-hl.yaml` — порт `validateSvcYamlAndSvcHlPairs`
/// (`main.mjs:3067-3074`): спершу всі осиротілі `svc-hl.yaml`, потім кожен
/// `svc.yaml` (порядок важить — він відтворює порядок violations).
pub fn validate_svc_yaml_and_svc_hl_pairs(root: &Path, yaml_files: &[PathBuf]) -> Vec<Violation> {
    let present: BTreeSet<PathBuf> = yaml_files.iter().cloned().collect();
    let mut out: Vec<Violation> = yaml_files
        .iter()
        .filter(|abs| basename_lower(abs) == "svc-hl.yaml")
        .filter(|abs| {
            abs.parent()
                .is_none_or(|dir| !present.contains(&dir.join("svc.yaml")))
        })
        .map(|abs| {
            violation(format!(
                "{}: svc-hl.yaml потребує svc.yaml у тому самому каталозі (див. k8s.mdc)",
                rel_posix(root, abs)
            ))
        })
        .collect();
    for svc_abs in yaml_files
        .iter()
        .filter(|abs| basename_lower(abs) == "svc.yaml")
    {
        out.extend(one_svc_hl_pair(root, &present, svc_abs));
    }
    out
}

// ─── kustomization-хелпери ───────────────────────────────────────────────────

/// Непорожні trim-нуті рядки масиву — порт `pushStringPaths`
/// (`main.mjs:295-300`).
fn push_string_paths(value: Option<&Value>, out: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    for item in items {
        if let Some(text) = item.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
    }
}

/// Непорожні `item.path` масиву обʼєктів — порт `collectObjectPathFields`
/// (`main.mjs:522-535`); тим же кодом покривається гілка `patches[].path`
/// у `pathsFromKustomizationObject`.
fn push_object_path_fields(value: Option<&Value>, out: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    for item in items {
        let Some(rec) = item.as_object() else {
            continue;
        };
        if let Some(text) = rec.get("path").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
    }
}

/// Шляхи з полів Kustomization для resolve відносно каталогу маніфеста — порт
/// `pathsFromKustomizationObject` (`main.mjs:489-518`).
fn paths_from_kustomization(obj: &Value) -> Vec<String> {
    let Some(rec) = obj.as_object() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for key in [
        "resources",
        "bases",
        "components",
        "crds",
        "patchesStrategicMerge",
    ] {
        push_string_paths(rec.get(key), &mut out);
    }
    push_object_path_fields(rec.get("patches"), &mut out);
    out
}

/// Унікальні локальні шляхи для перевірки існування — порт
/// `kustomizePathRefsForExistenceCheck` (`main.mjs:556-566`): до
/// [`paths_from_kustomization`] додаються `patchesJson6902[].path`,
/// `configurations[]` і `replacements[].path`, далі дедуп зі збереженням
/// порядку першої появи (`[...new Set(...)]`).
fn kustomize_path_refs_for_existence_check(obj: &Value) -> Vec<String> {
    let Some(rec) = obj.as_object() else {
        return Vec::new();
    };
    let mut refs = paths_from_kustomization(obj);
    push_object_path_fields(rec.get("patchesJson6902"), &mut refs);
    push_string_paths(rec.get("configurations"), &mut refs);
    push_object_path_fields(rec.get("replacements"), &mut refs);
    let mut seen = BTreeSet::new();
    refs.retain(|item| seen.insert(item.clone()));
    refs
}

/// Перший YAML-обʼєкт файла — порт `readFirstYamlObject` (`main.mjs:4336-4352`).
fn read_first_yaml_object(abs: &Path) -> Option<Value> {
    parse_k8s_yaml_docs(abs)
        .into_iter()
        .find(|doc| doc.is_object())
}

/// Нормалізація `path::resolve(dir, ref)` без походу на диск: `..`/`.` згортаються
/// лексично, як це робить Node (він теж не робить `realpath`).
fn resolve_lexical(base: &Path, reference: &str) -> PathBuf {
    let joined = base.join(reference);
    let mut out = PathBuf::new();
    for component in joined.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Чи шлях лежить усередині кореня — порт `resolvedFilePathIsUnderRoot`
/// (`main.mjs:1945-1953`).
fn is_under_root(root: &Path, target: &Path) -> bool {
    target == root || target.starts_with(root)
}

/// Чи має шлях розширення `.yaml`/`.yml` — порт `YAML_EXTENSION_RE`
/// (`main.mjs:187`).
fn has_yaml_extension(target: &Path) -> bool {
    let lower = target.to_string_lossy().to_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

// ─── validateKustomizationPathRefsExistOnDisk ────────────────────────────────

/// Одне посилання kustomization — порт `validateKustomizationRef`
/// (`main.mjs:576-606`).
fn kustomization_ref_violation(
    rel: &str,
    reference: &str,
    kust_dir: &Path,
    root: &Path,
) -> Option<Violation> {
    let target = resolve_lexical(kust_dir, reference.trim());
    if !is_under_root(root, &target) {
        let shown = rel_posix(root, &target);
        return Some(violation(format!(
            "{rel}: посилання «{reference}» виходить за межі репозиторію (resolve: {shown}) (k8s.mdc)"
        )));
    }
    let Ok(meta) = std::fs::metadata(&target) else {
        return Some(violation(format!(
            "{rel}: посилання «{reference}» вказує на неіснуючий ресурс (очікувано файл або каталог; k8s.mdc)"
        )));
    };
    if meta.is_file() {
        if has_yaml_extension(&target) {
            return None;
        }
        return Some(violation(format!(
            "{rel}: «{reference}» — за правилами k8s у kustomization для файлів дозволені лише розширення .yaml / .yml (k8s.mdc)"
        )));
    }
    if meta.is_dir() {
        return None;
    }
    Some(violation(format!(
        "{rel}: «{reference}» — ні файл, ні каталог (k8s.mdc)"
    )))
}

/// Локальні шляхи всіх `kustomization.yaml` мають існувати на диску — порт
/// `validateKustomizationPathRefsExistOnDisk` (`main.mjs:638-644`).
pub fn validate_kustomization_path_refs_exist_on_disk(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename_lower(abs) == "kustomization.yaml")
    {
        let Some(kust) = read_first_yaml_object(kust_abs) else {
            continue;
        };
        if kust.get("kind").and_then(Value::as_str) != Some("Kustomization") {
            continue;
        }
        let rel = rel_posix(root, kust_abs);
        let Some(kust_dir) = kust_abs.parent() else {
            continue;
        };
        for reference in kustomize_path_refs_for_existence_check(&kust) {
            // `://` — віддалений ресурс kustomize, його існування на диску не
            // перевіряється (`main.mjs:625`).
            if reference.contains("://") || reference.trim().is_empty() {
                continue;
            }
            out.extend(kustomization_ref_violation(
                &rel, &reference, kust_dir, root,
            ));
        }
    }
    out
}

// ─── validateKustomizationIncludesSvcHlWithSvc ───────────────────────────────

/// `svc.yaml` у шляхах kustomization без парного `svc-hl.yaml` — порт
/// `kustomizationSvcYamlMissingSvcHlViolation` (`main.mjs:653-677`): повертає
/// **перше** таке посилання, як і JS (`return` з циклу).
fn kustomization_svc_missing_hl(kust_dir: &Path, path_refs: &[String]) -> Option<String> {
    let resolved: BTreeSet<PathBuf> = path_refs
        .iter()
        .filter(|reference| !reference.contains("://"))
        .map(|reference| resolve_lexical(kust_dir, reference))
        .collect();
    for reference in path_refs {
        if reference.contains("://") {
            continue;
        }
        let abs = resolve_lexical(kust_dir, reference);
        if basename_lower(&abs) != "svc.yaml" {
            continue;
        }
        let Some(parent) = abs.parent() else { continue };
        if !resolved.contains(&parent.join("svc-hl.yaml")) {
            return Some(format!(
                "kustomization посилається на «{reference}» — додай у тому ж kustomization.yaml посилання на відповідний svc-hl.yaml (очікуваний шлях поруч, наприклад той самий префікс каталогу + svc-hl.yaml; див. k8s.mdc)"
            ));
        }
    }
    None
}

/// Разом із `svc.yaml` kustomization має посилатись і на `svc-hl.yaml` — порт
/// `validateKustomizationIncludesSvcHlWithSvc` (`main.mjs:727-732`).
///
/// На відміну від [`validate_kustomization_path_refs_exist_on_disk`] тут немає
/// гейта `kind === 'Kustomization'` — JS-канон бере перший обʼєктний документ
/// як є (`main.mjs:708-711`).
pub fn validate_kustomization_includes_svc_hl_with_svc(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename_lower(abs) == "kustomization.yaml")
    {
        let rel = rel_posix(root, kust_abs);
        if let Err(error) = std::fs::read_to_string(kust_abs) {
            out.push(violation(format!(
                "{rel}: не вдалося прочитати для перевірки svc.yaml/svc-hl.yaml у kustomization ({error})"
            )));
            continue;
        }
        let Some(kust) = read_first_yaml_object(kust_abs) else {
            continue;
        };
        let Some(kust_dir) = kust_abs.parent() else {
            continue;
        };
        if let Some(message) =
            kustomization_svc_missing_hl(kust_dir, &paths_from_kustomization(&kust))
        {
            out.push(violation(format!("{rel}: {message}")));
        }
    }
    out
}

// ─── validateConfigMapNameMatchesDeployment ──────────────────────────────────

/// Хвіст шляху цільового ConfigMap — `CONFIGMAP_BASE_PATH_RE`
/// (`main.mjs:3397`), застосований до `/${rel}`.
const CONFIGMAP_BASE_PATH_SUFFIX: &str = "/k8s/base/configmap.yaml";

/// Унікальні імена ConfigMap, на які посилається Deployment — порт
/// `collectDeploymentConfigMapRefs` (`main.mjs:2479-2493`):
/// `spec.template.spec.containers[*].envFrom[*].configMapRef.name` і
/// `spec.template.spec.volumes[*].configMap.name`.
fn deployment_configmap_refs(deployment: &Value) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let Some(pod_spec) = deployment
        .get("spec")
        .and_then(|spec| spec.get("template"))
        .and_then(|template| template.get("spec"))
        .and_then(Value::as_object)
    else {
        return names;
    };
    let mut add = |value: Option<&Value>| {
        if let Some(name) = value.and_then(Value::as_str) {
            if !name.trim().is_empty() {
                names.insert(name.to_string());
            }
        }
    };
    for container in pod_spec
        .get("containers")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        for env_from in container
            .get("envFrom")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            add(env_from
                .as_object()
                .and_then(|rec| rec.get("configMapRef"))
                .filter(|v| v.is_object())
                .and_then(|rec| rec.get("name")));
        }
    }
    for volume in pod_spec
        .get("volumes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        add(volume
            .as_object()
            .and_then(|rec| rec.get("configMap"))
            .filter(|v| v.is_object())
            .and_then(|rec| rec.get("name")));
    }
    names
}

/// Відсортовані шляхи YAML-файлів каталогу — детермінована заміна `readdir`
/// (секція «Полагоджений дефект канону» доккоменту модуля).
fn sorted_yaml_files_in_dir(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            let lower = basename_lower(path);
            lower.ends_with(".yaml") || lower.ends_with(".yml")
        })
        .collect();
    paths.sort();
    paths
}

/// Deployment каталогу, з яким має збігатись ім'я ConfigMap — **полагоджена**
/// заміна `findDeploymentDocInDir` (доккомент модуля).
///
/// Повертає `Some(name)`, якщо в каталозі є хоч один Deployment рівно з одним
/// ConfigMap-рефом і ЖОДЕН такий Deployment не названий як `cm_name`; якщо
/// збіг є — `None` (порушення немає). Обхід — за відсортованими іменами
/// файлів, тобто детермінований на будь-якій ФС.
fn configmap_owner_deployment(dir: &Path, cm_name: &str) -> Option<String> {
    let mut first_candidate: Option<String> = None;
    for path in sorted_yaml_files_in_dir(dir) {
        for doc in parse_k8s_yaml_docs(&path) {
            if doc.get("kind").and_then(Value::as_str) != Some("Deployment") {
                continue;
            }
            if deployment_configmap_refs(&doc).len() != 1 {
                continue;
            }
            let Some(deploy_name) = manifest_metadata_name(&doc) else {
                continue;
            };
            if deploy_name == cm_name {
                return None;
            }
            if first_candidate.is_none() {
                first_candidate = Some(deploy_name.to_string());
            }
        }
    }
    first_candidate
}

/// Ім'я першого ConfigMap файла — порт `extractFirstConfigMapName`
/// (`main.mjs:3404-3410`).
fn first_configmap_name(abs: &Path) -> Option<String> {
    parse_k8s_yaml_docs(abs)
        .into_iter()
        .find(|doc| doc.get("kind").and_then(Value::as_str) == Some("ConfigMap"))
        .and_then(|doc| manifest_metadata_name(&doc).map(str::to_string))
}

/// `metadata.name` ConfigMap у `k8s/base/` має збігатися з іменем Deployment,
/// що посилається рівно на один ConfigMap — порт
/// `validateConfigMapNameMatchesDeployment` (`main.mjs:3447-3456`) з
/// полагодженим вибором Deployment (доккомент модуля).
pub fn validate_configmap_name_matches_deployment(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let mut out = Vec::new();
    for cm_abs in yaml_files
        .iter()
        .filter(|abs| format!("/{}", rel_posix(root, abs)).ends_with(CONFIGMAP_BASE_PATH_SUFFIX))
    {
        let Some(cm_name) = first_configmap_name(cm_abs) else {
            continue;
        };
        let Some(dir) = cm_abs.parent() else { continue };
        if let Some(deploy_name) = configmap_owner_deployment(dir, &cm_name) {
            let rel = rel_posix(root, cm_abs);
            out.push(violation(format!(
                "{rel}: metadata.name '{cm_name}' має збігатися з назвою Deployment '{deploy_name}' — Deployment посилається рівно на один ConfigMap (k8s.mdc)"
            )));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::k8s_common::find_k8s_yaml_files;
    use crate::concerns::test_support::write;

    /// Тексти violations у порядку появи — те, з чим звіряється паритет.
    fn messages(violations: &[Violation]) -> Vec<String> {
        violations.iter().map(|v| v.message.clone()).collect()
    }

    // --- assertNoForbiddenK8sDevPaths ---

    #[test]
    fn dev_directory_under_k8s_is_reported() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "svc/k8s/dev/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&assert_no_forbidden_k8s_dev_paths(root, &files)),
            vec![
                "svc/k8s/dev/deploy.yaml: заборонена директорія k8s/dev/ — середовище dev відповідає base (див. k8s.mdc)"
            ]
        );
    }

    // --- validateSvcYamlAndSvcHlPairs ---

    /// `svc.yaml` без сусіда, `svc-hl.yaml` без сусіда — обидві гілки, і саме
    /// в тому порядку, що в JS (спершу осиротілі `-hl`, потім `svc.yaml`).
    #[test]
    fn svc_pair_reports_both_orphan_directions_in_js_order() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "a/k8s/base/svc.yaml",
            "kind: Service\nmetadata:\n  name: a\n",
        );
        write(
            &tmp,
            "b/k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: b-hl\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&validate_svc_yaml_and_svc_hl_pairs(root, &files)),
            vec![
                "b/k8s/base/svc-hl.yaml: svc-hl.yaml потребує svc.yaml у тому самому каталозі (див. k8s.mdc)",
                "a/k8s/base/svc.yaml: поруч обов’язковий svc-hl.yaml (headless-копія з суфіксом -hl у metadata.name; див. k8s.mdc)",
            ]
        );
    }

    /// Повна пара з узгодженими іменами — тиша.
    #[test]
    fn matching_svc_pair_is_clean() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "kind: Service\nmetadata:\n  name: api\n",
        );
        write(
            &tmp,
            "k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: api-hl\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_svc_yaml_and_svc_hl_pairs(root, &files).is_empty());
    }

    /// Розбіжність імен дає обидва напрямки звірки: «немає -hl для api» і
    /// «api-x-hl не має базового api-x».
    #[test]
    fn mismatched_service_names_report_both_directions() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "kind: Service\nmetadata:\n  name: api\n",
        );
        write(
            &tmp,
            "k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: api-x-hl\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&validate_svc_yaml_and_svc_hl_pairs(root, &files)),
            vec![
                "k8s/base/svc.yaml: для Service «api» у svc.yaml у svc-hl.yaml має бути Service з metadata.name «api-hl» (див. k8s.mdc)",
                "k8s/base/svc-hl.yaml: Service «api-x-hl» у svc-hl.yaml не відповідає жодному Service у svc.yaml (очікується базове ім’я «api-x»; див. k8s.mdc)",
            ]
        );
    }

    /// Service у `svc-hl.yaml` без суфікса `-hl` — окрема гілка повідомлення.
    #[test]
    fn hl_service_without_suffix_is_reported() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "kind: Service\nmetadata:\n  name: api\n",
        );
        write(
            &tmp,
            "k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: api\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        let got = messages(&validate_svc_yaml_and_svc_hl_pairs(root, &files));
        assert!(
            got.iter()
                .any(|m| m.contains("metadata.name має закінчуватися на «-hl»")),
            "{got:?}"
        );
    }

    /// Порожній `svc.yaml` (без жодного Service) — власна гілка, і вона
    /// коротко-замикає перевірку пари.
    #[test]
    fn svc_without_service_document_short_circuits() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "kind: ConfigMap\nmetadata:\n  name: x\n",
        );
        write(
            &tmp,
            "k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: api-hl\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&validate_svc_yaml_and_svc_hl_pairs(root, &files)),
            vec!["k8s/base/svc.yaml: svc.yaml має містити принаймні один kind: Service (див. k8s.mdc)"]
        );
    }

    /// Service без `metadata.name` — повідомлення з 1-based номером документа.
    #[test]
    fn service_without_name_reports_document_index() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/svc.yaml",
            "kind: ConfigMap\nmetadata:\n  name: x\n---\nkind: Service\nmetadata:\n  namespace: dev\n",
        );
        write(
            &tmp,
            "k8s/base/svc-hl.yaml",
            "kind: Service\nmetadata:\n  name: api-hl\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&validate_svc_yaml_and_svc_hl_pairs(root, &files)),
            vec!["k8s/base/svc.yaml: svc.yaml (документ 2): Service без metadata.name (див. k8s.mdc)"]
        );
    }

    // --- validateKustomizationPathRefsExistOnDisk ---

    /// Три гілки перевірки посилань: неіснуючий ресурс, файл із чужим
    /// розширенням і вихід за межі репозиторію.
    #[test]
    fn kustomization_path_refs_cover_all_failure_branches() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "k8s/base/notes.txt", "hi\n");
        write(
            &tmp,
            "k8s/base/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - deploy.yaml\n  - missing.yaml\n  - notes.txt\n  - ../../../outside.yaml\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        let got = messages(&validate_kustomization_path_refs_exist_on_disk(
            root, &files,
        ));
        assert_eq!(got.len(), 3, "{got:?}");
        assert!(
            got[0].contains("«missing.yaml» вказує на неіснуючий ресурс"),
            "{got:?}"
        );
        assert!(
            got[1].contains("дозволені лише розширення .yaml / .yml"),
            "{got:?}"
        );
        assert!(got[2].contains("виходить за межі репозиторію"), "{got:?}");
    }

    /// Не-Kustomization документ пропускається цілком (гілка `kind !== …`), а
    /// віддалені посилання (`://`) на диску не шукаються.
    #[test]
    fn non_kustomization_and_remote_refs_are_skipped() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/kustomization.yaml",
            "kind: Component\nresources:\n  - missing.yaml\n",
        );
        write(
            &tmp,
            "k8s/overlays/prod/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - https://example.com/x.yaml\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_kustomization_path_refs_exist_on_disk(root, &files).is_empty());
    }

    /// Каталог як ресурс — валідний (гілка `isDirectory`).
    #[test]
    fn directory_ref_is_valid() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "k8s/base/deploy.yaml", "kind: Deployment\n");
        write(
            &tmp,
            "k8s/overlays/prod/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - ../../base\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_kustomization_path_refs_exist_on_disk(root, &files).is_empty());
    }

    // --- validateKustomizationIncludesSvcHlWithSvc ---

    #[test]
    fn kustomization_with_svc_but_no_hl_is_reported() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - svc.yaml\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        let got = messages(&validate_kustomization_includes_svc_hl_with_svc(
            root, &files,
        ));
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(
            got[0].starts_with(
                "k8s/base/kustomization.yaml: kustomization посилається на «svc.yaml»"
            ),
            "{got:?}"
        );
    }

    #[test]
    fn kustomization_with_both_svc_files_is_clean() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - svc.yaml\n  - svc-hl.yaml\n",
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_kustomization_includes_svc_hl_with_svc(root, &files).is_empty());
    }

    // --- validateConfigMapNameMatchesDeployment ---

    /// Deployment із рівно одним ConfigMap-рефом і чужим ім'ям — порушення.
    #[test]
    fn configmap_name_mismatch_is_reported() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            &tmp,
            "k8s/base/deployment.yaml",
            &deployment("api", &["cfg"]),
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            messages(&validate_configmap_name_matches_deployment(root, &files)),
            vec![
                "k8s/base/configmap.yaml: metadata.name 'cfg' має збігатися з назвою Deployment 'api' — Deployment посилається рівно на один ConfigMap (k8s.mdc)"
            ]
        );
    }

    /// Збіг імен — тиша.
    #[test]
    fn configmap_name_match_is_clean() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: api\n",
        );
        write(
            &tmp,
            "k8s/base/deployment.yaml",
            &deployment("api", &["api"]),
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_configmap_name_matches_deployment(root, &files).is_empty());
    }

    /// Deployment із двома ConfigMap-рефами перевірку не запускає (гілка
    /// `cmRefs.size !== 1` канону — вона зберігається).
    #[test]
    fn deployment_with_two_configmap_refs_is_skipped() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            &tmp,
            "k8s/base/deployment.yaml",
            &deployment("api", &["cfg", "other"]),
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_configmap_name_matches_deployment(root, &files).is_empty());
    }

    /// **Полагоджений дефект — напрямок «зʼявилось порушення».**
    /// Лексикографічно перший Deployment каталогу (`a-worker.yaml`) не
    /// посилається на ConfigMap; на ньому канон зупинявся і мовчки пропускав
    /// перевірку. Тепер береться Deployment із рефом — і розбіжність імені
    /// репортується. Це і є falsification-точка фіксу: з «першим-ліпшим
    /// Deployment» тут була б тиша.
    #[test]
    fn first_deployment_without_refs_no_longer_hides_the_check() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(&tmp, "k8s/base/a-worker.yaml", &deployment("worker", &[]));
        write(&tmp, "k8s/base/b-api.yaml", &deployment("api", &["cfg"]));
        let files = find_k8s_yaml_files(root, &[]);
        let got = messages(&validate_configmap_name_matches_deployment(root, &files));
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(got[0].contains("назвою Deployment 'api'"), "{got:?}");
    }

    /// Той самий дефект, напрямок «порушення зникло»: власник каталогу —
    /// не перший Deployment, але його ім'я збігається з ConfigMap, тож
    /// перевірка знаходить збіг і мовчить (раніше вона просто не запускалась).
    #[test]
    fn owner_match_is_found_past_the_first_deployment() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: api\n",
        );
        write(
            &tmp,
            "k8s/base/a-worker.yaml",
            &deployment("worker", &["api"]),
        );
        write(&tmp, "k8s/base/b-api.yaml", &deployment("api", &["api"]));
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_configmap_name_matches_deployment(root, &files).is_empty());
    }

    /// Той самий каталог, але жоден Deployment із рефом не названий як
    /// ConfigMap — порушення проти першого (у відсортованому порядку)
    /// кандидата, тобто детерміновано на будь-якій ФС.
    #[test]
    fn owner_deployment_choice_is_deterministic() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/base/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            &tmp,
            "k8s/base/a-worker.yaml",
            &deployment("worker", &["cfg"]),
        );
        write(&tmp, "k8s/base/b-api.yaml", &deployment("api", &["cfg"]));
        let files = find_k8s_yaml_files(root, &[]);
        let got = messages(&validate_configmap_name_matches_deployment(root, &files));
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(got[0].contains("назвою Deployment 'worker'"), "{got:?}");
    }

    /// ConfigMap поза `k8s/base/` не є ціллю (overlay має власні перевірки).
    #[test]
    fn overlay_configmap_is_not_a_target() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "k8s/overlays/prod/configmap.yaml",
            "kind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            &tmp,
            "k8s/overlays/prod/deployment.yaml",
            &deployment("api", &["cfg"]),
        );
        let files = find_k8s_yaml_files(root, &[]);
        assert!(validate_configmap_name_matches_deployment(root, &files).is_empty());
    }

    /// Посилання на ConfigMap беруться і з `envFrom`, і з `volumes` — обидві гілки
    /// `collectDeploymentConfigMapRefs`.
    #[test]
    fn configmap_refs_come_from_env_from_and_volumes() {
        let from_env: Value =
            serde_yaml::from_str(&deployment("api", &["cfg"])).expect("valid yaml");
        assert_eq!(
            deployment_configmap_refs(&from_env),
            BTreeSet::from(["cfg".to_string()])
        );

        let from_volume: Value = serde_yaml::from_str(
            "kind: Deployment\nspec:\n  template:\n    spec:\n      volumes:\n        - name: v\n          configMap:\n            name: vol-cfg\n",
        )
        .expect("valid yaml");
        assert_eq!(
            deployment_configmap_refs(&from_volume),
            BTreeSet::from(["vol-cfg".to_string()])
        );
    }

    /// Deployment із заданим ім'ям і переліком ConfigMap у `envFrom`.
    fn deployment(name: &str, configmaps: &[&str]) -> String {
        let env_from = if configmaps.is_empty() {
            String::new()
        } else {
            let items: String = configmaps
                .iter()
                .map(|cm| format!("            - configMapRef:\n                name: {cm}\n"))
                .collect();
            format!("          envFrom:\n{items}")
        };
        format!(
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: repo/app:1\n{env_from}"
        )
    }
}
