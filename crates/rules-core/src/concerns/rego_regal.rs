//! Native-порт `rego/regal` (`npm/rules/rego/regal/main.mjs`, 34 рядки) —
//! read-only детектор стилю Rego-політик зовнішнім тулом `regal lint`.
//!
//! Резолв цілей (`resolveTargets`) і сам виклик тула (`runStep`) у JS живуть
//! у спільному хелпері `npm/rules/rego/lib/run-external-tool.mjs` — його
//! ділить і `rego/opa_check` (ще не портований), тож сам файл **не
//! видаляється**, портується лише та частина логіки, яка потрібна `regal`.
//!
//! # `resolveTargets` і сусідній policy-файл — не дрібниця
//!
//! У дельта-режимі для кожного `X_test.rego` у список цілей додається
//! сусідній `X.rego` (якщо він існує). Причина не косметична: тестовий
//! rego-файл типово імпортує пакет політики, яку тестує
//! (`import data.sample.concern`), і якщо в `regal lint` передати ЛИШЕ
//! `X_test.rego` без сусіда, `regal` не може розвʼязати цей імпорт і
//! флагує його як `unresolved-import` — хибне порушення, якого немає, коли
//! дивитись на пару файлів разом. Тому native-порт зобовʼязаний повторити
//! цю евристику буквально, інакше per-file delta-прогін почне видавати
//! false positive, якого не було в full-режимі.
//!
//! # Тул відсутній → fail-closed
//!
//! JS-канон кличе `ensureTool('regal')` (`rego/regal/main.mjs:27`), а
//! `ensureTool` при тулі, який не резолвиться, **кидає** виняток
//! (`npm/scripts/lib/ensure-tool.mjs:519-539`) — і `lint(ctx)` цей виняток
//! не ловить, тобто прогін падає. Це той самий контракт, що вже портований
//! у `k8s/kubeconform`/`k8s_manifests_kubescape`: якщо бінарник не
//! резолвиться ні в `PATH`, ні в керованому кеші, концерн повертає
//! [`RulesError::Concern`] з per-OS install-підказкою, і виклик `lint`
//! падає (чинний режим `N_CURSOR_NO_AUTO_INSTALL`). Мовчазний пропуск (0
//! violations) чи інформаційна нота замість падіння були б fail-open — на
//! ефемерному CI-раннері без прогрітого кешу перевірка стилю rego просто
//! зникла б непомітно. [`ConcernDiagnostic::info`] лишається для іншого
//! класу випадків — коли в самого JS немає ПРЕДМЕТА перевірки (як
//! `security/tracked_symlink`, де немає git-індексу), а не коли предмет є,
//! але інструмент для нього не встановлений.
//!
//! [`RulesError::Concern`]: crate::RulesError::Concern

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::diagnostics::{ConcernReport, Severity, Violation};
use crate::tool_registry::install_hint_for;
use crate::tool_resolve::{resolve_cmd, resolve_provisioned_tool};
use crate::RulesError;

/// `toolId` у спільному реєстрі тулів (`npm/scripts/lib/tools.json`) і
/// водночас імʼя бінарника.
const TOOL_ID: &str = "regal";

/// Full-режим (`files: None`): корінь policy-дерева ядра + rego плагінів
/// монорепо — дзеркало `FULL_TARGET`/`resolveTargets` full-гілки
/// (`run-external-tool.mjs:12,21-24`).
const FULL_TARGETS: [&str; 2] = ["npm/rules", "plugins"];

/// Стабільний machine code — дзеркало `fail(msg, 'regal-lint-violation')`
/// (`rego/regal/main.mjs:32`).
const REASON: &str = "regal-lint-violation";

/// Максимум символів виводу тула в тексті violation-а — порт `runStep`
/// (`run-external-tool.mjs:47`: `.slice(0, 2000)`).
///
/// Свідома відмінність: JS `String.slice` рахує UTF-16 code units, тут —
/// Unicode scalar values (`chars()`). Вивід `regal` — ASCII-шлях і
/// текст-повідомлення, тож на практиці межа збігається; точний паритет по
/// code units коштував би окремого UTF-16-шару заради ніколи не досяжного
/// в цьому виводі краю.
const OUTPUT_LIMIT: usize = 2000;

