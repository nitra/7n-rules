//! cspell:ignore picomatch спецвиключення матчером
//! Порт plan-контуру lint-оркестрації (P1 фази 7
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4): `buildPlan`
//! і всі п'ять його builders + `planConcernForDelta` з
//! `npm/scripts/lib/lint-surface/run-detectors.mjs`.
//!
//! # Межа native ⇄ JS (обране рішення — задокументовано в фінальному звіті задачі)
//!
//! Дискавері (`readLintConcernsByRuleMulti`/`parseLintSurface`) і ОБИДВА
//! фільтри (`filterByCapabilities`, `filterByRuleApplies`) лишаються в JS
//! ЦІЛКОМ, не лише `filterByRuleApplies`:
//!
//! - `filterByRuleApplies` робить `await import(pathToFileURL(appliesPath))`
//!   на довільний `<rule>/applies/main.mjs` — dynamic import JS-модуля
//!   принципово не портується в native (немає JS runtime у `rules-core`).
//!   Це й змушує JS тримати ПОВНИЙ `ConcernMeta` (зокрема `.dir`, з якого
//!   рахується `appliesPath`) ДО виклику native — застосовується він саме
//!   до вже прочитаних/каталогізованих concern-ів.
//! - Оскільки JS у будь-якому разі мусить провести дискавері (readdir +
//!   `concern.json` parse) і зберегти повні `ConcernMeta` В ПАМ'ЯТІ для
//!   ЦЬОГО filterByRuleApplies-кроку, а СПОЖИВАЧІ плану (`runConcernDetector`
//!   у `detect.mjs`) також потребують повних `ConcernMeta` (`dir`/`policy`/
//!   `check`/`fixability`/`skipLocalTier`/`cloudTimeoutMs` — жодне з цих
//!   полів plan-builders не читають), порт дискавері+capability-фільтра в
//!   native дав би ЛИШЕ зайвий round-trip (native парсить → JS відновлює ті
//!   самі об'єкти для applies-фільтра → JS будувала б ДРУГИЙ, вужчий DTO
//!   назад у native для планування) без жодного усунення JS-side FS/JSON
//!   роботи: дискавері один раз мусить статись у JS так чи інак.
//! - Тож контракт цього модуля — ТОЧНО той запасний варіант, який спека сама
//!   передбачає для цього випадку: [`build_lint_plan`] приймає ВЖЕ повністю
//!   відфільтрований (capabilities + applies) список концернів — і то лише
//!   мінімальний зріз `ConcernMeta`, який РЕАЛЬНО читають builders
//!   (`name`, `lint.scope`, `lint.glob` — [`ConcernPlanInput`]), не повний
//!   DTO. Native рахує ЛИШЕ план; JS зіставляє повернені
//!   `{ruleId, concernId}` назад зі своїми вже наявними повними
//!   `ConcernMeta` через [`crate::lint_plan`] викликається з
//!   `npm/scripts/lib/lint-surface/run-detectors.mjs`.
//!
//! Дискавері/фільтри — кандидат на порт ПІЗНІШЕ, окремим use case-ом, ЯКЩО
//! з'явиться незалежний споживач, якому не треба тримати повний `ConcernMeta`
//! в пам'яті (не цей перший зріз).
//!
//! # `enabledRuleIds` — теж лишається в JS
//!
//! Потребує читання `.n-rules.json` (Р5 спеки: конфіг-парсинг лишається в
//! JS) і робить side-effecting `console.error`-warning
//! (`warnAboutRulesWithoutConcerns`) — жодне з двох не належить синхронному
//! чистому native-шару. JS рахує `Set<string>` як і раніше та передає готовий
//! список у [`BuildLintPlanInput::enabled_rule_ids`].
//!
//! # Диспетчеризація режиму — теж у JS, свідомо тонка
//!
//! П'ять гілок `buildPlan` (`rules.length>0 && explicitFiles!==null` тощо)
//! лишаються дослівно в JS (ідентичні до старих `if`-умов, без нової
//! логіки) — так JS може ЛІНИВО рахувати дорогі входи (`changed` — git-виклик,
//! навіть якщо вже native, `enabledRuleIds` — читання конфігу) лише для тієї
//! гілки, яка реально виконується (та сама лінивість, що в оригінальному
//! `buildPlan`). Native отримує вже вибраний `mode` рядком + лише ті поля,
//! які цей режим використовує (десь `rules`, десь `changed`, десь
//! `enabledRuleIds` — форма [`BuildLintPlanInput`], одна на всі режими,
//! невикористані поля просто ігноруються обраною гілкою [`build_lint_plan`]).

