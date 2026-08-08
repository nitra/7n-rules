//! Native-порт **kubescape-контуру** концерну `k8s/manifests`
//! (`npm/rules/k8s/manifests/main.mjs`) — read-only скан зібраних маніфестів
//! зовнішнім тулом `kubescape`.
//!
//! | Rust | JS-канон |
//! |---|---|
//! | [`find_kustomization_dirs`] | `findKustomizationDirs` (`main.mjs:6811-6834`) |
//! | [`auto_job_cronjob_probe_exceptions`] | `autoJobCronJobProbeExceptions` (`main.mjs:6708-6731`) |
//! | [`collect_kubescape_targets`] | `collectKubescapeTargets` (`main.mjs:6973-6984`) |
//! | [`run_kubescape`] | `runKubescape` (`main.mjs:6996-7027`) |
//! | [`kubescape_violations`] | kubescape-гілка `lint()` (`main.mjs:6535-6546`) |
//!
//! # Що саме сканується
//!
//! Кожен `k8s`-корінь ([`super::k8s_common::find_k8s_roots`]) розгортається
//! у granular-таргети: якщо під ним є каталоги з `kustomization.yaml` (окрім
//! `kind: Component`) — по одному **kustomize**-таргету на кожен, інакше один
//! **raw**-таргет на весь корінь. Kustomize-таргет спершу збирається
//! `kubectl kustomize <dir>`, і в `kubescape scan` іде **stdout** цієї збірки
//! через тимчасовий файл (kubescape 4.x не читає stdin). Перший ненульовий
//! код перериває весь обхід — як і в канону.
//!
//! # Auto-exceptions для probe у Job/CronJob
//!
//! Контроли C-0056/C-0018 (liveness/readiness probe) структурно незастосовні
//! до `Job`/`CronJob`. Канон генерує по одному `postureExceptionPolicy` на
//! **кожен реальний ресурс** із непорожнім `metadata.name`, знайдений саме в
//! тому вмісті, який зараз сканується, і мержить їх із користувацьким
//! `.kubescape-exceptions.json` у тимчасовий файл. Свідомо **не** kind-only:
//! kind-only виняток замовчав би ці контроли й на Deployment-подібних
//! ресурсах.
//!
//! # Тул відсутній
//!
//! `kubescape` резолвиться через [`crate::tool_resolve::resolve_provisioned_tool`]
//! (PATH + керований кеш); якщо його немає — [`crate::RulesError::Concern`] з
//! per-OS install-підказкою, тобто fail-closed. Це той самий контракт, що вже
//! зафіксував сусідній `k8s/kubeconform`, і та сама причина: `rules-core` не
//! встановлює тулів, а мовчазний пропуск на ефемерному раннері означав би
//! тихе зникнення перевірки.
//!
//! **Різниця з `k8s/kubeconform` у ціні помилки названа свідомо:** там тул —
//! увесь концерн, тут — один крок із півтора десятка. Відсутній `kubescape`
//! завалить **весь** `k8s/manifests`, тоді як JS-канон у цьому місці ловив
//! `ENOENT` і йшов далі (`status = 127` → без violation). Це єдине місце
//! контуру, де порт свідомо суворіший за канон.
//!
//! `kubectl` у реєстрі тулів **немає** — канон резолвить його простим
//! пошуком у `PATH` (`resolveCmd`) і при відсутності віддає `127`, тобто
//! мовчки пропускає. Ця гілка перенесена як є.
//!
//! # `verbose` не проводиться
//!
//! Як і в [`super::k8s_kubeconform`]: у JS `verbose` керує лише тим, чи видно
//! сирий вивід тулів і прогрес, на набір violations не впливає, а контракт
//! [`super::run_concern`] його не переносить.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_roots;
use crate::concerns::k8s_manifests_rego::rel_posix_raw;
use crate::diagnostics::{Severity, Violation};
use crate::scan::walk_dir;
use crate::tool_registry::install_hint_for;
use crate::tool_resolve::resolve_provisioned_tool;
use crate::RulesError;

