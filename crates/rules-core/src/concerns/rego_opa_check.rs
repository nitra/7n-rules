//! Native-порт `rego/opa_check` (`npm/rules/rego/opa_check/main.mjs`, 34
//! рядки) — read-only `opa check --strict` над `.rego`-файлами (rego.mdc).
//!
//! Разом із `main.mjs` портовано ту частину спільного хелпера
//! `npm/rules/rego/lib/run-external-tool.mjs` (`resolveTargets`/`FULL_TARGET`),
//! якою `opa_check` користується: делта-список `.rego`-файлів (плюс сусідній
//! `X.rego` для `X_test.rego` — regal/opa інакше бачать unresolved-import) або,
//! у full-режимі, policy-корені монорепо (`npm/rules`, `plugins`), якщо вони
//! існують. Сам `run-external-tool.mjs` НЕ видаляється — його ще споживає
//! `rego/regal`, який лишається на JS (порт не зроблений).
//!
//! # Тул відсутній → fail-closed
//!
//! JS-канон кличе `ensureTool` (`ensure-tool.mjs:519-539`) і дає винятку
//! піднятись — hard-fail, не пропуск. Той самий контракт уже зафіксували
//! `k8s/kubeconform` і `conftest`: якщо `opa` не резолвиться
//! ([`resolve_provisioned_tool`] з фолбеком [`resolve_cmd`]), концерн
//! повертає [`RulesError::Concern`] з per-OS install-підказкою, і прогін
//! падає. Мовчазний пропуск (чи інформаційна нота замість помилки) був би
//! fail-open — на ефемерному CI-раннері без прогрітого кешу перевірка
//! просто зникла б. Інформаційна нота (як у [`super::tracked_symlink`])
//! доречна лише там, де в самого JS немає ПРЕДМЕТА перевірки (git-індексу);
//! тут предмет є завжди, коли є `.rego`-цілі, — просто немає чим його
//! перевірити.
//!
//! # Резолв тула: `resolve_provisioned_tool` з фолбеком `resolve_cmd`
//!
//! Перший крок — точний порт перших двох кроків `ensureTool` (PATH →
//! керований кеш `tools ensure`). Другий — страховка: `resolve_cmd` шукає
//! лише в `PATH`, тобто підмножина того, що вже проходить
//! [`resolve_provisioned_tool`] всередині; фолбек тут — не нове джерело
//! бінарника, а захист від майбутнього розходження їхньої внутрішньої
//! реалізації (напр. якщо PATH-крок [`resolve_provisioned_tool`] колись
//! стане умовним).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::diagnostics::{ConcernReport, Severity, Violation};
use crate::tool_registry::install_hint_for;
use crate::tool_resolve::{resolve_cmd, resolve_provisioned_tool};
use crate::RulesError;

/// `toolId` у спільному реєстрі тулів (`npm/scripts/lib/tools.json`) і
/// водночас імʼя бінарника.
const TOOL_ID: &str = "opa";

/// Full-режим (`files: None`): policy-корені монорепо, якщо існують — порт
/// `[FULL_TARGET, 'plugins']` (`run-external-tool.mjs:13,22`).
const FULL_TARGETS: [&str; 2] = ["npm/rules", "plugins"];

/// Максимум символів виводу `opa`, що йдуть у повідомлення violation-а —
/// порт `.slice(0, 2000)` (`run-external-tool.mjs:53`).
const MAX_OUTPUT_CHARS: usize = 2000;

/// Стабільний machine code — другий аргумент `fail(...)` (`main.mjs:27`).
const REASON: &str = "opa-check-violation";

/// Чи файл має розширення `.rego` — порт `REGO_EXT_RE` (case-sensitive,
/// `run-external-tool.mjs:16`).
fn is_rego_file(path: &str) -> bool {
    path.ends_with(".rego")
}