use std::collections::{BTreeMap, HashSet};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};

/// Мінімальна lint-поверхня одного concern-а, яку читають plan-builders —
/// підмножина `LintSurface`/`ConcernMeta` (`npm/scripts/lib/concern-meta.mjs`):
/// `scope` (`"per-file"`/`"full"`) і вже нормалізований `glob` (порожній
/// масив — «без glob», той самий контракт, що `LintSurface.glob` у JS).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintSurfaceInput {
    /// `"per-file"` або `"full"` — точні рядкові значення JS
    /// `LintSurface.scope`, звірені в тестах нижче.
    pub scope: String,
    #[serde(default)]
    pub glob: Vec<String>,
}

/// Один concern у складі `byRule[ruleId]` — лише те, що читають
/// plan-builders (не повний `ConcernMeta`: `dir`/`policy`/`check`/
/// `fixability` тощо лишаються виключно в JS, doc-комент модуля вище).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcernPlanInput {
    pub name: String,
    pub lint: LintSurfaceInput,
}

/// Вхід [`build_lint_plan`] — одна форма на всі п'ять режимів; поля, які
/// конкретний `mode` не використовує, ігноруються (doc-комент модуля,
/// секція «Диспетчеризація режиму»).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildLintPlanInput {
    /// `"scopedDelta" | "scoped" | "repoWide" | "full" | "delta"` — обраний
    /// JS-фасадом режим (дзеркало п'яти гілок `buildPlan`).
    pub mode: String,
    /// Concerns згруповані за rule-id — уже відфільтровані (capabilities +
    /// applies) JS-боком, doc-комент модуля.
    pub by_rule: BTreeMap<String, Vec<ConcernPlanInput>>,
    /// Scoped-режими (`scoped`/`scopedDelta`): явно названі rule-id.
    #[serde(default)]
    pub rules: Vec<String>,
    /// `scopedDelta`: явний файловий набір (`--path` перетин).
    #[serde(default)]
    pub explicit_files: Vec<String>,
    /// `repoWide`/`full`/`delta`: активні rule-id з `.n-rules.json`
    /// (порахований у JS — Р5 спеки, конфіг-парсинг лишається там).
    #[serde(default)]
    pub enabled_rule_ids: Vec<String>,
    /// `delta`: змінені файли (уже порахований native git-делта, переданий
    /// у JS-фасаді, doc-комент модуля).
    #[serde(default)]
    pub changed: Vec<String>,
    /// `delta`: `--path`-режим — лише per-file concerns.
    #[serde(default)]
    pub path_mode: bool,
}

/// Один елемент плану прогону — точний Rust-відповідник `PlanItem` спеки
/// (`{rule_id, concern_id, files}`). JS зіставляє `(rule_id, concern_id)`
/// назад зі своїм уже наявним повним `ConcernMeta` (doc-комент модуля).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub rule_id: String,
    pub concern_id: String,
    /// `None` — whole-repo (JS `files: undefined`); `Some(_)` — per-file
    /// підмножина.
    pub files: Option<Vec<String>>,
}

/// Компільований matcher одного `glob`-масиву — picomatch-паритетний
/// (`{ dot: true }`, doc-комент нижче) еквівалент `picomatch(glob, { dot:
/// true })` з JS-версії. `literal_separator(true)` — `*` НЕ перетинає `/`
/// (як у picomatch без `globstar`-сегмента), `**` — стандартний globstar.
/// `dot: true` picomatch: жодного спецвиключення прихованих файлів — на
/// відміну від [`crate::concerns::glob_compat`] (той матчер навмисно ховає
/// dot-файли для wildcard-сегментів, інша семантика для іншого споживача).
/// `globset` так само не робить спецвиключення для `.`-префіксів, тож
/// відповідність picomatch dot:true — «з коробки», без додаткової логіки.
///
/// `pub(crate)`, бо той самий матчер потрібен декларативному гейту
/// [`crate::rule_applies`]: glob-семантика в репо мусить бути ОДНА, інакше
/// `concern.json#lint.glob` і `main.json#applies.globMatches` розійдуться на
/// крайових патернах.
pub(crate) struct GlobMatcher(Option<GlobSet>);