/// `toolId` у спільному реєстрі тулів і водночас імʼя бінарника.
const TOOL_ID: &str = "kubescape";

/// Імʼя користувацького файла винятків — порт `KUBESCAPE_EXCEPTIONS_FILE`
/// (`main.mjs:6649`).
const KUBESCAPE_EXCEPTIONS_FILE: &str = ".kubescape-exceptions.json";

/// Імʼя файла kustomization — порт `KUSTOMIZATION_FILE` (`main.mjs:6650`).
const KUSTOMIZATION_FILE: &str = "kustomization.yaml";

/// Wall-clock ліміт одного скану — порт `KUBESCAPE_SCAN_TIMEOUT_MS`
/// (`main.mjs:6653`).
const KUBESCAPE_SCAN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Людський підпис ліміту в тексті порушення — порт
/// `KUBESCAPE_SCAN_TIMEOUT_LABEL` (`main.mjs:6654`).
const KUBESCAPE_SCAN_TIMEOUT_LABEL: &str = "5 хв";

/// Значення `--scan-timeout` самого тула — порт
/// `KUBESCAPE_SCAN_TIMEOUT_ARG` (`main.mjs:6655`).
const KUBESCAPE_SCAN_TIMEOUT_ARG: &str = "5m";

/// `kind`, для яких C-0056/C-0018 незастосовні — порт
/// `KUBESCAPE_PROBE_EXEMPT_KINDS` (`main.mjs:6697`).
const PROBE_EXEMPT_KINDS: &[&str] = &["Job", "CronJob"];

/// Стабільний machine code violation-а — другий аргумент `fail(...)`
/// (`main.mjs:6544`).
const REASON: &str = "kubescape";

/// Текст violation-а поза таймаутом — порт `main.mjs:6543`.
const RISKS_MESSAGE: &str = "kubescape знайшов ризики у маніфестах (k8s.mdc)";

/// Крок опитування дочірнього процесу під час очікування з таймаутом.
const CHILD_POLL_INTERVAL: Duration = Duration::from_millis(50);

// ─── findKustomizationDirs ───────────────────────────────────────────────────

/// Перший YAML-документ файла як `serde_json::Value` — дзеркало `parse(text)`
/// з пакета `yaml` (`main.mjs:6825`): помилка парсингу → `None`.
fn parse_first_yaml_doc(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    let first = serde_yaml::Deserializer::from_str(&raw)
        .next()
        .and_then(|doc| serde_yaml::Value::deserialize(doc).ok())?;
    serde_json::to_value(first).ok()
}

/// Каталоги з `kustomization.yaml` (окрім `kind: Component`) — порт
/// `findKustomizationDirs` (`main.mjs:6811-6834`).
///
/// Порядок результату — `Set` + `toSorted(localeCompare)` у канону; тут
/// [`BTreeSet`] по рядковому шляху дає ту саму детермінованість. Шляхи —
/// ASCII-каталоги репозиторію, тож ICU-порядок і байтовий тут збігаються
/// (на відміну від [`super::k8s_common::find_k8s_roots`], де в грі імена
/// файлів).
pub(crate) fn find_kustomization_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut result: BTreeSet<String> = BTreeSet::new();
    for rel in walk_dir(dir, &[]) {
        if !rel.ends_with(KUSTOMIZATION_FILE) {
            continue;
        }
        let abs = dir.join(&rel);
        if abs
            .file_name()
            .is_none_or(|name| name != KUSTOMIZATION_FILE)
        {
            continue;
        }
        let Some(doc) = parse_first_yaml_doc(&abs) else {
            continue;
        };
        if doc.get("kind").and_then(Value::as_str) == Some("Component") {
            continue;
        }
        if let Some(parent) = abs.parent() {
            result.insert(parent.to_string_lossy().into_owned());
        }
    }
    result.into_iter().map(PathBuf::from).collect()
}

