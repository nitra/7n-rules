//! Native-порт `k8s/kubeconform` (`npm/rules/k8s/kubeconform/main.mjs`) —
//! read-only schema-валідація маніфестів зовнішнім тулом `kubeconform`.
//!
//! Перший native-концерн, що спавнить зовнішній лінт-тул: до нього
//! `std::process::Command` у `rules-core` вживався лише для `git`
//! (`changed_base`/`changed_files`/`worktree`). Тулова частина
//! (`ensureTool`-дзеркало) винесена в [`crate::tool_resolve`].
//!
//! # Що саме портовано
//!
//! `lint(ctx)` (`main.mjs:21-39`) + `runKubeconform`
//! (`k8s/manifests/main.mjs:6820-6843`):
//!
//! - `ctx.files === undefined` (full-режим) → цілі = `findK8sRoots`
//!   ([`super::k8s_common::find_k8s_roots`]) з урахуванням `.cursorignore`;
//! - інакше (дельта) → цілі = ті з `ctx.files`, що матчать `/\.ya?ml$/`
//!   (з урахуванням регістру — саме такий `YAML_EXT_RE` у `kubeconform/main.mjs:14`,
//!   на відміну від фільтра `findK8sYamlFiles`, що регістр ігнорує);
//! - порожній список цілей → 0 violations без спавна;
//! - exit-код `0` або `127` → 0 violations; будь-який інший → одна violation
//!   з `reason = "kubeconform"`.
//!
//! # Аргументи й версії — частина паритету
//!
//! Набір прапорців і **пін версії Kubernetes** (`KUBERNETES_VERSION`,
//! `k8s/manifests/main.mjs:6810`) відтворені буквально: інша версія схем =
//! інший вислід валідації, тож пін дублюється тут як константа і покритий
//! тестом-«стражем» ([`tests::kubeconform_args_match_js_canon`]).
//!
//! # Тул відсутній → делегування, а не пропуск
//!
//! Якщо `kubeconform` не резолвиться (`PATH` + керований кеш —
//! [`crate::tool_resolve::resolve_provisioned_tool`]), концерн повертає
//! [`RulesError::NativeDelegate`], і JS-диспетчер перезапускає його на
//! `main.mjs`, де `ensureTool` доводить встановлення до кінця. Пропуск
//! (0 violations) тут був би fail-open: на ефемерному CI-раннері кеш
//! бінарників порожній щоразу, тобто schema-валідація мовчки перестала б
//! виконуватись. Докладніше — доккомент [`super::NATIVE_DELEGATING_CONCERNS`].

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_roots;
use crate::diagnostics::{Severity, Violation};
use crate::tool_resolve::resolve_provisioned_tool;
use crate::RulesError;

/// `toolId` у реєстрі `TOOLS` (`ensure-tool.mjs`) і водночас ім'я бінарника.
const TOOL_ID: &str = "kubeconform";

/// Пін версії Kubernetes для набору схем — дзеркало `KUBERNETES_VERSION`
/// (`k8s/manifests/main.mjs:6810`), узгоджений із `YANNH_PIN` у `k8s.mdc`.
const KUBERNETES_VERSION: &str = "1.33.9";

/// Шаблон розташування схем CRD — дзеркало `DATREE_CRD_SCHEMA_LOCATION`
/// (`k8s/manifests/main.mjs:6811-6812`).
const DATREE_CRD_SCHEMA_LOCATION: &str =
    "https://datreeio.github.io/CRDs-catalog/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json";

/// Стабільний machine code violation-а — другий аргумент `fail(...)`
/// (`kubeconform/main.mjs:36`).
const REASON: &str = "kubeconform";

/// Текст violation-а — буквально той самий рядок, що в JS-версії.
const VIOLATION_MESSAGE: &str = "kubeconform знайшов невалідні маніфести (k8s.mdc)";

/// Чи є рядок цілі YAML-шляхом за `YAML_EXT_RE` (`kubeconform/main.mjs:14`).
/// З урахуванням регістру — на відміну від `YAML_EXTENSION_RE` у `k8s/manifests`
/// (там прапорець `i`); розходження навмисне збережене.
fn is_delta_yaml_target(rel: &str) -> bool {
    rel.ends_with(".yaml") || rel.ends_with(".yml")
}

