//! Native-порт `runConftestBatch` (`npm/scripts/lib/run-conftest-batch.mjs`) —
//! один спавн `conftest test` на пару (`policyDir`, `namespace`), незалежно від
//! кількості файлів, із розбором `--output json`.
//!
//! # Навіщо окремий модуль
//!
//! Архітектура кластера `k8s` — **Rego-authoritative**: пер-документні
//! структурні правила живуть у rego-пакетах (`npm/rules/<rule>/<concern>/*.rego`),
//! а JS/native робить лише cross-file gating (обхід дерева, парність,
//! kustomize-резолюція). Порт концерну, що спирається на rego, **не** означає
//! порт самого rego в Rust: це подвоїло б канон і повернуло рівно той дрейф
//! JS↔rego, заради усунення якого полісі й винесли (доккомент
//! `run-conftest-batch.mjs:1-11`). Тому native-бік дзеркалить *виклик*
//! conftest, а не його зміст — і цей модуль стає спільною базою для всіх
//! rego-концернів кластера, що будуть портовані далі.
//!
//! # Відмінності від JS-канону — свідомі й вужчі
//!
//! - **`--data <tmpfile>` (`templateData`) не портується.** З rego-концернів
//!   k8s його вживає лише `k8s.base_manifest` усередині концерну
//!   `k8s/manifests`, який
//!   у цьому зрізі не портується; заводити гілку без споживача — поверхня, що
//!   мовчки розійдеться з каноном (той самий мотив, що в доккоменті
//!   `concerns::k8s_common`). Приїде разом із концерном, що її кличе.
//! - **`extraArgs` (`--combine`) не портується** — з тієї ж причини.
//! - **Тул не резолвиться → fail-closed** із per-OS install-підказкою, замість
//!   `ensureToolAsync` (авто-встановлення). Це рівно чинний режим
//!   `N_CURSOR_NO_AUTO_INSTALL` JS-канону і той самий контракт, який уже
//!   зафіксував `k8s/kubeconform` (доккомент [`crate::tool_resolve`]):
//!   `rules-core` лишається офлайновим ядром, добування тулів переїжджає в
//!   окрему команду `tools ensure`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use crate::tool_resolve::{install_hint, resolve_provisioned_tool};
use crate::RulesError;

/// `toolId` у реєстрі `TOOLS` (`ensure-tool.mjs:174-179`) і водночас ім'я
/// бінарника.
const TOOL_ID: &str = "conftest";

/// Поля запису `TOOLS.conftest` (`ensure-tool.mjs:175-177`), потрібні
/// install-підказці fail-closed гілки.
const TOOL_BREW: &str = "conftest";
const TOOL_SCOOP: &str = "conftest";
const TOOL_GITHUB: &str = "open-policy-agent/conftest";

/// Одне порушення rego-полісі — Rust-відповідник `ConftestViolation`
/// (`run-conftest-batch.mjs:36-40`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConftestViolation {
    /// Абсолютний шлях файлу, що дав порушення (як його віддав conftest).
    pub filename: String,
    /// Namespace rego-пакета.
    pub namespace: String,
    /// Текст порушення (`msg` правила `deny`).
    pub message: String,
}

/// Форма одного запису масиву `conftest --output json`.
#[derive(Debug, Deserialize)]
struct ConftestEntry {
    #[serde(default)]
    filename: String,
    #[serde(default)]
    namespace: String,
    #[serde(default)]
    failures: Vec<ConftestFailure>,
}

/// Один `failures[]`-запис.
#[derive(Debug, Deserialize)]
struct ConftestFailure {
    #[serde(default)]
    msg: String,
}

/// Аргументи виклику — порт `buildConftestArgs` (`run-conftest-batch.mjs:62-67`)
/// без гілок `--data`/`extraArgs` (доккомент модуля). Винесено окремо, щоб тест
/// міг звірити розкладку без спавна: порядок «files ДО `-p`» — частина
/// паритету, conftest розрізняє позиційні цілі й прапорці.
fn conftest_args(policy_abs: &Path, namespace: &str, files: &[PathBuf]) -> Vec<String> {
    let mut args = vec!["test".to_string()];
    args.extend(files.iter().map(|f| f.to_string_lossy().into_owned()));
    args.push("-p".to_string());
    args.push(policy_abs.to_string_lossy().into_owned());
    args.push("--namespace".to_string());
    args.push(namespace.to_string());
    args.push("--output".to_string());
    args.push("json".to_string());
    args.push("--no-color".to_string());
    args
}

