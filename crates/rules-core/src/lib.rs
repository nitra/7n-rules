//! Rust-ядро `@7n/rules` — з часом бере на себе deterministic rule engine,
//! Git-запити, filesystem scan, diagnostics, cache і fix plans (план
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! # Філософія
//!
//! **Інкрементальна межа, без JS-fallback.** Кожен use case мігрує окремо,
//! з behavior-parity-гейтом до видалення відповідної JS-гілки (Р1 спеки) —
//! на відміну від `llm-lib`, тут немає ескалаційної драбини всередині
//! крейта: `rules-core` відповідає на конкретні запити (git, fs, diagnostics)
//! через тонкий синхронний [`dto`]-контракт, а композицію робить викликач
//! (`rules-napi` → JS-фасади в `npm/scripts/lib/*`).
//!
//! **Синхронна поверхня.** Споживачі (`rules-napi`) викликають функції
//! синхронно (Р2 спеки) — жодного `tokio_rt` на цьому боці межі.

/// `resolve_changed_base` — Git-запити до commit-graph (T3 фази 1).
pub mod changed_base;
/// `collect_changed_files`/`collect_changed_files_since` — перелік
/// changed files через porcelain (C1 фази 3).
pub mod changed_files;
/// Native-порти детермінованих concern-ів + registry (E1 фази 5).
pub mod concerns;
/// Diagnostics DTO (`Violation`/`Severity`) — versioned JSON-межа для
/// detector-результатів (Р10 спеки, E1 фази 5).
pub mod diagnostics;
/// Versioned JSON DTO-межа з `rules-napi` (Р10 спеки).
pub mod dto;
/// `build_lint_plan`/`match_lint_globs` — plan-контур lint-оркестрації
/// (P1 фази 7, `buildPlan` + п'ять builders з `run-detectors.mjs`).
pub mod lint_plan;
/// `sort_violations`/`render_violations`/`compute_exit_code` — sort/render/
/// exit-code контур lint-оркестрації (R1 фази 7, другий зріз після
/// `lint_plan`: `sortViolations`/`renderViolations`/exit-code гілка
/// `detectAll` з `run-detectors.mjs`/`render.mjs`).
pub mod lint_render;
/// `locale_compare` — наближення ICU root collation
/// (`String.prototype.localeCompare`) для портів JS-сортувань списків, які
/// потрапляють у вивід CLI (зріз 2 фази 8).
pub mod locale;
/// `rename_yaml_extensions` — порт `npm/scripts/rename-yaml-extensions.mjs`
/// (зріз 2 фази 8).
pub mod rename_yaml;
/// `walk_dir` — native filesystem scan, точний порт `walkDir` (D1 фази 4а).
pub mod scan;
/// `list_skill_ids` — порт `listSkillIds` (`npm/scripts/skills-cli.mjs`),
/// рушій `skill list` (зріз 2 фази 8).
pub mod skills;
/// Worktree lifecycle через `mt-core` (Р3 спеки, фаза 2 задача B1).
pub mod worktree;

/// Помилка `rules-core`. Навмисно плоска, за зразком `llm_lib::LlmError` —
/// категорії додаються варіантами по мірі міграції use case-ів.
#[derive(Debug, thiserror::Error)]
pub enum RulesError {
    /// Помилка Git-запиту (merge-base, is-ancestor, rev-parse тощо).
    #[error("{0}")]
    Git(String),
    /// Помилка worktree lifecycle через `mt-core` (create/remove — Р3 спеки).
    #[error("{0}")]
    Worktree(String),
    /// Помилка native-concern registry (невідомий ключ — E1 фази 5).
    #[error("{0}")]
    Concern(String),
}
