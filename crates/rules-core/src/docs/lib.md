---
type: Rust Module
title: lib.rs
resource: crates/rules-core/src/lib.rs
docgen:
  crc: b4185f7f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Rust-ядро `@7n/rules` — з часом бере на себе deterministic rule engine, Git-запити, filesystem scan, diagnostics, cache і fix plans (план `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).  # Філософія  **Інкрементальна межа, без JS-fallback.** Кожен use case мігрує окремо, з behavior-parity-гейтом до видалення відповідної JS-гілки (Р1 спеки) — на відміну від `llm-lib`, тут немає ескалаційної драбини всередині крейта: `rules-core` відповідає на конкретні запити (git, fs, diagnostics) через тонкий синхронний [`dto`]-контракт, а композицію робить викликач (`rules-napi` → JS-фасади в `npm/scripts/lib/*`).  **Синхронна поверхня.** Споживачі (`rules-napi`) викликають функції синхронно (Р2 спеки) — жодного `tokio_rt` на цьому боці межі.

## Публічний API

- RulesError — Помилка `rules-core`. Навмисно плоска, за зразком `llm_lib::LlmError` — категорії додаються варіантами по мірі міграції use case-ів.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