/// Розбирає stdout conftest у плаский список порушень — порт циклу
/// `run-conftest-batch.mjs:120-127`. Порядок зберігається (він визначає
/// порядок violations у виводі лінту).
fn parse_conftest_stdout(stdout: &str) -> Result<Vec<ConftestViolation>, RulesError> {
    let entries: Vec<ConftestEntry> = serde_json::from_str(stdout).map_err(|_| {
        let head: String = stdout.chars().take(200).collect();
        RulesError::Concern(format!("conftest stdout не парситься як JSON: {head}"))
    })?;
    Ok(entries
        .into_iter()
        .flat_map(|entry| {
            let (filename, namespace) = (entry.filename, entry.namespace);
            entry
                .failures
                .into_iter()
                .map(move |failure| ConftestViolation {
                    filename: filename.clone(),
                    namespace: namespace.clone(),
                    message: failure.msg,
                })
        })
        .collect())
}

/// Виконує `conftest test` для всіх `files` одним спавном — порт
/// `runConftestBatch` (`run-conftest-batch.mjs:76-131`).
///
/// - порожній `files` → `Ok(vec![])` без спавна;
/// - `policy_abs` не існує → [`RulesError::Concern`] (той самий hard-fail, що
///   `throw` у JS: мовчки пропустити відсутню полісі — fail-open);
/// - `conftest` не резолвиться → [`RulesError::Concern`] з install-підказкою;
/// - exit `0`/`1` — штатно (1 = «є failures»); будь-який інший — помилка.
pub fn run_conftest_batch(
    policy_abs: &Path,
    namespace: &str,
    files: &[PathBuf],
) -> Result<Vec<ConftestViolation>, RulesError> {
    run_conftest_batch_with(policy_abs, namespace, files, &resolve_provisioned_tool)
}