/// Чи є рядок шляхом `.rego` — порт `REGO_EXT_RE` (`run-external-tool.mjs:15`).
/// Без прапорця «без регістру», буквально як у JS: `.REGO` не пройде.
fn is_rego_path(rel: &str) -> bool {
    rel.ends_with(".rego")
}

/// Сусідній policy-файл для `X_test.rego` — порт заміни `TEST_SUFFIX_RE`
/// (`run-external-tool.mjs:17,37`). `None`, якщо `rel` не тестовий rego
/// (сигнал «сусід — сам файл», JS-гілка `sibling !== f` тоді хибна).
fn sibling_policy_file(rel: &str) -> Option<String> {
    rel.strip_suffix("_test.rego")
        .map(|base| format!("{base}.rego"))
}

/// Цілі для `regal lint` — порт `resolveTargets`
/// (`run-external-tool.mjs:26-40`): delta-список `.rego`-файлів (плюс
/// наявні сусідні policy-файли тестів), або (full-режим) policy-корені, які
/// існують.
fn resolve_targets(cwd: &Path, files: Option<&[String]>) -> Vec<String> {
    let Some(files) = files else {
        return FULL_TARGETS
            .into_iter()
            .filter(|target| cwd.join(target).exists())
            .map(str::to_string)
            .collect();
    };

    let rego: Vec<String> = files.iter().filter(|f| is_rego_path(f)).cloned().collect();
    let mut seen: std::collections::HashSet<String> = rego.iter().cloned().collect();
    let mut out = rego.clone();
    for f in &rego {
        let Some(sibling) = sibling_policy_file(f) else {
            continue;
        };
        // `existsSync` — той самий guard, що в JS: сусід додається лише
        // тоді, коли справді лежить поряд, інакше `regal` отримав би шлях
        // до неіснуючого файлу.
        if seen.insert(sibling.clone()) && cwd.join(&sibling).exists() {
            out.push(sibling);
        }
    }
    out
}

/// Прогін `regal lint <targets>` — порт `runStep`
/// (`run-external-tool.mjs:43-52`). Повертає код завершення й обʼєднаний
/// stdout+stderr, обрізаний до [`OUTPUT_LIMIT`].
fn run_regal(bin: &Path, cwd: &Path, targets: &[String]) -> (i32, String) {
    let mut command = Command::new(bin);
    command
        .current_dir(cwd)
        .arg("lint")
        .args(targets)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            let trimmed = combined.trim();
            let clipped: String = trimmed.chars().take(OUTPUT_LIMIT).collect();
            (output.status.code().unwrap_or(1), clipped)
        }
        // `spawnAsync` у JS ловить помилку спавна й повертає `status: 1` з
        // текстом помилки — тут той самий catch-контур.
        Err(error) => (
            1,
            format!("Не вдалося запустити {}: {error}", bin.display()),
        ),
    }
}

/// Detector `rego/regal` — порт `lint(ctx)` (`rego/regal/main.mjs:19-33`).
///
/// Бінарник резолвиться через [`resolve_provisioned_tool`] (PATH → керований
/// кеш — аналог перших двох кроків JS `ensureTool`) з фолбеком на
/// [`resolve_cmd`] (пряме читання `PATH`): другий крок повторює перший на
/// практиці (кеш-каталог або PATH), але лишається окремим шаром так само,
/// як `k8s_kubeconform`/`k8s_manifests_kubescape` тримають резолв тула
/// одним явним викликом, а не мовчазно покладаються на побічний ефект
/// одного хелпера.
pub fn rego_regal(cwd: &Path, files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    rego_regal_with(cwd, files, &|id| {
        resolve_provisioned_tool(id).or_else(|| resolve_cmd(id))
    })
}

