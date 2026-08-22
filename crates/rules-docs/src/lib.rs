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
/// Накладання шару expected-claims.
pub mod expected;
/// Comparator expected↔implemented claims.
pub mod gap_mappings;
/// Детерміновані вердикти по expected-шару.
pub mod gaps;
/// Побудова нормалізованого knowledge-графа з мовних фрагментів.
pub mod graph;
/// Privacy-safe зріз впливу для однієї теми.
pub mod impact;
/// Планувальник bounded semantic chunks і хвиль залежностей.
pub mod planner;
/// Атомарна публікація артефактів у дерево `docs/`.
pub mod publish;
/// Детерміновані Markdown- і manifest-проєкції графа.
pub mod render;
/// Виявлення стабільних тем домену.
pub mod topics;
/// Транспорт хвиль: інʼєкція batch-фасаду, драбина тирів, ланцюжок задачі.
pub mod wave;
/// Зони згенерованого Markdown: розбір, запис AUTOGEN, захист авторського.
pub mod zones;

pub use claims::{build_structured_claims, ClaimsInput, ClaimsOutcome};
pub use deterministic::{canonical_hash, canonical_json, VersionedCache};
pub use entailment::{verify_evidence_entailment, EntailmentInput, EntailmentOutcome};
pub use expected::{apply_expected_overlay, OverlayOutcome};
pub use gap_mappings::{compare_claim_mappings, GapMappingInput, GapMappingOutcome, Mapping};
pub use gaps::{evaluate_gaps, Gap, GapInput, GapOutcome};
pub use graph::{
    build_normalized_graph, create_code_unit_id, serialize_knowledge_graph, Domain, GraphOutcome,
};
pub use impact::{create_impact_slice, ImpactSlice};
pub use planner::{plan_semantic_chunks, Plan, PlanOutcome, PlannerInput, SourceText};
pub use publish::{publish_knowledge_artifacts, PublishOutcome, ValidationOutcome};
pub use render::{render_knowledge_artifacts, RenderOutcome};
pub use topics::{collect_reachable_node_ids, discover_topics, resolve_topic, Topic};
pub use wave::{
    default_model_policy, native_submit_batch, new_chain, ChainRef, SubmitBatchFn, WaveItem,
    WaveResult,
};
pub use zones::{
    apply_autogen_updates, assert_protected_zones_preserved, parse_knowledge_zones, zone_hash,
};
