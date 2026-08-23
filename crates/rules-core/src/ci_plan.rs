//! Порт обчислювального ядра `n-rules ci plan`
//! (`npm/scripts/lib/lint-surface/ci-plan.mjs` + `computeActiveDomains` із
//! `npm/scripts/lib/lint-surface/run-detectors.mjs`) — зріз 3 фази 8
//! (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Тут — ЧИСТА частина: активність доменів на заданому файловому наборі,
//! складання плану й три рендери (людський, GitHub Actions, Azure
//! Pipelines). Уся робота з файловою системою та git (резолв бази дельти,
//! перетин піддерева з дельтою, обхід репо) лишається у виклику
//! `rules_cli::ci_cmd` — ядро приймає вже зібрані входи.
//!
//! Fail-open збережено дослівно: коли база дельти не резолвиться, домени НЕ
//! рахуються по порожньому набору, а всі стають `triggered: true` — CI
//! запускає більше, ніколи не скіпає мовчки.

use std::collections::{BTreeMap, BTreeSet};

use crate::concern_meta::{ConcernMeta, LintScope};
use crate::lint_plan::match_lint_globs;
use crate::locale::locale_compare;

/// Глоби тест-файлів для виходу `has_tests` (bun test / vitest / pytest).
pub const TEST_FILE_GLOBS: [&str; 5] = [
    "**/*.test.*",
    "**/*.spec.*",
    "**/test_*.py",
    "**/*_test.py",
    "**/tests/**",
];

/// Зарезервовані ключі outputs — домен із таким ключем був би колізією.
const RESERVED_OUTPUT_KEYS: [&str; 3] = ["any", "has_tests", "domains"];

/// Rule-id → ключ output-змінної: `-` → `_` (GA/Azure не люблять дефіси в
/// іменах змінних; `npm-module` → `npm_module`).
#[must_use]
pub fn domain_key(rule_id: &str) -> String {
    rule_id.replace('-', "_")
}

/// Стан одного домену на файловому наборі (порт значення `Map` із
/// `computeActiveDomains`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DomainState {
    /// Чи тригериться хоч один per-file концерн правила.
    pub triggered: bool,
    /// Скільки унікальних файлів набору збіглося з глобами.
    pub matched_files: usize,
}

/// Домен у складі плану (елемент `plan.domains`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDomain {
    /// Rule-id домену.
    pub id: String,
    /// Ключ output-змінної ([`domain_key`]).
    pub key: String,
    /// Чи запускати домен.
    pub triggered: bool,
    /// Скільки файлів набору його зачепили (0 при fail-open).
    pub matched_files: usize,
}

/// Обчислений план CI (порт `CiPlan`; порядок полів = порядок ключів
/// `JSON.stringify`, від якого залежить byte-exact `--json`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiPlan {
    /// Значення `--path` (каталог сервісу) або `None` (repo-wide).
    pub path: Option<String>,
    /// Чи резолвнулась база дельти (`false` → fail-open, усі домени `true`).
    pub base_resolved: bool,
    /// Кількість файлів у наборі (`None` при fail-open).
    pub changed_count: Option<usize>,
    /// Чи набір непорожній (гейт тест-джоби `any`).
    pub has_changes: bool,
    /// Чи є тест-файли в піддереві (статично, незалежно від дельти).
    pub has_tests: bool,
    /// Стан доменів, відсортований за id.
    pub domains: Vec<PlanDomain>,
}