/// Тіло [`run_conftest_batch`] з інжектованим резолвом бінарника — та сама
/// інжекція, що в `concerns::k8s_kubeconform`: підміняти процес-глобальний
/// `PATH` не можна, бо в тому ж тест-процесі паралельно біжать тести, що
/// спавнять `git`.
pub(crate) fn run_conftest_batch_with(
    policy_abs: &Path,
    namespace: &str,
    files: &[PathBuf],
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<Vec<ConftestViolation>, RulesError> {
    if files.is_empty() {
        return Ok(Vec::new());
    }
    if !policy_abs.exists() {
        return Err(RulesError::Concern(format!(
            "run_conftest_batch: rego-каталог не знайдено: {}",
            policy_abs.display()
        )));
    }
    let Some(bin) = resolve_tool(TOOL_ID) else {
        return Err(RulesError::Concern(install_hint(
            TOOL_ID,
            TOOL_BREW,
            Some(TOOL_SCOOP),
            TOOL_GITHUB,
        )));
    };

    let output = Command::new(&bin)
        .args(conftest_args(policy_abs, namespace, files))
        .output()
        .map_err(|error| {
            RulesError::Concern(format!("conftest не вдалося запустити ({bin:?}): {error}"))
        })?;

    // exit 1 = «є failures» (валідний для нас результат); >1 або смерть від
    // сигналу — справжня помилка, як і в JS-версії.
    let code = output.status.code();
    if code != Some(0) && code != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail: String = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        }
        .chars()
        .take(500)
        .collect();
        return Err(RulesError::Concern(format!(
            "conftest exit {}: {detail}",
            code.map_or_else(|| "signal".to_string(), |c| c.to_string())
        )));
    }

    parse_conftest_stdout(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Резолвер, що не знаходить нічого (тул «не встановлено»).
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    /// Кладе виконуваний стаб `conftest`, що друкує `stdout` і виходить з
    /// `exit_code`, і повертає шлях до нього.
    #[cfg(unix)]
    fn fake_conftest(dir: &Path, exit_code: i32, stdout: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join(TOOL_ID);
        // heredoc із quoted-роздільником — жодних підстановок усередині JSON.
        fs::write(
            &bin,
            format!("#!/bin/sh\ncat <<'N_EOF'\n{stdout}\nN_EOF\nexit {exit_code}\n"),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, що завжди повертає заданий шлях.
    #[cfg(unix)]
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Розкладка аргументів — рядок-у-рядок за `buildConftestArgs`: цілі ДО
    /// `-p`, далі `--namespace`, `--output json`, `--no-color`.
    #[test]
    fn args_match_js_canon_layout() {
        let args = conftest_args(
            Path::new("/pkg/rules/k8s/hasura_configmap"),
            "k8s.hasura_configmap",
            &[PathBuf::from("/repo/k8s/base/configmap.yaml")],
        );
        assert_eq!(
            args,
            vec![
                "test",
                "/repo/k8s/base/configmap.yaml",
                "-p",
                "/pkg/rules/k8s/hasura_configmap",
                "--namespace",
                "k8s.hasura_configmap",
                "--output",
                "json",
                "--no-color",
            ]
        );
    }

    /// Порожній список файлів → 0 порушень без спавна. Резолвер тут «нічого не
    /// знаходить» — саме тому тест доводить, що до нього навіть не дійшло.
    #[test]
    fn empty_files_returns_empty_without_spawn() {
        assert_eq!(
            run_conftest_batch_with(Path::new("/nope"), "k8s.x", &[], &resolver_missing).unwrap(),
            Vec::new()
        );
    }

    /// Відсутній rego-каталог → hard error (мовчазний пропуск був би fail-open).
    #[test]
    fn missing_policy_dir_is_error() {
        let tmp = TempDir::new().unwrap();
        let err = run_conftest_batch_with(
            &tmp.path().join("nope"),
            "k8s.x",
            &[PathBuf::from("/repo/a.yaml")],
            &resolver_missing,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("rego-каталог не знайдено"),
            "{err}"
        );
    }

    /// Тула немає, але файли є → fail-closed із install-підказкою.
    #[test]
    fn missing_tool_fails_closed_with_install_hint() {
        let tmp = TempDir::new().unwrap();
        let err = run_conftest_batch_with(
            tmp.path(),
            "k8s.x",
            &[PathBuf::from("/repo/a.yaml")],
            &resolver_missing,
        )
        .unwrap_err();
        let text = err.to_string();
        assert!(text.contains(TOOL_ID), "{text}");
        assert!(text.contains("Встанови:"), "{text}");
    }

    /// Порожній масив у stdout (нічого не порушено) → 0 порушень.
    #[cfg(unix)]
    #[test]
    fn clean_run_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 0, "[]");
        assert_eq!(
            run_conftest_batch_with(
                tmp.path(),
                "k8s.x",
                &[PathBuf::from("/repo/a.yaml")],
                &resolver_found(bin)
            )
            .unwrap(),
            Vec::new()
        );
    }

    /// exit 1 з `failures` → по одному violation на кожен `msg`, у тому самому
    /// порядку, і з `filename`/`namespace` запису.
    #[cfg(unix)]
    #[test]
    fn failures_are_flattened_in_order() {
        let tmp = TempDir::new().unwrap();
        let stdout = r#"[{"filename":"/repo/a.yaml","namespace":"k8s.x","failures":[{"msg":"перше"},{"msg":"друге"}]},
                         {"filename":"/repo/b.yaml","namespace":"k8s.x","successes":1}]"#;
        let bin = fake_conftest(&tmp.path().join("bin"), 1, stdout);
        let violations = run_conftest_batch_with(
            tmp.path(),
            "k8s.x",
            &[PathBuf::from("/repo/a.yaml")],
            &resolver_found(bin),
        )
        .unwrap();
        assert_eq!(
            violations,
            vec![
                ConftestViolation {
                    filename: "/repo/a.yaml".to_string(),
                    namespace: "k8s.x".to_string(),
                    message: "перше".to_string(),
                },
                ConftestViolation {
                    filename: "/repo/a.yaml".to_string(),
                    namespace: "k8s.x".to_string(),
                    message: "друге".to_string(),
                },
            ]
        );
    }

    /// exit > 1 — справжня помилка тула, не «є failures»: hard error з уривком
    /// діагностики.
    #[cfg(unix)]
    #[test]
    fn exit_above_one_is_error() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 2, "boom");
        let err = run_conftest_batch_with(
            tmp.path(),
            "k8s.x",
            &[PathBuf::from("/repo/a.yaml")],
            &resolver_found(bin),
        )
        .unwrap_err();
        assert!(err.to_string().contains("conftest exit 2"), "{err}");
    }

    /// Не-JSON stdout при штатному exit-коді → hard error з уривком виводу
    /// (той самий контракт, що `throw` у JS-гілці `JSON.parse`).
    #[cfg(unix)]
    #[test]
    fn non_json_stdout_is_error() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 0, "not json at all");
        let err = run_conftest_batch_with(
            tmp.path(),
            "k8s.x",
            &[PathBuf::from("/repo/a.yaml")],
            &resolver_found(bin),
        )
        .unwrap_err();
        assert!(err.to_string().contains("не парситься як JSON"), "{err}");
    }
}