impl GlobMatcher {
    /// Порожній `patterns` → «нічого не матчиться» (`None`) — той самий
    /// fallback, що `() => false` у JS `planConcernForDelta` для
    /// `glob.length === 0`. Невалідний окремий патерн — тихо пропускається
    /// (той самий tolerant-парсинг, що build_full_scope_files у
    /// `rules-napi/src/lib.rs`): concern.json — довірений вхід ядра/плагінів,
    /// не недовірений зовнішній ввід.
    pub(crate) fn compile(patterns: &[String]) -> Self {
        if patterns.is_empty() {
            return Self(None);
        }
        let mut builder = GlobSetBuilder::new();
        for pattern in patterns {
            // `literal_separator(true)`: одинарний `*` НЕ перетинає `/` —
            // picomatch без явного globstar-сегмента поводиться так само
            // (лише `**` перетинає межі сегментів).
            if let Ok(glob) = GlobBuilder::new(pattern).literal_separator(true).build() {
                builder.add(glob);
            }
        }
        Self(builder.build().ok())
    }

    pub(crate) fn is_match(&self, file: &str) -> bool {
        match &self.0 {
            Some(set) => set.is_match(file),
            None => false,
        }
    }
}

/// Публічний picomatch-паритетний matcher — підмножина `files`, що збіглася
/// хоч з одним `patterns`. Порожній `patterns` → порожній результат (doc-
/// комент [`GlobMatcher::compile`]); викликачі, яким потрібна семантика «без
/// glob — усе матчиться» (per-file concern без `glob`, `planConcernForDelta`
/// у JS: `glob.length > 0 ? changed.filter(isMatch) : changed`), самі
/// перевіряють `patterns.is_empty()` ДО виклику (так само робить
/// [`plan_concern_for_delta`] нижче) — ця функція навмисно не вгадує намір,
/// лише матчить.
///
/// Публічна napi-межа: `rules-napi::match_lint_globs` — заміна локального
/// `picomatch` у `computeActiveDomains`
/// (`npm/scripts/lib/lint-surface/run-detectors.mjs`), єдине джерело правди
/// для glob-семантики по обидва боки (план і активність домену рахують
/// ОДНИМ матчером).
pub fn match_lint_globs(patterns: &[String], files: &[String]) -> Vec<String> {
    let matcher = GlobMatcher::compile(patterns);
    files
        .iter()
        .filter(|f| matcher.is_match(f))
        .cloned()
        .collect()
}

/// Точний порт `planConcernForDelta`
/// (`run-detectors.mjs:400-412`) — один concern у delta/explicit-files
/// режимі за його `lint.scope`.
fn plan_concern_for_delta(
    rule_id: &str,
    concern: &ConcernPlanInput,
    changed: &[String],
) -> Option<PlanItem> {
    let glob = &concern.lint.glob;
    if concern.lint.scope == "per-file" {
        let files: Vec<String> = if glob.is_empty() {
            changed.to_vec()
        } else {
            match_lint_globs(glob, changed)
        };
        if files.is_empty() {
            None
        } else {
            Some(PlanItem {
                rule_id: rule_id.to_string(),
                concern_id: concern.name.clone(),
                files: Some(files),
            })
        }
    } else {
        // full: запускається whole-repo лише якщо glob ∩ changed ≠ ∅.
        let triggered = !glob.is_empty() && !match_lint_globs(glob, changed).is_empty();
        if triggered {
            Some(PlanItem {
                rule_id: rule_id.to_string(),
                concern_id: concern.name.clone(),
                files: None,
            })
        } else {
            None
        }
    }
}

