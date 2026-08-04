//! Native-порт `k8s/kubeconform` (`npm/rules/k8s/kubeconform/main.mjs`) —
//! read-only schema-валідація маніфестів зовнішнім тулом `kubeconform`.
//!
//! Перший native-концерн, що спавнить зовнішній лінт-тул: до нього
//! `std::process::Command` у `rules-core` вживався лише для `git`
//! (`changed_base`/`changed_files`/`worktree`). Резолв тула винесений у
//! [`crate::tool_resolve`].
//!
//! # Що саме портовано
//!
//! `lint(ctx)` (`main.mjs:21-39`) + `runKubeconform`
//! (`k8s/manifests/main.mjs:6820-6843`):
//!
//! - `ctx.files === undefined` (full-режим) → цілі = `findK8sRoots`
//!   ([`super::k8s_common::find_k8s_roots`]) з урахуванням `.cursorignore`;
//! - інакше (дельта) → цілі = ті з `ctx.files`, що матчать `/\.ya?ml$/`
//!   (з урахуванням регістру — саме такий `YAML_EXT_RE` у
//!   `kubeconform/main.mjs:14`);
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
//! # Тул відсутній → fail-closed
//!
//! Якщо `kubeconform` не резолвиться (`PATH` + керований кеш —
//! [`crate::tool_resolve::resolve_provisioned_tool`]), концерн повертає
//! [`RulesError::Concern`] з per-OS install-підказкою, і прогін падає
//! (exit 2). Це рівно чинний режим `N_CURSOR_NO_AUTO_INSTALL` JS-канону, а
//! не нова поведінка: `rules-core` не встановлює тулів (доккомент
//! [`crate::tool_resolve`]), а добування переїжджає в окрему команду
//! `tools ensure` (окремий зріз міграції). Мовчазний пропуск був би
//! fail-open — на ефемерному CI-раннері перевірка просто зникла б.
//!
//! # `verbose` не проводиться
//!
//! У JS `ctx.verbose` керує лише тим, чи видно сирий вивід тула
//! (`stdio: 'inherit'`) — на набір violations він не впливає. Контракт
//! [`super::run_concern`] його не переносить, і заводити його заради одного
//! концерну не варто (Р12: поверхня не росте), тож native-шлях завжди
//! ковтає вивід `kubeconform`. Свідома, задокументована різниця.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_roots;
use crate::diagnostics::{Severity, Violation};
use crate::tool_registry::install_hint_for;
use crate::tool_resolve::resolve_provisioned_tool;
use crate::RulesError;

/// `toolId` у спільному реєстрі тулів (`npm/scripts/lib/tools.json`) і
/// водночас імʼя бінарника. Поля install-підказки (brew/scoop/github) беруться
/// з того самого реєстру ([`crate::tool_registry::install_hint_for`]), а не
/// дублюються тут константами.
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
fn run_kubeconform(bin: &Path, cwd: &Path, targets: &[String]) -> i32 {
    let mut command = Command::new(bin);
    command
        .current_dir(cwd)
        .args(kubeconform_args(targets))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 127,
        Err(_) => 1,
    }
}

/// Detector `k8s/kubeconform` — порт `lint(ctx)`
/// (`kubeconform/main.mjs:21-39`).
pub fn k8s_kubeconform(cwd: &Path, files: Option<&[String]>) -> Result<Vec<Violation>, RulesError> {
    k8s_kubeconform_with(cwd, files, &resolve_provisioned_tool)
}

