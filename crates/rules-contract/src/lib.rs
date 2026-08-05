//! `rules-contract` — нижній шар WIT-контракту `@7n/rules` plugin v3
//! (`docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`, задача I1
//! кроку 1a фази 6).
//!
//! # Місце в шаруванні
//!
//! `rules-contract` навмисно **не залежить** від `rules-core`: контракт v3 —
//! нижній, платформо-незалежний шар, який `rules-core` (пізніше, поза цією
//! задачею) почне використовувати як межу для builtin-концернів, що
//! дзеркалять wasm-плагіни (рішення И спеки — принцип dogfood, один trait
//! для `rules-core` і зовнішніх wasm-плагінів). Залежність — лише в один бік:
//! `rules-core` → `rules-contract`, ніколи навпаки.
//!
//! # Дублювання `Violation`/`Severity` — план злиття
//!
//! [`diagnostic::Diagnostic`]/[`diagnostic::Severity`] — точний структурний
//! дублікат `rules_core::diagnostics::Violation`/`Severity`
//! (`crates/rules-core/src/diagnostics.rs`, `CONTRACT_VERSION = 2`), а не
//! реекспорт: якби `rules-contract` імпортував типи з `rules-core`, залежність
//! пішла б у забороненому напрямку (нижній шар не може залежати від
//! верхнього). Дублікат — свідомий проміжний стан, задокументований тут:
//!
//!   1. Коли `rules-core` перейде на `rules-contract` як межу (окрема задача
//!      після I1/I2), `rules_core::diagnostics::Violation` стає **псевдонімом**
//!      (`pub use rules_contract::diagnostic::Diagnostic as Violation`) або
//!      конвертується через `From`/`Into` на межі `rules-napi` — яка з двох
//!      форм ближче з'ясується вже за наявності `rules-plugin-host` (I2), який
//!      реально споживає обидва боки.
//!   2. До того моменту parity між формами тримають дзеркальні unit-тести
//!      (див. `diagnostic::tests`) — та сама методика, що синхронізує
//!      `rules-core`-детектори з JS-оригіналами під час міграції (план
//!      злиття зафіксовано саме в цьому коментарі, окремого ADR не заведено).

/// `SourceFile`/`DetectBatch` — вхід lint-домену (`export detect`, WIT
/// `world plugin`): хост передає вміст файлів inline, плагін не читає диск.
pub mod detect;
/// `Diagnostic`/`Severity` — дзеркало diagnostics DTO `rules-core`
/// (`CONTRACT_VERSION = 2`), точний структурний дублікат без залежності
/// на `rules-core` (план злиття — у doc-коментарі модуля цього файлу вище).
pub mod diagnostic;
/// `DomainError` + мінімальні домени поза lint (`ecosystem-outdated`,
/// `docgen-render`) — рішення К спеки: один world з усіма інтерфейсами.
pub mod domain;
/// `FixRequest`/`FixPlan`/`FileEdit`/`WriteFile` — вхід/вихід lint-домену
/// (`export fix`), v3.0-мінімум: повний новий вміст файлу, без
/// декларативного patch-формату.
pub mod fix;
/// `Manifest`/`Capabilities`/`Domain` — те, що повертає `export describe`,
/// плюс JSON Schema (`schemars`) для скіла авторингу плагінів.
pub mod manifest;
/// DTO типів окремих WIT-пакетів слот-payload-ів (`n-rules:slots`) —
/// незалежний від `n-rules:plugin` цикл версіонування (рішення Л).
pub mod slots;
/// `ToolOutput`/`LogLevel` — host-функції `run-tool`/`log` (plugin → host),
/// плюс `ToolRequest`/`ToolResult`/`ScratchFile` — DTO `exec-tool` (зріз 5
/// контракту v3.1: `run-tool` плюс cwd/env/scratch-обмін).
pub mod tool;
/// Host-валідатори — семантичні перевірки, які WIT-типізація не покриває
/// (safe-path, id-regex), порт `npm/scripts/lib/slot-contracts-ci.mjs`.
pub mod validators;
/// Константи версії world/пакетів контракту (продовження `CONTRACT_VERSION`
/// diagnostics DTO — рішення З спеки).
pub mod version;