/// Аргументи виклику `kubeconform` — порт `runKubeconform`
/// (`k8s/manifests/main.mjs:6821-6831`). Винесено окремо, щоб тест міг
/// звірити їх без спавна.
fn kubeconform_args(targets: &[String]) -> Vec<String> {
    let mut args = vec![
        "-summary".to_string(),
        "-kubernetes-version".to_string(),
        KUBERNETES_VERSION.to_string(),
        "-schema-location".to_string(),
        "default".to_string(),
        "-schema-location".to_string(),
        DATREE_CRD_SCHEMA_LOCATION.to_string(),
        "-ignore-missing-schemas".to_string(),
    ];
    args.extend(targets.iter().cloned());
    args
}

/// Прогін `kubeconform` — порт `runKubeconform`
/// (`k8s/manifests/main.mjs:6820-6843`). Повертає exit-код; `127` — тул
/// зник між резолвом і спавном (гонка), `1` — будь-який інший збій самого
/// спавна, як і `catch` у JS-версії.
///
/// `current_dir(cwd)` виставляється явно. JS не передає `cwd` у `spawnAsync`,
/// тобто дитина успадковує `process.cwd()` лінт-процесу; для `lint` це і є
/// корінь репо (`ctx.cwd`), тож relative-цілі дельта-режиму резолвляться
/// однаково — але явний `current_dir` робить це властивістю коду, а не
/// збігом оточення.
fn run_kubeconform(bin: &Path, cwd: &Path, targets: &[String], verbose: bool) -> i32 {
    let mut command = Command::new(bin);
    command.current_dir(cwd).args(kubeconform_args(targets));
    if verbose {
        // `stdio: 'inherit'` у JS-версії — повний нативний вивід тула.
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }
    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 127,
        Err(_) => 1,
    }
}

/// Detector `k8s/kubeconform` — точний порт `lint(ctx)`
/// (`kubeconform/main.mjs:21-39`).
pub fn k8s_kubeconform(
    cwd: &Path,
    files: Option<&[String]>,
    verbose: bool,
) -> Result<Vec<Violation>, RulesError> {
    k8s_kubeconform_with(cwd, files, verbose, &resolve_provisioned_tool)
}