/// Тіло детектора з інжектованим пошуком бінарника.
///
/// Інжекція потрібна тестам: підміняти процес-глобальний `PATH` не можна —
/// у тому ж тест-процесі паралельно біжать тести, що спавнять `git`
/// (`worktree`/`changed_files`), і така підміна валила б їх випадковим чином.
fn k8s_kubeconform_with(
    cwd: &Path,
    files: Option<&[String]>,
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
        // Тул є в реєстрі за конструкцією (тест `kubeconform_is_in_registry`),
        // тож fallback лишається на випадок майбутнього переїзду ключа.
        return Err(RulesError::Concern(
            install_hint_for(TOOL_ID).unwrap_or_else(|| {
                format!("{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші бінарників.")
            }),
        ));
    };

    let code = run_kubeconform(&bin, cwd, &targets);
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
    use crate::concerns::test_support::write;

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

    /// Концерн бере install-підказку зі спільного реєстру тулів, тож ключ
    /// мусить там бути — інакше fail-closed гілка деградує до загального
    /// тексту без жодного маршруту встановлення.
    #[test]
    fn kubeconform_is_in_registry() {
        let hint = crate::tool_registry::install_hint_for(TOOL_ID).unwrap();
        assert!(hint.contains("Встанови:"), "{hint}");
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
    /// дійшло (інакше був би fail-closed).
    #[test]
    fn no_targets_returns_no_violations_without_spawn() {
        let tmp = TempDir::new().unwrap();
        assert!(
            k8s_kubeconform_with(tmp.path(), Some(&[]), &resolver_missing)
                .unwrap()
                .is_empty()
        );
        // full-режим на дереві без k8s — так само порожньо.
        assert!(k8s_kubeconform_with(tmp.path(), None, &resolver_missing)
            .unwrap()
            .is_empty());
    }

    /// exit 0 → 0 violations.
    #[cfg(unix)]
    #[test]
    fn exit_zero_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_kubeconform(&tmp.path().join("bin"), 0);
        write(&tmp, "repo/svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let repo = tmp.path().join("repo");
        assert!(k8s_kubeconform_with(&repo, None, &resolver_found(bin))
            .unwrap()
            .is_empty());
    }

    /// Ненульовий exit (окрім 127) → рівно одна violation з reason `kubeconform`.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_gives_single_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_kubeconform(&tmp.path().join("bin"), 1);
        write(&tmp, "repo/svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let repo = tmp.path().join("repo");

        let violations = k8s_kubeconform_with(&repo, None, &resolver_found(bin)).unwrap();
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
        write(&tmp, "repo/svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let repo = tmp.path().join("repo");
        assert!(k8s_kubeconform_with(&repo, None, &resolver_found(bin))
            .unwrap()
            .is_empty());
    }

    /// Бінарник зник із диска між резолвом і спавном → `Command::status` дає
    /// `NotFound`, що мапиться в 127 → SKIP, як `error.code === 'ENOENT'` у JS.
    #[test]
    fn vanished_binary_maps_to_skip() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "repo/svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let repo = tmp.path().join("repo");
        let ghost = tmp.path().join("nowhere").join(TOOL_ID);
        assert!(k8s_kubeconform_with(&repo, None, &resolver_found(ghost))
            .unwrap()
            .is_empty());
    }

    /// Тула немає, але цілі є → fail-closed помилка з install-підказкою
    /// (а НЕ мовчазний пропуск, який був би fail-open).
    #[test]
    fn missing_tool_fails_closed_with_install_hint() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "repo/svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        let repo = tmp.path().join("repo");

        let err = k8s_kubeconform_with(&repo, None, &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        let text = err.to_string();
        assert!(text.contains(TOOL_ID), "{text}");
        assert!(text.contains("Встанови:"), "{text}");
    }

    /// Дельта-режим бере саме відфільтровані `ctx.files`, а не знайдені корені:
    /// не-YAML відкидається, і якщо після фільтра порожньо — спавна немає взагалі.
    #[test]
    fn delta_mode_filters_non_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["k8s/README.md".to_string(), "package.json".to_string()];
        assert!(
            k8s_kubeconform_with(tmp.path(), Some(&files), &resolver_missing)
                .unwrap()
                .is_empty()
        );
    }

    /// Дельта-режим із YAML у списку доходить до резолву тула — доказ, що
    /// фільтр не зʼїдає валідні цілі (тул відсутній → fail-closed).
    #[test]
    fn delta_mode_keeps_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["k8s/base/deploy.yaml".to_string()];
        let err = k8s_kubeconform_with(tmp.path(), Some(&files), &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }
}
