//! Native-порт `npm/scripts/lib/gha-workflow.mjs` (220 рядків) — YAML-парсинг
//! GitHub Actions workflow + допоміжні функції аналізу `uses:`/`run:` кроків,
//! без пошуку підрядків у сирому тексті там, де важливі лише структуровані
//! значення. Спільний lib-модуль для двох native concern-ів I1-кластеру
//! (фаза 5, батч 4 частина 2): `text/formatting` (через [`any_run_step_includes`])
//! і `tauri/release` (через [`flatten_workflow_steps`], [`get_step_run`],
//! [`get_step_uses`]).
//!
//! # Портована лише потрібна поверхня
//!
//! JS-файл додатково експортує `eventPathsIncludeExact` і
//! `verifyLintJsWorkflowStructure` (+ приватні `hasCheckoutWithPersistCredentialsFalse`,
//! `appendCiFixFlagFailures`) — вони обслуговують `check-ga`/`check-js`
//! концерни, не портовані в цьому батчі. На відміну від H1-кластеру, де
//! `abie_yaml.rs` портував усі функції спільного lib-модуля (кожна вживана
//! бодай одним concern-ом abie-трійки), тут немає жодного I1 concern-а, що
//! використав би ці дві функції — `pub`-порт непотрібного API під приватним
//! `mod gha_workflow` дав би dead-code (`-D warnings` у `cargo clippy` крейту
//! це забороняє). Секція «портована лише потрібна функція» в doc-коменті
//! `hasura_internal_urls.rs` (`getRepositoryUrl`) — той самий принцип.
//!
//! # Спрощення відносно JS
//!
//! - `parseWorkflowYaml`: JS-перевірка `typeof root === 'object'` пропускає і
//!   масиви (`typeof [] === 'object'`), і об'єкти. Тут приймаються обидва
//!   варіанти (`Value::Object`/`Value::Array`) — той самий видимий ефект.
//! - `workflowJobsEntries`/`workflowJobSteps`: JS допускає, що `job`/`step`
//!   технічно можуть бути масивом (`typeof [] === 'object'` знову проходить
//!   перевірку) — тут використовується природний тип (`as_object`/`as_array`
//!   за призначенням поля), бо реальний GHA YAML ніколи не кладе масив на
//!   місце job/step-об'єкта, і жоден тест (JS чи дзеркальний) на цю межу не
//!   покладається.
//! - `getStepRun`, коли `run:` — масив: JS робить `.map(String)` (довільне
//!   значення → рядок). Тут скалярні типи (`string`/`number`/`bool`/`null`)
//!   конвертуються так само; нереалістичний для `run:` випадок вкладеного
//!   масиву/об'єкта дає порожній рядок замість `"[object Object]"` — не
//!   покривається жодним тестом.
//! - `flattenWorkflowSteps`: JS-елемент має третє поле `stepIndex` — жоден
//!   виклик у портованих concern-ах (`text/formatting`, `tauri/release`) його
//!   не читає (позиція кроку в job-і виводиться через `Vec`-індекс уже
//!   відфільтрованого по `jobId` зрізу, не через це поле), тож [`FlatStep`]
//!   його не містить — той самий видимий ефект без dead-поля.

/// Парсить workflow YAML у `serde_json::Value`; при синтаксичній помилці чи
/// не-об'єктному/не-масивному корені — `None` — точний порт `parseWorkflowYaml`
/// (`gha-workflow.mjs:22-27`, секція «Спрощення» у doc-коменті модуля).
pub fn parse_workflow_yaml(content: &str) -> Option<serde_json::Value> {
    let value: serde_yaml::Value = serde_yaml::from_str(content).ok()?;
    let json = serde_json::to_value(value).ok()?;
    match json {
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => Some(json),
        _ => None,
    }
}

/// Один крок job-а — точний порт елемента, який повертає `flattenWorkflowSteps`
/// (`gha-workflow.mjs:36-45`), без `stepIndex` (секція «Спрощення» у
/// doc-коменті модуля).
#[derive(Debug, Clone)]
pub struct FlatStep {
    /// Ідентифікатор job-а (ключ у `jobs`).
    pub job_id: String,
    /// Сам об'єкт кроку.
    pub step: serde_json::Value,
}

/// Збирає всі кроки з усіх jobs — точний порт `flattenWorkflowSteps`
/// (`gha-workflow.mjs:36-45`).
pub fn flatten_workflow_steps(root: &serde_json::Value) -> Vec<FlatStep> {
    let mut out = Vec::new();
    for (job_id, job) in workflow_jobs_entries(root) {
        for step in workflow_job_steps(&job) {
            out.push(FlatStep {
                job_id: job_id.clone(),
                step,
            });
        }
    }
    out
}

