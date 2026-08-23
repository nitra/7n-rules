//! Native-порт `text/markdownlint` (`npm/rules/text/markdownlint/main.mjs`, 63 рядки) —
//! multi-surface concern: `policy` (rego-перевірка `.markdownlint-cli2.jsonc`) + `lint`
//! (прогін зовнішнього `markdownlint-cli2` по `*.md`/`*.mdc`), об'єднані в один `LintResult`
//! (JS-доккомент `main.mjs:1-8` — «аналог jscpd_config/jscpd_duplicates, тут одна директорія»).
//!
//! # Чому обидві поверхні тут, а не лише `lint`
//!
//! Для звичайного native-порту `policy`-поверхню з `concern.json` продовжує оцінювати
//! JS-бік напряму (`detect.mjs` кличе `evaluatePolicyConcern` з `concern.json`, доккомент
//! `codegen-opa-wrapper.mjs:5-8`) — але лише коли concern **не** в `NATIVE_CONCERNS`:
//! `runConcernDetector` (`detect.mjs:220-230`) для native-ключа звертається в
//! `runNativeConcern` і повертається одразу, НЕ доходячи до `evaluatePolicyConcern`-гілки
//! нижче. Реєстрація `text/markdownlint` у `NATIVE_CONCERNS` означає, що JS більше НІКОЛИ
//! не викличе `evaluatePolicyConcern` для цього ключа — тож порт мусить сам відтворити
//! rego-перевірку `.markdownlint-cli2.jsonc` (інакше вона мовчки зникла б, fail-open).
//!
//! Rego-шлях сам НЕ портується (та сама причина, що в `crate::conftest` — «Rego-authoritative»
//! архітектура): [`policy_violations`] лише дзеркалить *виклик* `evaluatePolicyConcern`
//! (`policy-lint-adapter.mjs:76-107`, гілка `engine === 'rego'`) через уже портовану спільну
//! базу [`crate::conftest::run_conftest_batch_with_data`] — той самий підхід, що
//! [`super::k8s_hasura_configmap`]/[`super::k8s_manifests_rego`].
//!
//! # Тул markdownlint-cli2 — третій канал (не `ensureTool`, не `resolveCmd`)
//!
//! JS-канон НЕ резолвить `markdownlint-cli2` ні через `ensureTool`, ні через `resolveCmd`:
//! він імпортує його напряму як npm-залежність пакета `@7n/rules`
//! (`main.mjs:9`, `import { main as markdownlintCli2 } from 'markdownlint-cli2'`;
//! залежність — `npm/package.json:76`). Такого модуля в Rust немає, тож native-бік
//! мусить спавнити зовнішній процес — а не резолвити тул через `tool_registry`
//! (`markdownlint-cli2` там немає: це не GitHub-release-бінарник із
//! brew/scoop/архівом, як `conftest`/`kubeconform`, а звичайна npm-залежність, чий CLI
//! доступний через `npx`).
//!
//! Резолв — `resolve_cmd("npx")` (PATH-lookup, без керованого кешу) — той самий канал,
//! що вже прийнятий для іншої npm-only npx-залежності: [`super::cspell_fix`]. Різниця з
//! `cspell_fix` — у РЕАКЦІЇ на відсутність: там JS-канон явно ловить збій (`resolveCmd` +
//! catch) і перетворює його на звичайну violation; тут JS-канон НІЧОГО не ловить —
//! непіймана помилка `import` на рівні `detect.mjs` (`mod = await import(...)`) стає
//! `DetectorError` і валить увесь прогін (exit 2). Тому native-порт відповідає
//! [`RulesError::Concern`] (fail-closed), а не тихою violation: слабший канал приховав би
//! зниклий тул, а не зупинив прогін, як робить чинний канон.
//!
//! # Що саме портовано з `lint(ctx)`
//!
//! - full-режим (`ctx.files === undefined`) → цілі = буквальні glob-и `DEFAULT_MD_GLOBS`
//!   (`main.mjs:14`), передані `markdownlint-cli2` як є — його власний glob-обхід, не наш;
//! - delta-режим → цілі = `ctx.files`, відфільтровані `MD_EXT_RE` (`main.mjs:17`,
//!   `/\.mdc?$/u` — з урахуванням регістру, `.MD` не проходить);
//! - порожній список цілей → лінт-крок пропускається (порожній спавн неможливий),
//!   але policy-порушення (якщо були) все одно повертаються — порядок точно як у
//!   JS (`if (targets.length === 0) return { violations }`, `main.mjs:33`);
//! - `code !== 0` → одна violation `reason: "markdownlint"` (`main.mjs:57`; той самий код
//!   читає T0-фікс `fix-markdownlint.mjs:38`, тому тут він НЕ змінюваний) з деталями зі
//!   stderr (`logError`-рядки, `main.mjs:48-50`).
//!
//! # Свідомі розходження
//!
//! - **stderr замість callback-агрегації**: JS збирає рядки через `logError`-хук
//!   бібліотеки; native читає весь `stderr` спавненого CLI й розбиває на непорожні рядки.
//!   За замовчуванням `markdownlint-cli2` пише деталі знахідок через `console.error`
//!   (stderr) і банер/прогрес через `console.log` (stdout, тут ковтається) — той самий
//!   поділ потоків, що й `logMessage`/`logError` у бібліотечному виклику. Якщо форматер
//!   колись зміниться і почне писати деталі в stdout, це розійдеться з каноном.
//! - **резолв через `npx`, не напряму `markdownlint-cli2`**: у JS немає жодного
//!   `spawn`/CLI-виклику взагалі (бібліотечний імпорт), тож "точного" CLI-резолву
//!   канон не визначає — обрано `npx`, щоб не покладатись на те, що consumer-репо
//!   підняв `node_modules/.bin` у `PATH`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::conftest::run_conftest_batch_with_data;
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Каталог concern-а відносно `<корінь пакета>/rules` — і `policyDir` для rego
/// (`cfg.policyDir = import.meta.dirname`, `main.mjs:28`), і корінь template-сніпета.
const CONCERN_DIR_REL: &str = "text/markdownlint";