/// Активність доменів (rule-id) для заданого файлового набору — єдине
/// джерело правди `ci plan` (порт `computeActiveDomains`).
///
/// Домен «активний», якщо хоч один його **per-file** концерн тригериться на
/// цих файлах. Правила без жодного per-file концерну у результат не
/// потрапляють (їхні full-scope перевірки — справа `--repo-wide`). Порожній
/// `glob` концерну означає «матчить УСІ» — той самий fallback, що
/// `planConcernForDelta` (перевірка ДО виклику [`match_lint_globs`], який на
/// порожньому наборі патернів навмисно нічого не повертає).
#[must_use]
pub fn compute_active_domains(
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    enabled: &BTreeSet<String>,
    changed: &[String],
) -> BTreeMap<String, DomainState> {
    let mut out = BTreeMap::new();
    for (rule_id, concerns) in by_rule {
        if !enabled.contains(rule_id) {
            continue;
        }
        let per_file: Vec<&ConcernMeta> = concerns
            .iter()
            .filter(|c| {
                c.lint
                    .as_ref()
                    .is_some_and(|lint| lint.scope == LintScope::PerFile)
            })
            .collect();
        if per_file.is_empty() {
            continue;
        }
        let mut matched: BTreeSet<String> = BTreeSet::new();
        for concern in per_file {
            let glob = &concern
                .lint
                .as_ref()
                .expect("per-file концерн завжди має lint-поверхню")
                .glob;
            if glob.is_empty() {
                matched.extend(changed.iter().cloned());
            } else {
                matched.extend(match_lint_globs(glob, changed));
            }
        }
        out.insert(
            rule_id.clone(),
            DomainState {
                triggered: !matched.is_empty(),
                matched_files: matched.len(),
            },
        );
    }
    out
}

/// Складає план із уже зібраних входів (порт хвоста `computeCiPlan`).
///
/// `changed` — `None` означає «база дельти не резолвнулась» (fail-open).
///
/// # Errors
///
/// Текст колізії ключа output — дослівно як у JS (`ci plan: колізія ключа
/// output «…» (домен …)`), бо він доходить до stderr через верхній
/// `catch` CLI.
pub fn build_ci_plan(
    path: Option<String>,
    changed: Option<&[String]>,
    active: &BTreeMap<String, DomainState>,
    has_tests: bool,
) -> Result<CiPlan, String> {
    let base_resolved = changed.is_some();
    let mut domains: Vec<PlanDomain> = active
        .iter()
        .map(|(id, state)| PlanDomain {
            id: id.clone(),
            key: domain_key(id),
            triggered: if base_resolved { state.triggered } else { true },
            matched_files: if base_resolved {
                state.matched_files
            } else {
                0
            },
        })
        .collect();
    domains.sort_by(|a, b| locale_compare(&a.id, &b.id));

    let mut keys: BTreeSet<String> = BTreeSet::new();
    for domain in &domains {
        if keys.contains(&domain.key) || RESERVED_OUTPUT_KEYS.contains(&domain.key.as_str()) {
            return Err(format!(
                "ci plan: колізія ключа output «{}» (домен {})",
                domain.key, domain.id
            ));
        }
        keys.insert(domain.key.clone());
    }

    Ok(CiPlan {
        path,
        base_resolved,
        changed_count: changed.map(<[String]>::len),
        has_changes: changed.is_none_or(|files| !files.is_empty()),
        has_tests,
        domains,
    })
}

/// Людиночитаний рендер плану (дефолтний stdout-вивід) — порт
/// `renderCiPlanHuman`, включно з фінальним `\n`.
#[must_use]
pub fn render_human(plan: &CiPlan) -> String {
    let mut lines: Vec<String> = Vec::new();
    let where_ = plan.path.as_ref().map_or_else(
        || "весь репозиторій".to_string(),
        |path| format!("--path {path}"),
    );
    if plan.base_resolved {
        lines.push(format!(
            "📋 ci plan ({where_}): {} змінених файлів у наборі",
            plan.changed_count.unwrap_or(0)
        ));
    } else {
        lines.push(format!(
            "⚠️ ci plan ({where_}): база дельти не резолвиться — fail-open, усі домени true"
        ));
    }
    for domain in &plan.domains {
        let suffix = if domain.matched_files > 0 {
            format!(" ({} файл(ів))", domain.matched_files)
        } else {
            String::new()
        };
        let mark = if domain.triggered { "✅" } else { "⏭️" };
        lines.push(format!("  {mark} {}{suffix}", domain.id));
    }
    lines.push(format!(
        "  any={} has_tests={}",
        plan.has_changes, plan.has_tests
    ));
    format!("{}\n", lines.join("\n"))
}

/// Рядки `name=value` для `$GITHUB_OUTPUT` — порт `renderCiPlanGithubLines`.
#[must_use]
pub fn render_github_lines(plan: &CiPlan) -> Vec<String> {
    let mut lines: Vec<String> = plan
        .domains
        .iter()
        .map(|d| format!("{}={}", d.key, d.triggered))
        .collect();
    lines.push(format!("any={}", plan.has_changes));
    lines.push(format!("has_tests={}", plan.has_tests));
    lines.push(format!("domains={}", triggered_ids_json(plan)));
    lines
}