/// Тіло детектора з інжектованим пошуком бінарника.
///
/// Інжекція потрібна тестам: підміняти процес-глобальний `PATH` не можна —
/// у тому ж тест-процесі паралельно біжать тести, що спавнять `git`
/// (`worktree`/`changed_files`), і така підміна валила б їх випадковим чином.
fn k8s_kubeconform_with(
    cwd: &Path,
    files: Option<&[String]>,
    verbose: bool,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<Vec<Violation>, RulesError> {
    let targets: Vec<String> = match files {
        None => {
            let ignore_paths = load_cursor_ignore_paths(cwd);
            find_k8s_roots(cwd, &ignore_paths)
                .into_iter()
                .map(|p: PathBuf| p.to_string_lossy().into_owned())
                .collect()
        }
        Some(list) => list
            .iter()
            .filter(|f| is_delta_yaml_target(f))
            .cloned()
            .collect(),
    };
    if targets.is_empty() {
        return Ok(Vec::new());
    }

    let Some(bin) = resolve_tool(TOOL_ID) else {
        return Err(RulesError::NativeDelegate(format!(
            "{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші — встановлення лишається за JS-каноном (ensureTool)"
        )));
    };

    let code = run_kubeconform(&bin, cwd, &targets, verbose);
    if code == 0 || code == 127 {
        return Ok(Vec::new());
    }
    Ok(vec![Violation {
        reason: REASON.to_string(),
        message: VIOLATION_MESSAGE.to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    }])
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    /// Кладе у `dir` виконуваний shell-скрипт `kubeconform`, що завершується
    /// з кодом `exit_code`, і повертає шлях до нього.
    #[cfg(unix)]
    fn fake_kubeconform(dir: &Path, exit_code: i32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join(TOOL_ID);
        fs::write(&bin, format!("#!/bin/sh\nexit {exit_code}\n")).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, що завжди повертає заданий шлях (тул «встановлено»).
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Резолвер, що не знаходить нічого (тул «не встановлено»).
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let abs = root.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(abs, body).unwrap();
    }

    /// Аргументи мають збігатися з JS-каноном рядок-у-рядок, включно з піном
    /// версії Kubernetes: розбіжність = інший набір схем = інший вислід.
    #[test]
    fn kubeconform_args_match_js_canon() {
        assert_eq!(
            kubeconform_args(&["/repo/k8s".to_string()]),
            vec![
                "-summary",
                "-kubernetes-version",
                "1.33.9",
                "-schema-location",
                "default",
                "-schema-location",
                "https://datreeio.github.io/CRDs-catalog/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json",
                "-ignore-missing-schemas",
                "/repo/k8s",
            ]
        );
    }

    /// Дельта-фільтр `YAML_EXT_RE` враховує регістр (`.YAML` не проходить).
    #[test]
    fn delta_target_filter_is_case_sensitive() {
        assert!(is_delta_yaml_target("k8s/base/deploy.yaml"));
        assert!(is_delta_yaml_target("k8s/base/svc.yml"));
        assert!(!is_delta_yaml_target("k8s/base/deploy.YAML"));
        assert!(!is_delta_yaml_target("k8s/base/deploy.json"));
    }

    /// Порожній список цілей → 0 violations і жодного спавна. Резолвер тут
    /// «нічого не знаходить», і саме тому тест доводить, що до нього навіть не
    /// дійшло (інакше було б делегування).
    #[test]
    fn no_targets_returns_no_violations_without_spawn() {
        let tmp = TempDir::new().unwrap();
        assert!(
            k8s_kubeconform_with(tmp.path(), Some(&[]), false, &resolver_missing)
                .unwrap()
                .is_empty()
        );
        // full-режим на дереві без k8s — так само порожньо.
        assert!(
            k8s_kubeconform_with(tmp.path(), None, false, &resolver_missing)
                .unwrap()
                .is_empty()
        );
    }

    /// exit 0 → 0 violations.
    #[cfg(unix)]
    #[test]
    fn exit_zero_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_kubeconform(&tmp.path().join("bin"), 0);
        let repo = tmp.path().join("repo");
        write(&repo, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        assert!(
            k8s_kubeconform_with(&repo, None, false, &resolver_found(bin))
                .unwrap()
                .is_empty()
        );
    }

    /// Ненульовий exit (окрім 127) → рівно одна violation з reason `kubeconform`.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_gives_single_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_kubeconform(&tmp.path().join("bin"), 1);
        let repo = tmp.path().join("repo");
        write(&repo, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");

        let violations = k8s_kubeconform_with(&repo, None, false, &resolver_found(bin)).unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "kubeconform");
        assert_eq!(violations[0].message, VIOLATION_MESSAGE);
        assert!(violations[0].file.is_none());
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// exit 127 трактується як SKIP, не violation — той самий особливий код,
    /// що й у JS (`code !== 0 && code !== 127`).
    #[cfg(unix)]
    #[test]
    fn exit_127_is_skip_not_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_kubeconform(&tmp.path().join("bin"), 127);
        let repo = tmp.path().join("repo");
        write(&repo, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        assert!(
            k8s_kubeconform_with(&repo, None, false, &resolver_found(bin))
                .unwrap()
                .is_empty()
        );
    }

    /// Бінарник зник із диска між резолвом і спавном → `Command::status` дає
    /// `NotFound`, що мапиться в 127 → SKIP, як `error.code === 'ENOENT'` у JS.
    #[test]
    fn vanished_binary_maps_to_skip() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("repo");
        write(&repo, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let ghost = tmp.path().join("nowhere").join(TOOL_ID);
        assert!(
            k8s_kubeconform_with(&repo, None, false, &resolver_found(ghost))
                .unwrap()
                .is_empty()
        );
    }

    /// Тула немає, але цілі є → делегування JS-канону (а НЕ мовчазний пропуск).
    #[test]
    fn missing_tool_delegates_instead_of_skipping() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("repo");
        write(&repo, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");

        let err = k8s_kubeconform_with(&repo, None, false, &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::NativeDelegate(_)));
        assert!(err.to_string().starts_with(crate::NATIVE_DELEGATE_MARKER));
    }

    /// Дельта-режим бере саме відфільтровані `ctx.files`, а не знайдені корені:
    /// не-YAML відкидається, і якщо після фільтра порожньо — спавна немає взагалі.
    #[test]
    fn delta_mode_filters_non_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["k8s/README.md".to_string(), "package.json".to_string()];
        assert!(
            k8s_kubeconform_with(tmp.path(), Some(&files), false, &resolver_missing)
                .unwrap()
                .is_empty()
        );
    }

    /// Дельта-режим із YAML у списку доходить до резолву тула — доказ, що
    /// фільтр не з'їдає валідні цілі (тул відсутній → делегування).
    #[test]
    fn delta_mode_keeps_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["k8s/base/deploy.yaml".to_string()];
        let err =
            k8s_kubeconform_with(tmp.path(), Some(&files), false, &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::NativeDelegate(_)));
    }
}