/// Цілі для `opa check --strict` — порт `resolveTargets`
/// (`run-external-tool.mjs:20-35`): делта-список `.rego` з `files` (плюс
/// сусідній policy-файл для кожного `X_test.rego`), або, у full-режимі,
/// наявні policy-корені.
fn resolve_targets(files: Option<&[String]>, root: &Path) -> Vec<String> {
    let Some(files) = files else {
        return FULL_TARGETS
            .into_iter()
            .filter(|target| root.join(target).exists())
            .map(str::to_string)
            .collect();
    };
    let rego: Vec<String> = files.iter().filter(|f| is_rego_file(f)).cloned().collect();
    let mut out = rego.clone();
    for f in &rego {
        // `X_test.rego` імпортує сусідній `X.rego`: без нього opa/regal
        // флагує unresolved-import, тож до делта-цілей додаємо наявний
        // сусідній policy-файл.
        let Some(stem) = f.strip_suffix("_test.rego") else {
            continue;
        };
        let sibling = format!("{stem}.rego");
        if !out.contains(&sibling) && root.join(&sibling).exists() {
            out.push(sibling);
        }
    }
    out
}

/// Запускає `opa check --strict <targets>` у `cwd` — порт `runStep`
/// (`run-external-tool.mjs:44-56`) звужений до потреб `opa_check`. Повертає
/// exit-код і обʼєднаний stdout+stderr (обрізаний до
/// [`MAX_OUTPUT_CHARS`]).
fn run_opa_check(opa: &Path, cwd: &Path, targets: &[String]) -> (i32, String) {
    let mut command = Command::new(opa);
    command
        .current_dir(cwd)
        .arg("check")
        .arg("--strict")
        .args(targets)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            let clipped: String = combined.trim().chars().take(MAX_OUTPUT_CHARS).collect();
            (output.status.code().unwrap_or(1), clipped)
        }
        // Гонка між резолвом бінарника і спавном (чи інша I/O-помилка) — той
        // самий `catch` у JS-версії, де `status = 1`, а `output` несе текст
        // помилки замість виводу тула.
        Err(error) => (
            1,
            format!("Не вдалося запустити {}: {error}", opa.display()),
        ),
    }
}