// ─── auto-exceptions ─────────────────────────────────────────────────────────

/// Auto-generated `postureExceptionPolicy`-записи C-0056/C-0018 — порт
/// `autoJobCronJobProbeExceptions` (`main.mjs:6708-6731`).
pub(crate) fn auto_job_cronjob_probe_exceptions(yaml_text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for doc in serde_yaml::Deserializer::from_str(yaml_text)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|value| serde_json::to_value(value).ok())
    {
        if !doc.is_object() {
            continue;
        }
        let Some(kind) = doc.get("kind").and_then(Value::as_str) else {
            continue;
        };
        if !PROBE_EXEMPT_KINDS.contains(&kind) {
            continue;
        }
        let metadata = doc.get("metadata").filter(|meta| meta.is_object());
        let name = metadata
            .and_then(|meta| meta.get("name"))
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty());
        let Some(name) = name else { continue };
        let namespace = metadata
            .and_then(|meta| meta.get("namespace"))
            .and_then(Value::as_str)
            .filter(|namespace| !namespace.is_empty());
        let attributes = match namespace {
            Some(namespace) => json!({ "kind": kind, "name": name, "namespace": namespace }),
            None => json!({ "kind": kind, "name": name }),
        };
        out.push(json!({
            "name": format!(
                "auto-{}-{}-{}-probes",
                kind.to_lowercase(),
                namespace.unwrap_or("default"),
                name
            ),
            "policyType": "postureExceptionPolicy",
            "actions": ["alertOnly"],
            "resources": [{ "designatorType": "Attributes", "attributes": attributes }],
            "posturePolicies": [{ "controlID": "C-0056" }, { "controlID": "C-0018" }]
        }));
    }
    out
}

/// Конкатенований вміст усіх `*.yaml`/`*.yml` під каталогом — порт
/// `readAllYamlTextUnderDir` (`main.mjs:6740-6751`).
fn read_all_yaml_text_under_dir(dir: &Path) -> String {
    let mut parts = Vec::new();
    for rel in walk_dir(dir, &[]) {
        let lower = rel.to_ascii_lowercase();
        if !(lower.ends_with(".yaml") || lower.ends_with(".yml")) {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(dir.join(&rel)) {
            parts.push(raw);
        }
    }
    parts.join("\n---\n")
}

/// Користувацький `.kubescape-exceptions.json` як масив записів — порт
/// `readUserKubescapeExceptions` (`main.mjs:6758-6768`): будь-яка помилка
/// читання/парсингу або не-масив дають порожній список.
fn read_user_kubescape_exceptions(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| match value {
            Value::Array(items) => Some(items),
            _ => None,
        })
        .unwrap_or_default()
}

/// Аргументи `--exceptions` разом із тимчасовим каталогом, який тримає
/// згенерований файл, — порт `buildKubescapeExceptionsArgs`
/// (`main.mjs:6779-6791`) плюс `cleanupKubescapeExceptionsArgs`
/// (`main.mjs:6800-6804`): у Rust прибирання робить `Drop` на
/// [`tempfile::TempDir`], тож окремої функції-двійника немає.
fn build_kubescape_exceptions_args(
    root: &Path,
    auto_exceptions: Vec<Value>,
) -> (Vec<String>, Option<tempfile::TempDir>) {
    let user_file = root.join(KUBESCAPE_EXCEPTIONS_FILE);
    let user_file_exists = user_file.exists();
    if auto_exceptions.is_empty() {
        if user_file_exists {
            return (
                vec![
                    "--exceptions".to_string(),
                    user_file.to_string_lossy().into_owned(),
                ],
                None,
            );
        }
        return (Vec::new(), None);
    }
    let mut merged = if user_file_exists {
        read_user_kubescape_exceptions(&user_file)
    } else {
        Vec::new()
    };
    merged.extend(auto_exceptions);
    let Ok(dir) = tempfile::Builder::new()
        .prefix("nitra-cursor-k8s-exceptions-")
        .tempdir()
    else {
        return (Vec::new(), None);
    };
    let tmp_file = dir.path().join("kubescape-exceptions.json");
    if std::fs::write(
        &tmp_file,
        serde_json::to_string(&Value::Array(merged)).unwrap_or_else(|_| "[]".to_string()),
    )
    .is_err()
    {
        return (Vec::new(), None);
    }
    (
        vec![
            "--exceptions".to_string(),
            tmp_file.to_string_lossy().into_owned(),
        ],
        Some(dir),
    )
}