/// Точний порт `buildScopedPlan` (`run-detectors.mjs:323-329`): усі
/// lint-concerns названих правил, whole-repo. Сортування — ЛИШЕ за
/// `ruleId`, стабільне (`Vec::sort_by` у std стабільний) — та сама гарантія,
/// що `Array.prototype.toSorted` у JS: порядок concern-ів у межах однакового
/// `ruleId` лишається таким, у якому їх подав `byRule[ruleId]` (вхідний
/// порядок масиву — вже алфавітний з JS-дискавері, тут не переупорядковується).
fn build_scoped_plan(
    by_rule: &BTreeMap<String, Vec<ConcernPlanInput>>,
    rules: &[String],
) -> Vec<PlanItem> {
    let mut plan = Vec::new();
    for rule_id in rules {
        if let Some(concerns) = by_rule.get(rule_id) {
            for concern in concerns {
                plan.push(PlanItem {
                    rule_id: rule_id.clone(),
                    concern_id: concern.name.clone(),
                    files: None,
                });
            }
        }
    }
    plan.sort_by(|a, b| a.rule_id.cmp(&b.rule_id));
    plan
}

/// Точний порт `buildScopedDeltaPlan` (`run-detectors.mjs:342-355`):
/// `--path`-перетин × названі правила, ЛИШЕ per-file concerns.
fn build_scoped_delta_plan(
    by_rule: &BTreeMap<String, Vec<ConcernPlanInput>>,
    rules: &[String],
    files: &[String],
) -> Vec<PlanItem> {
    let mut plan = Vec::new();
    for rule_id in rules {
        if let Some(concerns) = by_rule.get(rule_id) {
            for concern in concerns {
                if concern.lint.scope != "per-file" {
                    continue;
                }
                if let Some(item) = plan_concern_for_delta(rule_id, concern, files) {
                    plan.push(item);
                }
            }
        }
    }
    plan.sort_by(|a, b| {
        a.rule_id
            .cmp(&b.rule_id)
            .then_with(|| a.concern_id.cmp(&b.concern_id))
    });
    plan
}

