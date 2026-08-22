//! Семантичні гейти package knowledge — Rust-порт LLM-контуру `docs build`
//! (клас 1 спеки `2026-08-08-llm-lib-acp-only-rust-goose.md`).
//!
//! Два гейти, обидва — верифікатори, жоден нічого не синтезує:
//!
//! - [`entailment`] — чи випливає кожне поле claim-а з ТОЧНОГО тексту його
//!   evidence (порт `entailment.mjs`);
//! - [`gap_mappings`] — які expected claims вже реалізовані, які
//!   спростовані, а які лишились невизначеними (порт `gap-mappings.mjs`).
//!
//! Спільне для обох і головне в порті:
//!
//! 1. **Детермінізм перед моделлю.** Точні канонічні збіги, malformed граф,
//!    відсутній evidence-текст — усе вирішується локально; модель бачить
//!    рівно те, що без неї не вирішується.
//! 2. **Кеш на успішних відповідях.** Ключ — [`deterministic::canonical_hash`]
//!    входу; попадання не коштує виклику. Тому формула хеша тут — контракт,
//!    а не деталь реалізації (див. доккоментар модуля).
//! 3. **Драбина тирів замість одного виклику.** Промах піднімається на
//!    наступну сходинку [`wave::default_model_policy`]; що не пройшло всі —
//!    блокер, а не мовчазне «ок».
//!
//! # Чого тут ще немає
//!
//! Це LLM-контур, а не вся команда `docs build`: детермінований конвеєр
//! (candidate, chunk-planner, render, publish, runner) лишається в JS до
//! свого зрізу. Гейти вже приймають [`wave::ChainRef`] ззовні саме тому, що
//! коли runner переїде, ОДИН ланцюжок має накрити весь build.

/// Побудова evidence-backed implemented claims через batch map/reduce.
pub mod claims;
/// Канонічний JSON, `sha256:`-хеш і versioned-кеш успішних відповідей.
pub mod deterministic;
/// Верифікатор evidence-entailment.
pub mod entailment;
/// Comparator expected↔implemented claims.
pub mod gap_mappings;
/// Планувальник bounded semantic chunks і хвиль залежностей.
pub mod planner;
/// Транспорт хвиль: інʼєкція batch-фасаду, драбина тирів, ланцюжок задачі.
pub mod wave;

pub use claims::{build_structured_claims, ClaimsInput, ClaimsOutcome};
pub use deterministic::{canonical_hash, canonical_json, VersionedCache};
pub use entailment::{verify_evidence_entailment, EntailmentInput, EntailmentOutcome};
pub use gap_mappings::{compare_claim_mappings, GapMappingInput, GapMappingOutcome, Mapping};
pub use planner::{plan_semantic_chunks, Plan, PlanOutcome, PlannerInput, SourceText};
pub use wave::{
    default_model_policy, native_submit_batch, new_chain, ChainRef, SubmitBatchFn, WaveItem,
    WaveResult,
};