// ─── Спавн із wall-clock лімітом ─────────────────────────────────────────────

/// Результат одного спавна: exit-код, `ENOENT` і чи спрацював таймаут.
struct SpawnOutcome {
    status: i32,
    enoent: bool,
    timed_out: bool,
    stdout: String,
}

/// Чекає на дитину не довше `timeout`, інакше вбиває її — дзеркало
/// `spawnAsync(..., { timeoutMs })` (`npm/scripts/utils/spawn-async.mjs`).
fn wait_with_timeout(child: &mut Child, timeout: Duration) -> (i32, bool) {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return (status.code().unwrap_or(1), false),
            Ok(None) => {}
            Err(_) => return (1, false),
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return (1, true);
        }
        std::thread::sleep(CHILD_POLL_INTERVAL);
    }
}

/// Спавнить тул із таймаутом, ковтаючи вивід (`verbose` не проводиться).
fn spawn_with_timeout(bin: &Path, args: &[String], cwd: &Path) -> SpawnOutcome {
    let mut command = Command::new(bin);
    command
        .current_dir(cwd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.spawn() {
        Ok(mut child) => {
            let (status, timed_out) = wait_with_timeout(&mut child, KUBESCAPE_SCAN_TIMEOUT);
            SpawnOutcome {
                status,
                enoent: false,
                timed_out,
                stdout: String::new(),
            }
        }
        Err(error) => SpawnOutcome {
            status: 1,
            enoent: error.kind() == std::io::ErrorKind::NotFound,
            timed_out: false,
            stdout: String::new(),
        },
    }
}

/// `kubectl kustomize <dir>` із захопленням stdout — порт `runKustomizeBuild`
/// (`main.mjs:6843-6852`). Таймаут тут канон не ставить, тож і порт не ставить.
fn run_kustomize_build(kubectl: &Path, dir: &Path, cwd: &Path) -> SpawnOutcome {
    let output = Command::new(kubectl)
        .current_dir(cwd)
        .arg("kustomize")
        .arg(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(output) => SpawnOutcome {
            status: output.status.code().unwrap_or(1),
            enoent: false,
            timed_out: false,
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        },
        Err(_) => SpawnOutcome {
            status: 1,
            enoent: false,
            timed_out: false,
            stdout: String::new(),
        },
    }
}

/// Аргументи `kubescape scan` — порт спільної форми `runKubescapeManifest`
/// (`main.mjs:6876-6885`) і `scanRawK8sDir` (`main.mjs:6919-6928`).
fn kubescape_scan_args(target: &str, use_default: bool, exceptions_args: &[String]) -> Vec<String> {
    let mut args = vec![
        "scan".to_string(),
        target.to_string(),
        "--severity-threshold".to_string(),
        "high".to_string(),
        "--scan-timeout".to_string(),
        KUBESCAPE_SCAN_TIMEOUT_ARG.to_string(),
    ];
    if use_default {
        args.push("--use-default".to_string());
    }
    args.extend(exceptions_args.iter().cloned());
    args
}

/// Скан одного зібраного маніфеста — порт `runKubescapeManifest`
/// (`main.mjs:6865-6897`).
fn run_kubescape_manifest(
    kubescape: &Path,
    manifest: &str,
    root: &Path,
    use_default: bool,
) -> SpawnOutcome {
    let Ok(dir) = tempfile::Builder::new()
        .prefix("nitra-cursor-k8s-")
        .tempdir()
    else {
        return SpawnOutcome {
            status: 1,
            enoent: false,
            timed_out: false,
            stdout: String::new(),
        };
    };
    let file = dir.path().join("manifest.yaml");
    let (exceptions_args, _exceptions_dir) =
        build_kubescape_exceptions_args(root, auto_job_cronjob_probe_exceptions(manifest));
    if std::fs::File::create(&file)
        .and_then(|mut handle| handle.write_all(manifest.as_bytes()))
        .is_err()
    {
        return SpawnOutcome {
            status: 1,
            enoent: false,
            timed_out: false,
            stdout: String::new(),
        };
    }
    spawn_with_timeout(
        kubescape,
        &kubescape_scan_args(&file.to_string_lossy(), use_default, &exceptions_args),
        root,
    )
}

/// Скан сирого каталогу — порт `scanRawK8sDir` (`main.mjs:6910-6941`).
fn scan_raw_k8s_dir(kubescape: &Path, dir: &Path, root: &Path, use_default: bool) -> SpawnOutcome {
    let yaml_text = read_all_yaml_text_under_dir(dir);
    let (exceptions_args, _exceptions_dir) =
        build_kubescape_exceptions_args(root, auto_job_cronjob_probe_exceptions(&yaml_text));
    let mut outcome = spawn_with_timeout(
        kubescape,
        &kubescape_scan_args(&dir.to_string_lossy(), use_default, &exceptions_args),
        root,
    );
    // `catch (error) { if (ENOENT) return { status: 127 } }` — у канону
    // відсутній тул на raw-гілці дає саме 127, а не `enoent`-прапорець.
    if outcome.enoent {
        outcome.status = 127;
        outcome.enoent = false;
    }
    outcome
}

// ─── Оркестрація ─────────────────────────────────────────────────────────────

/// Один granular scan-таргет — порт елемента `collectKubescapeTargets`
/// (`main.mjs:6973-6984`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KubescapeTarget {
    /// `k8s`-корінь без жодного `kustomization.yaml` — сирий dir-скан.
    Raw(PathBuf),
    /// Каталог із `kustomization.yaml` — збірка `kubectl kustomize`.
    Kustomize(PathBuf),
}