/// Тіло детектора з інжектованим пошуком бінарника — той самий прийом, що
/// в `k8s_kubeconform_with`/`k8s_manifests_kubescape`: підміняти
/// процес-глобальний `PATH` у тестах не можна (у тому ж тест-процесі
/// паралельно біжать тести, що спавнять `git`), тож гілку «тула нема»
/// перевіряє інжектований резолвер, а не змінене оточення.
fn rego_regal_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    let targets = resolve_targets(cwd, files);
    if targets.is_empty() {
        return Ok(ConcernReport::default());
    }

    let Some(bin) = resolve_tool(TOOL_ID) else {
        // Тул є в реєстрі за конструкцією (тест `regal_is_in_tool_registry`),
        // тож fallback лишається на випадок майбутнього переїзду ключа —
        // той самий запобіжник, що й у `k8s_kubeconform`.
        return Err(RulesError::Concern(
            install_hint_for(TOOL_ID).unwrap_or_else(|| {
                format!("{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші бінарників.")
            }),
        ));
    };

    let (status, output) = run_regal(&bin, cwd, &targets);
    if status == 0 {
        return Ok(ConcernReport::default());
    }
    let suffix = if output.is_empty() {
        String::new()
    } else {
        format!("\n{output}")
    };
    Ok(ConcernReport::from(vec![Violation {
        reason: REASON.to_string(),
        message: format!("lint-rego: regal lint — помилка (код {status}){suffix}"),
        file: None,
        severity: Severity::Error,
        data: None,
    }]))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn resolve_targets_full_mode_keeps_only_existing_roots() {
        let tmp = TempDir::new().unwrap();
        assert!(resolve_targets(tmp.path(), None).is_empty());

        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        assert_eq!(resolve_targets(tmp.path(), None), vec!["npm/rules"]);

        fs::create_dir_all(tmp.path().join("plugins")).unwrap();
        assert_eq!(
            resolve_targets(tmp.path(), None),
            vec!["npm/rules", "plugins"]
        );
    }

    #[test]
    fn resolve_targets_delta_mode_filters_non_rego() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["a.rego".to_string(), "readme.md".to_string()];
        assert_eq!(resolve_targets(tmp.path(), Some(&files)), vec!["a.rego"]);
    }

    /// Серце `resolveTargets`: `X_test.rego` без сусіда `X.rego` у ФС не
    /// тягне його в цілі (тесту не існує — нема чого додавати), а коли
    /// сусід є — він потрапляє в список рівно один раз.
    #[test]
    fn resolve_targets_adds_existing_sibling_policy_file() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["pkg/concern_test.rego".to_string()];

        assert_eq!(
            resolve_targets(tmp.path(), Some(&files)),
            vec!["pkg/concern_test.rego"],
            "сусіда нема у ФС — не додаємо неіснуючий шлях"
        );

        fs::create_dir_all(tmp.path().join("pkg")).unwrap();
        fs::write(tmp.path().join("pkg/concern.rego"), "package pkg\n").unwrap();
        assert_eq!(
            resolve_targets(tmp.path(), Some(&files)),
            vec!["pkg/concern_test.rego", "pkg/concern.rego"]
        );
    }

    /// Дубль (і сам `X.rego`, і `X_test.rego` вже в дельті) не подвоюється —
    /// `Set`-семантика JS-оригіналу.
    #[test]
    fn resolve_targets_deduplicates_sibling_already_in_delta() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("pkg")).unwrap();
        fs::write(tmp.path().join("pkg/concern.rego"), "package pkg\n").unwrap();
        let files = vec![
            "pkg/concern_test.rego".to_string(),
            "pkg/concern.rego".to_string(),
        ];
        assert_eq!(
            resolve_targets(tmp.path(), Some(&files)),
            vec!["pkg/concern_test.rego", "pkg/concern.rego"]
        );
    }

    #[test]
    fn empty_delta_scope_is_clean_without_spawn() {
        let tmp = TempDir::new().unwrap();
        let files: Vec<String> = Vec::new();
        let report = rego_regal(tmp.path(), Some(&files)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Порожній full-корінь (нема ні `npm/rules`, ні `plugins`) → цілей
    /// немає, і до резолву тула справа не доходить — результат не залежить
    /// від того, чи встановлений `regal` на машині тесту.
    #[test]
    fn empty_full_scope_is_clean_without_tool_resolve() {
        let tmp = TempDir::new().unwrap();
        let report = rego_regal(tmp.path(), None).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Реєстр тулів має запис для `regal` — інакше нота при відсутньому
    /// тулі деградує до загального тексту без install-маршруту.
    #[test]
    fn regal_is_in_tool_registry() {
        let hint = install_hint_for(TOOL_ID).unwrap();
        assert!(hint.contains("Встанови:"), "{hint}");
    }

    #[cfg(unix)]
    fn write_executable(path: &Path, script: &str) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, script).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Прогін через реальний (фейковий) бінарник: exit 0 → 0 violations.
    #[cfg(unix)]
    #[test]
    fn zero_exit_is_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin_dir = tmp.path().join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        write_executable(&bin_dir.join("regal"), "#!/bin/sh\nexit 0\n");
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();

        let (status, _) = run_regal(
            &bin_dir.join("regal"),
            tmp.path(),
            &["npm/rules".to_string()],
        );
        assert_eq!(status, 0);
    }

    /// Ненульовий код + вивід тула → одна violation з кодом і хвостом
    /// виводу в тексті повідомлення.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_reports_code_and_output_tail() {
        let tmp = TempDir::new().unwrap();
        write_executable(
            &tmp.path().join("regal"),
            "#!/bin/sh\necho 'unresolved-import' >&2\nexit 3\n",
        );
        let (status, output) = run_regal(
            &tmp.path().join("regal"),
            tmp.path(),
            &["a.rego".to_string()],
        );
        assert_eq!(status, 3);
        assert_eq!(output, "unresolved-import");
    }

    /// Спавн неіснуючого бінарника не панікує — `catch`-гілка JS.
    #[test]
    fn missing_binary_returns_status_one_without_panic() {
        let tmp = TempDir::new().unwrap();
        let (status, output) = run_regal(
            &tmp.path().join("definitely-not-a-real-regal-binary"),
            tmp.path(),
            &["a.rego".to_string()],
        );
        assert_eq!(status, 1);
        assert!(!output.is_empty());
    }

    /// Резолвер, що ніколи не знаходить тул — детерміноване відтворення
    /// гілки «regal недоступний» без залежності від того, чи встановлений
    /// `regal` на машині тесту.
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    /// Цілі непорожні, тула нема → fail-closed [`RulesError::Concern`] з
    /// install-підказкою — той самий контракт, що `k8s_kubeconform`: JS
    /// `ensureTool` кидає виняток, а не повертає «нема, але це нормально».
    #[test]
    fn missing_tool_with_targets_fails_closed() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();

        let err = rego_regal_with(tmp.path(), None, &resolver_missing).unwrap_err();
        let RulesError::Concern(message) = err else {
            panic!("очікували RulesError::Concern, отримали {err:?}");
        };
        assert!(message.contains(TOOL_ID), "{message}");
        assert!(message.contains("Встанови:"), "{message}");
    }

    /// Знайдений (фейковий) бінарник з exit 0 → чистий звіт без нот.
    #[cfg(unix)]
    #[test]
    fn found_tool_zero_exit_yields_clean_report_via_injection() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = tmp.path().join("fake-regal");
        write_executable(&bin, "#!/bin/sh\nexit 0\n");

        let report = rego_regal_with(tmp.path(), None, &|_| Some(bin.clone())).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Знайдений (фейковий) бінарник з ненульовим exit → одна violation з
    /// кодом і хвостом виводу, `reason` — стабільний machine code.
    #[cfg(unix)]
    #[test]
    fn found_tool_nonzero_exit_yields_violation_via_injection() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = tmp.path().join("fake-regal-broken");
        write_executable(&bin, "#!/bin/sh\necho 'style: bad' >&2\nexit 2\n");

        let report = rego_regal_with(tmp.path(), None, &|_| Some(bin.clone())).unwrap();
        assert!(report.diagnostics.is_empty());
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, REASON);
        assert!(report.violations[0].message.contains("код 2"));
        assert!(report.violations[0].message.contains("style: bad"));
    }
}