/// Точний порт `buildRepoWidePlan` (`run-detectors.mjs:365-375`): лише
/// full-scope concerns enabled-правил, whole-repo.
fn build_repo_wide_plan(
    by_rule: &BTreeMap<String, Vec<ConcernPlanInput>>,
    enabled: &HashSet<&str>,
) -> Vec<PlanItem> {
    let mut entries: Vec<(String, String)> = Vec::new();
    for (rule_id, concerns) in by_rule {
        if !enabled.contains(rule_id.as_str()) {
            continue;
        }
        for concern in concerns {
            if concern.lint.scope == "full" {
                entries.push((rule_id.clone(), concern.name.clone()));
            }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    entries
        .into_iter()
        .map(|(rule_id, concern_id)| PlanItem {
            rule_id,
            concern_id,
            files: None,
        })
        .collect()
}

/// Точний порт `buildFullPlan` (`run-detectors.mjs:383-391`): усі per-file +
/// full concerns enabled-правил, whole-repo.
fn build_full_plan(
    by_rule: &BTreeMap<String, Vec<ConcernPlanInput>>,
    enabled: &HashSet<&str>,
) -> Vec<PlanItem> {
    let mut entries: Vec<(String, String)> = Vec::new();
    for (rule_id, concerns) in by_rule {
        if !enabled.contains(rule_id.as_str()) {
            continue;
        }
        for concern in concerns {
            entries.push((rule_id.clone(), concern.name.clone()));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    entries
        .into_iter()
        .map(|(rule_id, concern_id)| PlanItem {
            rule_id,
            concern_id,
            files: None,
        })
        .collect()
}

/// Точний порт `buildDeltaPlan` (`run-detectors.mjs:424-438`): concerns
/// enabled-правил, зіставлені зі зміненими файлами; `per_file_only`
/// (path-режим сервіс-канону) виключає full-scope concerns.
fn build_delta_plan(
    by_rule: &BTreeMap<String, Vec<ConcernPlanInput>>,
    enabled: &HashSet<&str>,
    changed: &[String],
    per_file_only: bool,
) -> Vec<PlanItem> {
    let mut plan = Vec::new();
    for (rule_id, concerns) in by_rule {
        if !enabled.contains(rule_id.as_str()) {
            continue;
        }
        for concern in concerns {
            if per_file_only && concern.lint.scope != "per-file" {
                continue;
            }
            if let Some(item) = plan_concern_for_delta(rule_id, concern, changed) {
                plan.push(item);
            }
        }
    }
    plan.sort_by(|a, b| {
        a.rule_id
            .cmp(&b.rule_id)
            .then_with(|| a.concern_id.cmp(&b.concern_id))
    });
    plan
}

/// Точний порт диспетчера `buildPlan` (`run-detectors.mjs:484-512`) — обирає
/// один із п'яти builders за `input.mode` (сам вибір гілки лишається в JS,
/// doc-комент модуля вище; тут лише виконання ВЖЕ обраної гілки).
/// Невідомий/відсутній `mode` тихо мапиться на `"delta"` — той самий
/// «останній `else`»-fallback, що замикає JS `buildPlan`.
pub fn build_lint_plan(input: &BuildLintPlanInput) -> Vec<PlanItem> {
    let enabled: HashSet<&str> = input.enabled_rule_ids.iter().map(String::as_str).collect();
    match input.mode.as_str() {
        "scopedDelta" => {
            build_scoped_delta_plan(&input.by_rule, &input.rules, &input.explicit_files)
        }
        "scoped" => build_scoped_plan(&input.by_rule, &input.rules),
        "repoWide" => build_repo_wide_plan(&input.by_rule, &enabled),
        "full" => build_full_plan(&input.by_rule, &enabled),
        _ => build_delta_plan(&input.by_rule, &enabled, &input.changed, input.path_mode),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn concern(name: &str, scope: &str, glob: &[&str]) -> ConcernPlanInput {
        ConcernPlanInput {
            name: name.to_string(),
            lint: LintSurfaceInput {
                scope: scope.to_string(),
                glob: glob.iter().map(|s| s.to_string()).collect(),
            },
        }
    }

    fn by_rule(
        entries: &[(&str, Vec<ConcernPlanInput>)],
    ) -> BTreeMap<String, Vec<ConcernPlanInput>> {
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    // --- match_lint_globs / picomatch-паритет ---------------------------

    #[test]
    fn match_lint_globs_empty_patterns_matches_nothing() {
        assert_eq!(
            match_lint_globs(&[], &["a.txt".to_string()]),
            Vec::<String>::new()
        );
    }

    #[test]
    fn match_lint_globs_double_star_matches_root_and_nested_files() {
        let patterns = vec!["**/*.mjs".to_string()];
        let files = vec![
            "a.mjs".to_string(),
            "src/b.mjs".to_string(),
            "c.txt".to_string(),
        ];
        assert_eq!(
            match_lint_globs(&patterns, &files),
            vec!["a.mjs", "src/b.mjs"]
        );
    }

    #[test]
    fn match_lint_globs_dot_true_matches_hidden_files() {
        // picomatch({ dot: true }): "**/.env" і "**/*" МАЮТЬ матчити dot-файли —
        // на відміну від concerns::glob_compat (інша семантика, інший споживач).
        let patterns = vec!["**/.env".to_string()];
        assert_eq!(
            match_lint_globs(&patterns, &[".env".to_string()]),
            vec![".env"]
        );

        let star = vec!["**/*".to_string()];
        assert_eq!(match_lint_globs(&star, &[".env".to_string()]), vec![".env"]);
    }

    #[test]
    fn match_lint_globs_brace_alternation() {
        let patterns = vec!["**/*.{js,mjs,ts}".to_string()];
        let files = vec![
            "a.js".to_string(),
            "b.mjs".to_string(),
            "c.ts".to_string(),
            "d.py".to_string(),
        ];
        let mut got = match_lint_globs(&patterns, &files);
        got.sort();
        assert_eq!(got, vec!["a.js", "b.mjs", "c.ts"]);
    }

    #[test]
    fn match_lint_globs_single_star_does_not_cross_segment() {
        // picomatch без globstar: одинарний `*` не перетинає `/`.
        let patterns = vec!["src/*.js".to_string()];
        let files = vec!["src/a.js".to_string(), "src/nested/b.js".to_string()];
        assert_eq!(match_lint_globs(&patterns, &files), vec!["src/a.js"]);
    }

    #[test]
    fn match_lint_globs_literal_pattern_exact_match_only() {
        let patterns = vec![".prettierignore".to_string()];
        let files = vec![
            ".prettierignore".to_string(),
            "sub/.prettierignore".to_string(),
        ];
        assert_eq!(match_lint_globs(&patterns, &files), vec![".prettierignore"]);
    }

    // --- planConcernForDelta ---------------------------------------------

    #[test]
    fn plan_concern_for_delta_per_file_no_glob_takes_all_changed() {
        let c = concern("check", "per-file", &[]);
        let changed = vec!["a.txt".to_string(), "b.txt".to_string()];
        let item = plan_concern_for_delta("probe", &c, &changed).unwrap();
        assert_eq!(item.files, Some(changed));
    }

    #[test]
    fn plan_concern_for_delta_per_file_filters_by_glob() {
        let c = concern("check", "per-file", &["**/*.mjs"]);
        let changed = vec!["a.mjs".to_string(), "b.txt".to_string()];
        let item = plan_concern_for_delta("probe", &c, &changed).unwrap();
        assert_eq!(item.files, Some(vec!["a.mjs".to_string()]));
    }

    #[test]
    fn plan_concern_for_delta_per_file_no_match_returns_none() {
        let c = concern("check", "per-file", &["**/*.mjs"]);
        let changed = vec!["b.txt".to_string()];
        assert!(plan_concern_for_delta("probe", &c, &changed).is_none());
    }

    #[test]
    fn plan_concern_for_delta_full_scope_no_glob_never_triggers() {
        let c = concern("check", "full", &[]);
        let changed = vec!["a.txt".to_string()];
        assert!(plan_concern_for_delta("probe", &c, &changed).is_none());
    }

    #[test]
    fn plan_concern_for_delta_full_scope_triggers_whole_repo_on_any_match() {
        let c = concern("check", "full", &["**/*.mjs"]);
        let changed = vec!["a.mjs".to_string(), "b.txt".to_string()];
        let item = plan_concern_for_delta("probe", &c, &changed).unwrap();
        assert_eq!(item.files, None);
    }

    // --- build_lint_plan / п'ять режимів -----------------------------------

    #[test]
    fn scoped_mode_returns_all_concerns_of_named_rules_whole_repo() {
        let by_rule = by_rule(&[
            (
                "probe",
                vec![
                    concern("perfile", "per-file", &["**/*.js"]),
                    concern("wholerepo", "full", &["**/*.js"]),
                ],
            ),
            ("other", vec![concern("x", "full", &[])]),
        ]);
        let input = BuildLintPlanInput {
            mode: "scoped".to_string(),
            by_rule,
            rules: vec!["probe".to_string()],
            explicit_files: vec![],
            enabled_rule_ids: vec![],
            changed: vec![],
            path_mode: false,
        };
        let plan = build_lint_plan(&input);
        assert_eq!(plan.len(), 2);
        assert!(plan
            .iter()
            .all(|p| p.rule_id == "probe" && p.files.is_none()));
    }

    #[test]
    fn scoped_mode_unknown_rule_id_gives_empty_plan() {
        let by_rule = by_rule(&[("probe", vec![concern("check", "full", &[])])]);
        let input = BuildLintPlanInput {
            mode: "scoped".to_string(),
            by_rule,
            rules: vec!["nope".to_string()],
            explicit_files: vec![],
            enabled_rule_ids: vec![],
            changed: vec![],
            path_mode: false,
        };
        assert_eq!(build_lint_plan(&input), Vec::new());
    }

    #[test]
    fn scoped_delta_mode_only_per_file_concerns_intersected_with_files() {
        let by_rule = by_rule(&[(
            "probe",
            vec![
                concern("perfile", "per-file", &["**/*.js"]),
                concern("wholerepo", "full", &["**/*.js"]),
            ],
        )]);
        let input = BuildLintPlanInput {
            mode: "scopedDelta".to_string(),
            by_rule,
            rules: vec!["probe".to_string()],
            explicit_files: vec!["a.js".to_string(), "b.txt".to_string()],
            enabled_rule_ids: vec![],
            changed: vec![],
            path_mode: false,
        };
        let plan = build_lint_plan(&input);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].concern_id, "perfile");
        assert_eq!(plan[0].files, Some(vec!["a.js".to_string()]));
    }

    #[test]
    fn repo_wide_mode_only_full_scope_of_enabled_rules() {
        let by_rule = by_rule(&[
            (
                "probe",
                vec![
                    concern("perfile", "per-file", &["**/*.js"]),
                    concern("wholerepo", "full", &[]),
                ],
            ),
            ("disabled", vec![concern("full", "full", &[])]),
        ]);
        let input = BuildLintPlanInput {
            mode: "repoWide".to_string(),
            by_rule,
            rules: vec![],
            explicit_files: vec![],
            enabled_rule_ids: vec!["probe".to_string()],
            changed: vec![],
            path_mode: false,
        };
        let plan = build_lint_plan(&input);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].concern_id, "wholerepo");
        assert_eq!(plan[0].files, None);
    }

    #[test]
    fn full_mode_includes_per_file_and_full_of_enabled_rules() {
        let by_rule = by_rule(&[(
            "probe",
            vec![
                concern("perfile", "per-file", &["**/*.js"]),
                concern("wholerepo", "full", &[]),
            ],
        )]);
        let input = BuildLintPlanInput {
            mode: "full".to_string(),
            by_rule,
            rules: vec![],
            explicit_files: vec![],
            enabled_rule_ids: vec!["probe".to_string()],
            changed: vec![],
            path_mode: false,
        };
        let plan = build_lint_plan(&input);
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].concern_id, "perfile");
        assert_eq!(plan[1].concern_id, "wholerepo");
        assert!(plan.iter().all(|p| p.files.is_none()));
    }

    #[test]
    fn delta_mode_matches_glob_against_changed_and_sorts_by_rule_then_concern() {
        let by_rule = by_rule(&[
            ("zzz", vec![concern("check", "per-file", &["**/*.mjs"])]),
            ("aaa", vec![concern("check", "per-file", &["**/*.mjs"])]),
        ]);
        let input = BuildLintPlanInput {
            mode: "delta".to_string(),
            by_rule,
            rules: vec![],
            explicit_files: vec![],
            enabled_rule_ids: vec!["zzz".to_string(), "aaa".to_string()],
            changed: vec!["x.mjs".to_string()],
            path_mode: false,
        };
        let plan = build_lint_plan(&input);
        assert_eq!(
            plan.iter().map(|p| p.rule_id.as_str()).collect::<Vec<_>>(),
            vec!["aaa", "zzz"]
        );
    }

    #[test]
    fn delta_mode_path_mode_excludes_full_scope_concerns() {
        let by_rule = by_rule(&[(
            "probe",
            vec![
                concern("perfile", "per-file", &["**/*.js"]),
                concern("wholerepo", "full", &["**/*.js"]),
            ],
        )]);
        let with_path_mode = BuildLintPlanInput {
            mode: "delta".to_string(),
            by_rule: by_rule.clone(),
            rules: vec![],
            explicit_files: vec![],
            enabled_rule_ids: vec!["probe".to_string()],
            changed: vec!["x.js".to_string()],
            path_mode: true,
        };
        let plan = build_lint_plan(&with_path_mode);
        assert_eq!(
            plan.iter()
                .map(|p| p.concern_id.as_str())
                .collect::<Vec<_>>(),
            vec!["perfile"]
        );

        let without_path_mode = BuildLintPlanInput {
            path_mode: false,
            ..with_path_mode
        };
        let plan2 = build_lint_plan(&without_path_mode);
        assert_eq!(
            plan2
                .iter()
                .map(|p| p.concern_id.as_str())
                .collect::<Vec<_>>(),
            vec!["perfile", "wholerepo"]
        );
        assert_eq!(plan2[1].files, None);
    }

    #[test]
    fn delta_mode_disabled_rule_excluded() {
        let by_rule = by_rule(&[("probe", vec![concern("check", "per-file", &[])])]);
        let input = BuildLintPlanInput {
            mode: "delta".to_string(),
            by_rule,
            rules: vec![],
            explicit_files: vec![],
            enabled_rule_ids: vec![], // "probe" НЕ enabled
            changed: vec!["a.txt".to_string()],
            path_mode: false,
        };
        assert_eq!(build_lint_plan(&input), Vec::new());
    }
}