/// Розгортає `k8s`-корені у granular-таргети — порт `collectKubescapeTargets`
/// (`main.mjs:6973-6984`).
pub(crate) fn collect_kubescape_targets(dirs: &[PathBuf]) -> Vec<KubescapeTarget> {
    let mut targets = Vec::new();
    for dir in dirs {
        let kustomization_dirs = find_kustomization_dirs(dir);
        if kustomization_dirs.is_empty() {
            targets.push(KubescapeTarget::Raw(dir.clone()));
        } else {
            targets.extend(
                kustomization_dirs
                    .into_iter()
                    .map(KubescapeTarget::Kustomize),
            );
        }
    }
    targets
}

/// Підсумок обходу всіх таргетів — порт значення, що його повертає
/// `runKubescape` (`main.mjs:6996-7027`).
#[derive(Debug, Clone)]
pub(crate) struct KubescapeRun {
    status: i32,
    target: Option<PathBuf>,
    timed_out: bool,
}

/// Резолв бінарників, які контур може смикнути.
struct KubescapeBins<'a> {
    kubescape: &'a Path,
    /// `kubectl` резолвиться **лениво**, рівно як у канону: raw-only репо
    /// його не потребує взагалі.
    resolve_kubectl: &'a dyn Fn() -> Option<PathBuf>,
}