/// Namespace rego-пакета — `${ruleId.replaceAll('-','_')}.${concernId}`
/// (`policy-lint-adapter.mjs:99`) для `ruleId="text"`, `concernId="markdownlint"`.
const POLICY_NAMESPACE: &str = "text.markdownlint";

/// `policy.files.single` (`concern.json`) — єдина ціль rego-перевірки.
const CONFIG_FILE_REL: &str = ".markdownlint-cli2.jsonc";

/// Template-сніпет під теку concern-а — джерело `data.template.snippet` у rego
/// (`markdownlint.rego:3-4`).
const SNIPPET_FILE_REL: &str = "template/.markdownlint-cli2.jsonc.snippet.jsonc";

/// reason policy-порушень — `add('policy-deny', …)` (`policy-lint-adapter.mjs:107`).
const POLICY_REASON: &str = "policy-deny";

/// reason lint-порушення — `fail(msg, 'markdownlint')`-еквівалент (`main.mjs:57`).
/// Той самий код читає T0-фікс `fix-markdownlint.mjs:38` (`v.reason === 'markdownlint'`) —
/// міняти НЕ можна, це контракт живого fix-патерну.
const LINT_REASON: &str = "markdownlint";

/// Базове повідомлення lint-порушення — буквально той самий рядок, що в JS (`main.mjs:58`).
const LINT_MESSAGE: &str = "markdownlint знайшов порушення у *.md/*.mdc (text.mdc)";

/// Full-режим globs — `DEFAULT_MD_GLOBS` (`main.mjs:14`).
const DEFAULT_MD_GLOBS: [&str; 2] = ["**/*.md", "**/*.mdc"];

/// `MD_EXT_RE` (`main.mjs:17`, `/\.mdc?$/u`) — з урахуванням регістру.
fn is_md_target(rel: &str) -> bool {
    rel.ends_with(".md") || rel.ends_with(".mdc")
}