/// Значення `uses:` кроку — точний порт `getStepUses` (`gha-workflow.mjs:52-54`).
pub fn get_step_uses(step: &serde_json::Value) -> String {
    step.get("uses")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Значення `run:` кроку (багаторядковий рядок або масив рядків у YAML) —
/// точний порт `getStepRun` (`gha-workflow.mjs:60-68`).
pub fn get_step_run(step: &serde_json::Value) -> String {
    match step.get("run") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .map(scalar_to_js_string)
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// `String(x)`-конвертація одного елемента `run:`-масиву — секція
/// «Спрощення» у doc-коменті модуля.
fn scalar_to_js_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => "null".to_string(),
        _ => String::new(),
    }
}

/// Чи є в будь-якому `run` кроку підрядок — точний порт `anyRunStepIncludes`
/// (`gha-workflow.mjs:93-99`).
pub fn any_run_step_includes(root: &serde_json::Value, needle: &str) -> bool {
    flatten_workflow_steps(root)
        .iter()
        .any(|s| get_step_run(&s.step).contains(needle))
}

/// Повертає jobs як список пар `(jobId, job)` — точний порт
/// `workflowJobsEntries` (`gha-workflow.mjs:142-149`, секція «Спрощення» у
/// doc-коменті модуля щодо типу job).
fn workflow_jobs_entries(root: &serde_json::Value) -> Vec<(String, serde_json::Value)> {
    let Some(jobs) = root.get("jobs").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    jobs.iter()
        .filter(|(_, job)| job.is_object())
        .map(|(job_id, job)| (job_id.clone(), job.clone()))
        .collect()
}

/// Повертає валідні кроки job-а — точний порт `workflowJobSteps`
/// (`gha-workflow.mjs:155-160`, секція «Спрощення» щодо типу step).
fn workflow_job_steps(job: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(steps) = job.get("steps").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    steps.iter().filter(|s| s.is_object()).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINT_JS_SAMPLE: &str = "name: Lint JS
on:
  push:
    branches: [dev, main]
jobs:
  eslint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-bun-deps
      - run: |
          bunx oxlint
          bunx eslint .
          bunx jscpd .
";

    // --- дзеркало gha-workflow.test.mjs (лише для портованої поверхні —
    // секція «Портована лише потрібна поверхня» у doc-коменті модуля) ---

    #[test]
    fn parse_workflow_yaml_valid_workflow() {
        let root = parse_workflow_yaml(LINT_JS_SAMPLE).unwrap();
        assert_eq!(flatten_workflow_steps(&root).len(), 3);
    }

    #[test]
    fn any_run_step_includes_basic() {
        let y = "jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: n-rules lint text --no-fix\n";
        let root = parse_workflow_yaml(y).unwrap();
        assert!(any_run_step_includes(&root, "n-rules lint text --no-fix"));
    }

    #[test]
    fn get_step_uses_string_or_empty() {
        assert_eq!(
            get_step_uses(&serde_json::json!({ "uses": "actions/checkout@v6" })),
            "actions/checkout@v6"
        );
        assert_eq!(get_step_uses(&serde_json::json!({ "run": "echo hi" })), "");
        assert_eq!(get_step_uses(&serde_json::json!({})), "");
    }

    #[test]
    fn get_step_run_string_array_or_empty() {
        assert_eq!(
            get_step_run(&serde_json::json!({ "run": "echo ok" })),
            "echo ok"
        );
        assert_eq!(
            get_step_run(&serde_json::json!({ "uses": "actions/checkout@v6" })),
            ""
        );
    }

    #[test]
    fn flatten_workflow_steps_empty_workflow() {
        let root = parse_workflow_yaml("name: empty\n").unwrap();
        assert!(flatten_workflow_steps(&root).is_empty());
    }

    #[test]
    fn parse_workflow_yaml_invalid_yaml_is_none() {
        assert!(parse_workflow_yaml(": invalid: yaml: {").is_none());
    }

    #[test]
    fn get_step_run_array_joins_with_newline() {
        assert_eq!(
            get_step_run(&serde_json::json!({ "run": ["echo a", "echo b"] })),
            "echo a\necho b"
        );
    }

    #[test]
    fn any_run_step_includes_needle_not_found() {
        let root = parse_workflow_yaml(
            "jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
        )
        .unwrap();
        assert!(!any_run_step_includes(&root, "missing-needle"));
    }

    #[test]
    fn flatten_workflow_steps_job_with_null_steps_does_not_panic() {
        let root =
            parse_workflow_yaml("jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: ~\n").unwrap();
        assert!(flatten_workflow_steps(&root).is_empty());
    }
}