/// Один kustomize-таргет — порт `scanKustomizeK8sDirs` на списку з одного
/// каталогу (`main.mjs:6953-6966`, як його кличе `runKubescape`).
fn scan_one_kustomize_dir(
    kubectl: &Path,
    kubescape: &Path,
    kdir: &Path,
    root: &Path,
    use_default: bool,
) -> KubescapeRun {
    let build = run_kustomize_build(kubectl, kdir, root);
    if build.status != 0 {
        return KubescapeRun {
            status: build.status,
            target: Some(kdir.to_path_buf()),
            timed_out: false,
        };
    }
    let scan = run_kubescape_manifest(kubescape, &build.stdout, root, use_default);
    if scan.enoent {
        return KubescapeRun {
            status: 127,
            target: Some(kdir.to_path_buf()),
            timed_out: false,
        };
    }
    KubescapeRun {
        status: scan.status,
        target: Some(kdir.to_path_buf()),
        timed_out: scan.timed_out,
    }
}

/// Оркеструє скан по всіх таргетах — порт `runKubescape`
/// (`main.mjs:6996-7027`). Перший ненульовий код перериває обхід.
fn run_kubescape(dirs: &[PathBuf], root: &Path, bins: &KubescapeBins<'_>) -> KubescapeRun {
    let targets = collect_kubescape_targets(dirs);
    let mut kubectl: Option<PathBuf> = None;
    let mut cache_ready = false;
    for target in &targets {
        match target {
            KubescapeTarget::Raw(dir) => {
                let outcome = scan_raw_k8s_dir(bins.kubescape, dir, root, cache_ready);
                if outcome.status != 0 {
                    return KubescapeRun {
                        status: outcome.status,
                        target: Some(dir.clone()),
                        timed_out: outcome.timed_out,
                    };
                }
            }
            KubescapeTarget::Kustomize(dir) => {
                if kubectl.is_none() {
                    let Some(found) = (bins.resolve_kubectl)() else {
                        return KubescapeRun {
                            status: 127,
                            target: Some(dir.clone()),
                            timed_out: false,
                        };
                    };
                    kubectl = Some(found);
                }
                let run = scan_one_kustomize_dir(
                    kubectl.as_deref().expect("щойно резолвлено"),
                    bins.kubescape,
                    dir,
                    root,
                    cache_ready,
                );
                if run.status != 0 {
                    return run;
                }
            }
        }
        cache_ready = true;
    }
    KubescapeRun {
        status: 0,
        target: None,
        timed_out: false,
    }
}

/// Резолв `kubectl` у `PATH` — порт `resolveCmd('kubectl')`
/// (`main.mjs:7010`). У реєстрі тулів `kubectl` немає, тож керований кеш тут
/// не при справах.
fn resolve_kubectl_in_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("kubectl"))
        .find(|candidate| candidate.is_file())
}