/// Detector `text/markdownlint` — порт `lint(ctx)` (`main.mjs:25-63`).
pub fn text_markdownlint(
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<Vec<Violation>, RulesError> {
    text_markdownlint_with(cwd, files, &resolve_cmd)
}

/// Тіло детектора з інжектованим резолвом `npx` — та сама інжекція, що в
/// `concerns::k8s_kubeconform`: підміняти процес-глобальний `PATH` не можна, бо в тому ж
/// тест-процесі паралельно біжать тести, що спавнять `git`/інші тули.
fn text_markdownlint_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_npx: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<Vec<Violation>, RulesError> {
    // Policy — завжди першою, незалежно від того, чи є lint-цілі (`main.mjs:26-30`).
    let mut violations = policy_violations(cwd)?;

    let targets: Vec<String> = match files {
        None => DEFAULT_MD_GLOBS
            .iter()
            .map(|glob| (*glob).to_string())
            .collect(),
        Some(list) => list.iter().filter(|f| is_md_target(f)).cloned().collect(),
    };
    if targets.is_empty() {
        return Ok(violations);
    }

    let Some(npx) = resolve_npx("npx") else {
        return Err(RulesError::Concern(
            "npx не знайдено в PATH — потрібен для запуску markdownlint-cli2 (text.mdc). \
             npx постачається разом із Node.js/npm."
                .to_string(),
        ));
    };

    let (code, stderr) = run_markdownlint_cli2(&npx, cwd, &targets);
    if code != 0 {
        let error_lines: Vec<&str> = stderr
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        let detail = if error_lines.is_empty() {
            String::new()
        } else {
            format!(":\n{}", error_lines.join("\n"))
        };
        violations.push(Violation {
            reason: LINT_REASON.to_string(),
            message: format!("{LINT_MESSAGE}{detail}"),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    Ok(violations)
}

/// Спавнить `npx markdownlint-cli2 <targets>` у `cwd` — порт виклику бібліотеки
/// (`directory: ctx.cwd, argv: targets`, `main.mjs:42-51`). Повертає exit-код і stderr
/// (деталі знахідок, `logError`-еквівалент); stdout (банер/прогрес, `logMessage`-еквівалент)
/// ковтається.
fn run_markdownlint_cli2(npx: &Path, cwd: &Path, targets: &[String]) -> (i32, String) {
    let mut command = Command::new(npx);
    command
        .current_dir(cwd)
        .arg("markdownlint-cli2")
        .args(targets)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) => (
            output.status.code().unwrap_or(1),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ),
        Err(_) => (1, String::new()),
    }
}

/// Policy-шар — порт `evaluatePolicyConcern(ctx, {engine:'rego', …})`
/// (`policy-lint-adapter.mjs:76-107`) для єдиної цілі `.markdownlint-cli2.jsonc`.
///
/// `files.required` не виставлений у `concern.json`, тож відсутній конфіг — мовчазний
/// skip (0 violations), не помилка: `resolveTargetFiles` повертає `[]`, і
/// `evaluatePolicyConcern` додає `policy-file-missing` лише коли `cfg.files.required`
/// істинний (`policy-lint-adapter.mjs:66-69`).
fn policy_violations(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let target = cwd.join(CONFIG_FILE_REL);
    if !target.exists() {
        return Ok(Vec::new());
    }

    let root = rules_root(cwd).ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?;
    let policy_abs = root.join(CONCERN_DIR_REL);
    let template_data = load_template_data(&root)?;

    let failures =
        run_conftest_batch_with_data(&policy_abs, POLICY_NAMESPACE, &[target], &template_data)?;

    Ok(failures
        .into_iter()
        .map(|failure| Violation {
            reason: POLICY_REASON.to_string(),
            message: failure.message,
            // Єдина можлива ціль — сам `CONFIG_FILE_REL`: conftest ехоїть шлях, який ми
            // самі передали (`target` вище), тож relative-форма завжди рівно ця константа —
            // повний `toRel`-хелпер тут зайвий (немає другої цілі, яку відносно чого рахувати).
            file: Some(CONFIG_FILE_REL.to_string()),
            severity: Severity::Error,
            data: None,
        })
        .collect())
}

/// Читає й парсить template-сніпет (`resolveConcernTemplateData` + `loadTemplate`,
/// `template.mjs:277-315`) у форму `{"snippet": <дерево>}` для `--data`.
///
/// Файл-джерело — чистий JSON без коментарів (на відміну від generic `parseByExt`, який
/// перед парсом жене crc через `stripJsonComments`) — пряме звуження контракту для ЦІЄЇ
/// конкретної, версійованої в репозиторії теки concern-а (не generic engine). Відсутність
/// чи некоректний JSON — [`RulesError::Concern`], не тихий skip: rego без
/// `data.template.snippet` мовчки перестав би щось перевіряти (fail-open).
fn load_template_data(rules_root: &Path) -> Result<serde_json::Value, RulesError> {
    let path = rules_root.join(CONCERN_DIR_REL).join(SNIPPET_FILE_REL);
    let raw = std::fs::read_to_string(&path).map_err(|error| {
        RulesError::Concern(format!(
            "не читається template-сніпет {}: {error}",
            path.display()
        ))
    })?;
    let snippet: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
        RulesError::Concern(format!(
            "template-сніпет {} не парситься як JSON: {error}",
            path.display()
        ))
    })?;
    Ok(serde_json::json!({ "snippet": snippet }))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Кладе виконуваний shell-скрипт `npx`, що ігнорує аргументи, друкує `stderr` і
    /// завершується з `exit_code`.
    #[cfg(unix)]
    fn fake_npx(dir: &Path, exit_code: i32, stderr: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("npx");
        fs::write(
            &bin,
            format!("#!/bin/sh\ncat <<'N_EOF' >&2\n{stderr}\nN_EOF\nexit {exit_code}\n"),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, що завжди повертає заданий шлях (тул «встановлено»).
    #[cfg(unix)]
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Резолвер, що не знаходить нічого (тул «не встановлено»).
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    // --- фільтр цілей: is_md_target / delta vs full ---

    /// `MD_EXT_RE` враховує регістр — `.MD`/`.MDC` не проходять (`main.mjs:17`).
    #[test]
    fn is_md_target_is_case_sensitive() {
        assert!(is_md_target("README.md"));
        assert!(is_md_target(".cursor/rules/n-style.mdc"));
        assert!(!is_md_target("README.MD"));
        assert!(!is_md_target("README.txt"));
    }

    /// Delta-режим з порожнім `ctx.files` → 0 цілей → жодного спавна `npx`, і policy теж
    /// не спрацьовує (немає `.markdownlint-cli2.jsonc`) — 0 violations.
    #[test]
    fn empty_delta_files_yields_no_violations_without_spawn() {
        let tmp = TempDir::new().unwrap();
        let violations = text_markdownlint_with(tmp.path(), Some(&[]), &resolver_missing).unwrap();
        assert!(violations.is_empty());
    }

    /// Delta-режим фільтрує не-markdown файли; якщо після фільтра порожньо — спавна немає.
    #[test]
    fn delta_mode_filters_non_markdown_files() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["package.json".to_string(), "src/lib.rs".to_string()];
        let violations =
            text_markdownlint_with(tmp.path(), Some(&files), &resolver_missing).unwrap();
        assert!(violations.is_empty());
    }

    /// Full-режим (`files: None`) завжди дає непорожні цілі (буквальні glob-и) — навіть
    /// на порожньому дереві дійде до резолву `npx`; тут резолвер «нічого не знаходить» →
    /// fail-closed помилка, не 0 violations.
    #[test]
    fn full_mode_always_reaches_npx_resolve() {
        let tmp = TempDir::new().unwrap();
        let err = text_markdownlint_with(tmp.path(), None, &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    /// Тула немає (`npx` не резолвиться) → fail-closed помилка з поясненням — не тиха
    /// violation (на відміну від `cspell_fix`, де JS-канон явно ловить збій).
    #[test]
    fn missing_npx_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["README.md".to_string()];
        let err = text_markdownlint_with(tmp.path(), Some(&files), &resolver_missing).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("npx"), "{err}");
    }

    /// exit 0 → 0 violations (жодної lint-порушення; policy теж мовчить — конфіга немає).
    #[cfg(unix)]
    #[test]
    fn exit_zero_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let npx = fake_npx(&tmp.path().join("bin"), 0, "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let files = vec!["README.md".to_string()];
        let violations = text_markdownlint_with(&repo, Some(&files), &resolver_found(npx)).unwrap();
        assert!(violations.is_empty());
    }

    /// Ненульовий exit → одна violation `reason: "markdownlint"` з деталями зі stderr.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_gives_single_violation_with_stderr_detail() {
        let tmp = TempDir::new().unwrap();
        let npx = fake_npx(
            &tmp.path().join("bin"),
            1,
            "bad.md:1 MD041/first-line-heading First line in a file should be a top-level heading",
        );
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let files = vec!["bad.md".to_string()];
        let violations = text_markdownlint_with(&repo, Some(&files), &resolver_found(npx)).unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "markdownlint");
        assert!(violations[0]
            .message
            .contains("markdownlint знайшов порушення"));
        assert!(violations[0].message.contains("MD041"));
        assert!(violations[0].message.contains("bad.md"));
        assert!(violations[0].file.is_none());
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// Порожній stderr при ненульовому exit → message без хвоста-деталі (буквально
    /// `errorLines.length > 0 ? … : ''`, `main.mjs:53`).
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_without_stderr_has_no_detail_suffix() {
        let tmp = TempDir::new().unwrap();
        let npx = fake_npx(&tmp.path().join("bin"), 1, "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let files = vec!["bad.md".to_string()];
        let violations = text_markdownlint_with(&repo, Some(&files), &resolver_found(npx)).unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].message, LINT_MESSAGE);
    }

    // --- policy_violations: конфіг відсутній / пакет не резолвиться ---

    /// Немає `.markdownlint-cli2.jsonc` → 0 policy-violations, і навіть до резолву
    /// кореня пакета справа не доходить (не fail-closed на щось незвʼязане).
    #[test]
    fn missing_config_file_skips_policy_silently() {
        let tmp = TempDir::new().unwrap();
        assert!(policy_violations(tmp.path()).unwrap().is_empty());
    }

    /// Конфіг є, але корінь пакета `@7n/rules` не резолвиться (порожнє tmp-дерево,
    /// override не виставлено) → fail-closed із підказкою, не мовчазний skip.
    ///
    /// Тест свідомо НЕ мутує `N_RULES_PACKAGE_ROOT` — у тому ж тест-процесі паралельно
    /// біжать інші тести крейта (той самий застережний коментар, що в
    /// `k8s_hasura_configmap::open_gate_without_package_root_fails_closed`).
    #[test]
    fn config_present_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, CONFIG_FILE_REL, "{}\n");
        let err = policy_violations(tmp.path()).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }
}
