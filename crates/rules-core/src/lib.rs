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
/// Versioned JSON DTO-межа з `rules-napi` (Р10 спеки).
pub mod dto;
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
}