/// kubescape-гілка `lint()` — порт `main.mjs:6535-6546`.
pub fn kubescape_violations(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let dirs = find_k8s_roots(cwd, &ignore_paths);
    if dirs.is_empty() {
        return Ok(Vec::new());
    }
    let Some(kubescape) = resolve_provisioned_tool(TOOL_ID) else {
        return Err(RulesError::Concern(
            install_hint_for(TOOL_ID).unwrap_or_else(|| {
                format!("{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші бінарників.")
            }),
        ));
    };
    let bins = KubescapeBins {
        kubescape: &kubescape,
        resolve_kubectl: &resolve_kubectl_in_path,
    };
    let run = run_kubescape(&dirs, cwd, &bins);
    if run.status == 0 || run.status == 127 {
        return Ok(Vec::new());
    }
    let message = if run.timed_out {
        let target = run
            .target
            .as_deref()
            .map(|target| rel_posix_raw(cwd, target))
            .unwrap_or_default();
        format!("kubescape timeout: {target} (ліміт {KUBESCAPE_SCAN_TIMEOUT_LABEL})")
    } else {
        RISKS_MESSAGE.to_string()
    };
    Ok(vec![Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }])
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    #[test]
    fn kustomization_dirs_skip_component_kind() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - deploy.yaml\n",
        );
        write(
            &tmp,
            "k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - hpa.yaml\n",
        );
        let dirs = find_kustomization_dirs(tmp.path());
        assert_eq!(dirs, vec![tmp.path().join("k8s/base")]);
    }

    #[test]
    fn unparsable_kustomization_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/kustomization.yaml", "kind: [broken\n");
        assert!(find_kustomization_dirs(tmp.path()).is_empty());
    }

    #[test]
    fn auto_exceptions_cover_every_named_job_and_cronjob() {
        let yaml = "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: nightly\n  namespace: \
                    prod\n---\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: \
                    migrate\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n";
        let exceptions = auto_job_cronjob_probe_exceptions(yaml);
        assert_eq!(exceptions.len(), 2);
        assert_eq!(
            exceptions[0]["name"],
            json!("auto-cronjob-prod-nightly-probes")
        );
        assert_eq!(
            exceptions[0]["resources"][0]["attributes"]["namespace"],
            json!("prod")
        );
        assert_eq!(
            exceptions[1]["name"],
            json!("auto-job-default-migrate-probes")
        );
        assert_eq!(
            exceptions[1]["resources"][0]["attributes"].get("namespace"),
            None
        );
        assert_eq!(
            exceptions[0]["posturePolicies"],
            json!([{ "controlID": "C-0056" }, { "controlID": "C-0018" }])
        );
    }

    #[test]
    fn job_without_name_gets_no_exception() {
        let yaml = "apiVersion: batch/v1\nkind: Job\nmetadata:\n  labels:\n    app: x\n";
        assert!(auto_job_cronjob_probe_exceptions(yaml).is_empty());
    }

    #[test]
    fn exceptions_args_point_at_user_file_when_nothing_auto_generated() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".kubescape-exceptions.json", "[]");
        let (args, dir) = build_kubescape_exceptions_args(tmp.path(), Vec::new());
        assert!(dir.is_none());
        assert_eq!(args[0], "--exceptions");
        assert_eq!(
            PathBuf::from(&args[1]),
            tmp.path().join(".kubescape-exceptions.json")
        );
    }

    #[test]
    fn exceptions_args_are_empty_without_user_file_and_without_auto() {
        let tmp = TempDir::new().unwrap();
        let (args, dir) = build_kubescape_exceptions_args(tmp.path(), Vec::new());
        assert!(args.is_empty());
        assert!(dir.is_none());
    }

    #[test]
    fn auto_exceptions_merge_after_user_entries() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".kubescape-exceptions.json",
            r#"[{"name":"user-one"}]"#,
        );
        let (args, dir) =
            build_kubescape_exceptions_args(tmp.path(), vec![json!({ "name": "auto-one" })]);
        let _keep = dir.expect("tmp-каталог тримає згенерований файл");
        let merged: Value =
            serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
        assert_eq!(merged[0]["name"], json!("user-one"));
        assert_eq!(merged[1]["name"], json!("auto-one"));
    }

    #[test]
    fn broken_user_exceptions_file_degrades_to_auto_only() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".kubescape-exceptions.json", "{not json");
        let (args, dir) =
            build_kubescape_exceptions_args(tmp.path(), vec![json!({ "name": "auto-one" })]);
        let _keep = dir.expect("tmp-каталог тримає згенерований файл");
        let merged: Value =
            serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
        assert_eq!(merged.as_array().unwrap().len(), 1);
        assert_eq!(merged[0]["name"], json!("auto-one"));
    }

    #[test]
    fn scan_args_add_use_default_only_after_first_target() {
        let first = kubescape_scan_args("/tmp/x.yaml", false, &[]);
        assert!(!first.contains(&"--use-default".to_string()));
        let later = kubescape_scan_args("/tmp/x.yaml", true, &[]);
        assert_eq!(
            later,
            vec![
                "scan",
                "/tmp/x.yaml",
                "--severity-threshold",
                "high",
                "--scan-timeout",
                "5m",
                "--use-default"
            ]
        );
    }

    #[test]
    fn targets_are_raw_when_tree_has_no_kustomization() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/deploy.yaml", "kind: Deployment\n");
        let root = tmp.path().join("k8s");
        assert_eq!(
            collect_kubescape_targets(std::slice::from_ref(&root)),
            vec![KubescapeTarget::Raw(root)]
        );
    }

    #[test]
    fn targets_are_per_kustomization_dir_otherwise() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/kustomization.yaml", "kind: Kustomization\n");
        write(&tmp, "k8s/prod/kustomization.yaml", "kind: Kustomization\n");
        let root = tmp.path().join("k8s");
        assert_eq!(
            collect_kubescape_targets(&[root]),
            vec![
                KubescapeTarget::Kustomize(tmp.path().join("k8s/base")),
                KubescapeTarget::Kustomize(tmp.path().join("k8s/prod")),
            ]
        );
    }

    #[test]
    fn empty_repo_needs_no_tool_at_all() {
        let tmp = TempDir::new().unwrap();
        assert!(kubescape_violations(tmp.path()).unwrap().is_empty());
    }

    /// Кладе у `dir` виконуваний shell-скрипт із заданим кодом виходу.
    #[cfg(unix)]
    fn fake_bin(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn nonzero_kubescape_on_raw_target_stops_the_walk() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/deploy.yaml", "kind: Deployment\n");
        let bin_dir = TempDir::new().unwrap();
        let kubescape = fake_bin(bin_dir.path(), "kubescape", "exit 3");
        let run = run_kubescape(
            &[tmp.path().join("k8s")],
            tmp.path(),
            &KubescapeBins {
                kubescape: &kubescape,
                resolve_kubectl: &|| None,
            },
        );
        assert_eq!(run.status, 3);
        assert_eq!(
            run.target.as_deref(),
            Some(tmp.path().join("k8s").as_path())
        );
    }

    #[cfg(unix)]
    #[test]
    fn missing_kubectl_yields_skip_code_127() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/kustomization.yaml", "kind: Kustomization\n");
        let bin_dir = TempDir::new().unwrap();
        let kubescape = fake_bin(bin_dir.path(), "kubescape", "exit 0");
        let run = run_kubescape(
            &[tmp.path().join("k8s")],
            tmp.path(),
            &KubescapeBins {
                kubescape: &kubescape,
                resolve_kubectl: &|| None,
            },
        );
        assert_eq!(run.status, 127);
    }

    #[cfg(unix)]
    #[test]
    fn kustomize_build_failure_is_reported_with_its_own_code() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/kustomization.yaml", "kind: Kustomization\n");
        let bin_dir = TempDir::new().unwrap();
        let kubescape = fake_bin(bin_dir.path(), "kubescape", "exit 0");
        let kubectl = fake_bin(bin_dir.path(), "kubectl", "exit 7");
        let run = run_kubescape(
            &[tmp.path().join("k8s")],
            tmp.path(),
            &KubescapeBins {
                kubescape: &kubescape,
                resolve_kubectl: &|| Some(kubectl.clone()),
            },
        );
        assert_eq!(run.status, 7);
        assert!(!run.timed_out);
    }

    #[cfg(unix)]
    #[test]
    fn clean_walk_over_two_kustomize_targets_returns_zero() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/kustomization.yaml", "kind: Kustomization\n");
        write(&tmp, "k8s/prod/kustomization.yaml", "kind: Kustomization\n");
        let bin_dir = TempDir::new().unwrap();
        let kubescape = fake_bin(bin_dir.path(), "kubescape", "exit 0");
        let kubectl = fake_bin(bin_dir.path(), "kubectl", "echo 'kind: Deployment'");
        let run = run_kubescape(
            &[tmp.path().join("k8s")],
            tmp.path(),
            &KubescapeBins {
                kubescape: &kubescape,
                resolve_kubectl: &|| Some(kubectl.clone()),
            },
        );
        assert_eq!(run.status, 0);
        assert!(run.target.is_none());
    }
}