/// Violation одного невдалого прогону — порт хвоста `lint(ctx)`
/// (`main.mjs:29-32`): один `fail()` на весь прогін, не по файлу (`opa
/// check` сам агрегує помилки всіх переданих цілей у своєму виводі).
fn violation(status: i32, output: &str) -> Violation {
    let suffix = if output.is_empty() {
        String::new()
    } else {
        format!("\n{output}")
    };
    Violation {
        reason: REASON.to_string(),
        message: format!("lint-rego: opa check --strict — помилка (код {status}){suffix}"),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `rego/opa_check` — порт `lint(ctx)` (`main.mjs:12-33`).
pub fn rego_opa_check(cwd: &Path, files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    rego_opa_check_with(cwd, files, &|tool_id| {
        resolve_provisioned_tool(tool_id).or_else(|| resolve_cmd(tool_id))
    })
}

/// Тіло [`rego_opa_check`] з інжектованим резолвом бінарника — та сама
/// інжекція, що в `concerns::k8s_kubeconform`/`conftest::run_conftest_batch_with`:
/// підміняти процес-глобальний `PATH` не можна, бо в тому самому
/// тест-процесі паралельно біжать тести, що спавнять `git`.
fn rego_opa_check_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    let targets = resolve_targets(files, cwd);
    // Порожні цілі — «нема чого перевіряти», не «тул недоступний»: JS-версія
    // (`main.mjs:22`) виходить тут ДО будь-якого резолву `opa`, і native-порт
    // мусить лишатись мовчазним так само, інакше репо без rego-файлів
    // отримувало б помилку про відсутній `opa`, якого йому не треба.
    if targets.is_empty() {
        return Ok(ConcernReport::default());
    }

    let Some(opa) = resolve_tool(TOOL_ID) else {
        // Тул є в реєстрі за конструкцією (тест `opa_is_in_registry`), тож
        // fallback лишається на випадок майбутнього переїзду ключа.
        return Err(RulesError::Concern(
            install_hint_for(TOOL_ID).unwrap_or_else(|| {
                format!("{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші бінарників.")
            }),
        ));
    };

    let (status, output) = run_opa_check(&opa, cwd, &targets);
    if status == 0 {
        return Ok(ConcernReport::default());
    }
    Ok(ConcernReport::from(vec![violation(status, &output)]))
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

    /// Кладе виконуваний стаб `opa`, що виходить з `exit_code` і друкує
    /// `stderr`.
    #[cfg(unix)]
    fn fake_opa(dir: &Path, exit_code: i32, stderr: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("opa");
        fs::write(
            &bin,
            format!("#!/bin/sh\ncat <<'N_EOF' 1>&2\n{stderr}\nN_EOF\nexit {exit_code}\n"),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    #[cfg(unix)]
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Тул є у спільному реєстрі (`tools.json`) — без цього fallback-гілка
    /// `install_hint_for(TOOL_ID).unwrap_or_else(...)` ніколи не звірялась би
    /// з каноном.
    #[test]
    fn opa_is_in_registry() {
        assert!(install_hint_for(TOOL_ID).is_some());
    }

    /// Full-режим без жодного policy-кореня → 0 targets, 0 violations, БЕЗ
    /// спавна (резолвер «нічого не знаходить» доводить, що до нього не
    /// дійшло).
    #[test]
    fn empty_targets_skip_without_tool_resolution() {
        let tmp = TempDir::new().unwrap();
        let report = rego_opa_check_with(tmp.path(), None, &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Full-режим із наявним `npm/rules` → ціль резолвиться, тул відсутній →
    /// fail-closed помилка з install-підказкою, не мовчазний пропуск.
    #[test]
    fn missing_tool_is_fail_closed_error() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let err = rego_opa_check_with(tmp.path(), None, &resolver_missing).unwrap_err();
        let text = err.to_string();
        assert!(text.contains(TOOL_ID), "{text}");
        assert!(text.contains("Встанови:"), "{text}");
    }

    /// Делта-режим: не-`.rego`-файли відфільтровуються, `.rego` лишається.
    #[test]
    fn resolve_targets_filters_delta_to_rego_extension() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("pkg")).unwrap();
        fs::write(tmp.path().join("pkg/a.rego"), "package a\n").unwrap();
        let files = vec!["pkg/a.rego".to_string(), "pkg/readme.md".to_string()];
        assert_eq!(
            resolve_targets(Some(&files), tmp.path()),
            vec!["pkg/a.rego"]
        );
    }

    /// `X_test.rego` тягне за собою наявний сусідній `X.rego`.
    #[test]
    fn resolve_targets_adds_sibling_for_test_file() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("pkg")).unwrap();
        fs::write(tmp.path().join("pkg/a.rego"), "package a\n").unwrap();
        fs::write(tmp.path().join("pkg/a_test.rego"), "package a\n").unwrap();
        let files = vec!["pkg/a_test.rego".to_string()];
        assert_eq!(
            resolve_targets(Some(&files), tmp.path()),
            vec!["pkg/a_test.rego", "pkg/a.rego"]
        );
    }

    /// Відсутній сусідній `X.rego` — сиблінг НЕ додається (`existsSync`
    /// гейтить, а не сама наявність суфіксу).
    #[test]
    fn resolve_targets_skips_sibling_when_it_does_not_exist() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["pkg/a_test.rego".to_string()];
        assert_eq!(
            resolve_targets(Some(&files), tmp.path()),
            vec!["pkg/a_test.rego"]
        );
    }

    /// Full-режим: жоден із `npm/rules`/`plugins` не існує → порожній
    /// список цілей.
    #[test]
    fn resolve_targets_full_mode_without_roots_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(resolve_targets(None, tmp.path()).is_empty());
    }

    /// Успішний прогін (`exit 0`) → 0 violations.
    #[cfg(unix)]
    #[test]
    fn clean_opa_run_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = fake_opa(&tmp.path().join("bin"), 0, "");
        let report = rego_opa_check_with(tmp.path(), None, &resolver_found(bin)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Ненульовий exit → одна violation з reason `opa-check-violation` і
    /// виводом тула в повідомленні.
    #[cfg(unix)]
    #[test]
    fn broken_syntax_yields_single_violation_with_output() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = fake_opa(&tmp.path().join("bin"), 1, "rego_parse_error: boom");
        let report = rego_opa_check_with(tmp.path(), None, &resolver_found(bin)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "opa-check-violation");
        assert!(report.violations[0].message.contains("код 1"));
        assert!(report.violations[0]
            .message
            .contains("rego_parse_error: boom"));
        assert!(report.diagnostics.is_empty());
    }
}