/// Logging commands Azure Pipelines — порт `renderCiPlanAzureLines`.
#[must_use]
pub fn render_azure_lines(plan: &CiPlan) -> Vec<String> {
    let mut lines: Vec<String> = plan
        .domains
        .iter()
        .map(|d| vso(&d.key, &d.triggered.to_string()))
        .collect();
    lines.push(vso("any", &plan.has_changes.to_string()));
    lines.push(vso("has_tests", &plan.has_tests.to_string()));
    lines.push(vso("domains", &triggered_ids_json(plan)));
    lines
}

/// Один logging command Azure Pipelines для output-змінної.
fn vso(key: &str, value: &str) -> String {
    format!("##vso[task.setvariable variable={key};isOutput=true]{value}")
}

/// `JSON.stringify(domains.filter(triggered).map(id))` — компактний масив
/// без пробілів, як у JS.
fn triggered_ids_json(plan: &CiPlan) -> String {
    let ids: Vec<&str> = plan
        .domains
        .iter()
        .filter(|d| d.triggered)
        .map(|d| d.id.as_str())
        .collect();
    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string())
}

/// `JSON.stringify(plan, null, 2)` — двопробільний відступ, порядок ключів =
/// порядок полів [`CiPlan`].
///
/// # Panics
///
/// Ніколи: [`CiPlan`] серіалізується без мап із не-рядковими ключами.
#[must_use]
pub fn render_json(plan: &CiPlan) -> String {
    serde_json::to_string_pretty(plan).expect("CiPlan серіалізується завжди")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::concern_meta::LintSurface;
    use std::path::PathBuf;

    fn concern(name: &str, scope: LintScope, glob: &[&str]) -> ConcernMeta {
        ConcernMeta {
            name: name.to_string(),
            dir: PathBuf::from("/x"),
            check: true,
            policy: None,
            lint: Some(LintSurface {
                scope,
                glob: glob.iter().map(|g| (*g).to_string()).collect(),
                anchors: Vec::new(),
            }),
            requires_capability: None,
            fixability: crate::concern_meta::Fixability::Code,
            skip_local_tier: false,
            cloud_timeout_ms: None,
            fix_hint: None,
        }
    }

    fn by_rule(entries: Vec<(&str, Vec<ConcernMeta>)>) -> BTreeMap<String, Vec<ConcernMeta>> {
        entries
            .into_iter()
            .map(|(id, concerns)| (id.to_string(), concerns))
            .collect()
    }

    fn enabled(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|id| (*id).to_string()).collect()
    }

    fn files(list: &[&str]) -> Vec<String> {
        list.iter().map(|f| (*f).to_string()).collect()
    }

    #[test]
    fn domain_key_replaces_every_dash() {
        assert_eq!(domain_key("npm-module"), "npm_module");
        assert_eq!(domain_key("a-b-c"), "a_b_c");
    }

    #[test]
    fn only_enabled_rules_with_per_file_concerns_become_domains() {
        let map = by_rule(vec![
            (
                "js",
                vec![concern("eslint", LintScope::PerFile, &["**/*.js"])],
            ),
            ("knip", vec![concern("knip", LintScope::Full, &["**/*.js"])]),
            (
                "text",
                vec![concern("cspell", LintScope::PerFile, &["**/*.md"])],
            ),
        ]);
        let active = compute_active_domains(&map, &enabled(&["js", "knip"]), &files(&["a.js"]));
        assert_eq!(active.keys().collect::<Vec<_>>(), ["js"]);
        assert_eq!(
            active["js"],
            DomainState {
                triggered: true,
                matched_files: 1
            }
        );
    }

    #[test]
    fn empty_glob_matches_every_changed_file() {
        let map = by_rule(vec![("all", vec![concern("any", LintScope::PerFile, &[])])]);
        let active = compute_active_domains(&map, &enabled(&["all"]), &files(&["a.js", "b.md"]));
        assert_eq!(
            active["all"],
            DomainState {
                triggered: true,
                matched_files: 2
            }
        );
    }

    #[test]
    fn unresolved_base_fails_open_to_all_domains_true() {
        let map = by_rule(vec![(
            "js",
            vec![concern("eslint", LintScope::PerFile, &["**/*.js"])],
        )]);
        let active = compute_active_domains(&map, &enabled(&["js"]), &[]);
        let plan = build_ci_plan(None, None, &active, false).unwrap();
        assert!(!plan.base_resolved);
        assert_eq!(plan.changed_count, None);
        assert!(plan.has_changes);
        assert!(plan.domains[0].triggered);
        assert_eq!(plan.domains[0].matched_files, 0);
    }

    #[test]
    fn reserved_output_key_is_a_collision() {
        let map = by_rule(vec![("any", vec![concern("c", LintScope::PerFile, &[])])]);
        let active = compute_active_domains(&map, &enabled(&["any"]), &files(&["a.js"]));
        let error = build_ci_plan(None, Some(&files(&["a.js"])), &active, false).unwrap_err();
        assert_eq!(error, "ci plan: колізія ключа output «any» (домен any)");
    }

    #[test]
    fn dash_and_underscore_ids_collide_on_the_same_key() {
        let map = by_rule(vec![
            ("npm-module", vec![concern("c", LintScope::PerFile, &[])]),
            ("npm_module", vec![concern("c", LintScope::PerFile, &[])]),
        ]);
        let active = compute_active_domains(
            &map,
            &enabled(&["npm-module", "npm_module"]),
            &files(&["a"]),
        );
        assert!(build_ci_plan(None, Some(&files(&["a"])), &active, false)
            .unwrap_err()
            .contains("колізія ключа output «npm_module»"));
    }

    #[test]
    fn empty_plan_renders_header_and_aggregates_only() {
        let plan = build_ci_plan(None, Some(&[]), &BTreeMap::new(), false).unwrap();
        assert_eq!(
            render_human(&plan),
            "📋 ci plan (весь репозиторій): 0 змінених файлів у наборі\n  any=false has_tests=false\n"
        );
        assert_eq!(
            render_github_lines(&plan),
            ["any=false", "has_tests=false", "domains=[]"]
        );
    }

    #[test]
    fn human_render_marks_skipped_domains_and_path_scope() {
        let map = by_rule(vec![
            (
                "js",
                vec![concern("eslint", LintScope::PerFile, &["**/*.js"])],
            ),
            (
                "text",
                vec![concern("cspell", LintScope::PerFile, &["**/*.md"])],
            ),
        ]);
        let changed = files(&["run/a.js"]);
        let active = compute_active_domains(&map, &enabled(&["js", "text"]), &changed);
        let plan = build_ci_plan(Some("run".to_string()), Some(&changed), &active, true).unwrap();
        assert_eq!(
            render_human(&plan),
            "📋 ci plan (--path run): 1 змінених файлів у наборі\n  ✅ js (1 файл(ів))\n  ⏭️ text\n  any=true has_tests=true\n"
        );
        assert_eq!(
            render_azure_lines(&plan),
            [
                "##vso[task.setvariable variable=js;isOutput=true]true",
                "##vso[task.setvariable variable=text;isOutput=true]false",
                "##vso[task.setvariable variable=any;isOutput=true]true",
                "##vso[task.setvariable variable=has_tests;isOutput=true]true",
                "##vso[task.setvariable variable=domains;isOutput=true][\"js\"]"
            ]
        );
    }

    #[test]
    fn json_render_keeps_js_key_order_and_two_space_indent() {
        let plan = build_ci_plan(None, None, &BTreeMap::new(), false).unwrap();
        assert_eq!(
            render_json(&plan),
            "{\n  \"path\": null,\n  \"baseResolved\": false,\n  \"changedCount\": null,\n  \"hasChanges\": true,\n  \"hasTests\": false,\n  \"domains\": []\n}"
        );
    }

    #[test]
    fn test_globs_match_the_documented_shapes() {
        let globs: Vec<String> = TEST_FILE_GLOBS.iter().map(|g| (*g).to_string()).collect();
        let candidates = files(&[
            "a.test.js",
            "pkg/b.spec.ts",
            "py/test_x.py",
            "py/x_test.py",
            "tests/fixture.txt",
            "src/main.rs",
        ]);
        let matched = match_lint_globs(&globs, &candidates);
        assert_eq!(matched.len(), 5);
        assert!(!matched.contains(&"src/main.rs".to_string()));
    }
}
