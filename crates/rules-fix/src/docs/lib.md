---
type: Rust Module
title: lib.rs
resource: crates/rules-fix/src/lib.rs
docgen:
  crc: c03e7190
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
---

## Огляд

Склейка контуру `fix` (`llm_lib::fix::*`) з реальним lint-детектором і метаданими concern-ів `rules-core` — зріз 7 (`crates/rules-fix`).  # Чому окремий крейт, а не всередині `rules-core`  `rules-core` навмисно бере `llm-lib` з `default-features = false` (лише `tiers`), щоб у lint-адоні не було важкого async/HTTP/rig-стеку — задокументовано в `llm-lib/crates/llm-lib/Cargo.toml` (рішення Р9) і в шапці `rules-core/src/lib.rs`. Цей крейт залежить від `rules-core` (домен lint-у) і від `llm-lib` зі звичайним набором фіч (цикл `fix`), тож важкі залежності потрапляють лише туди, де фікс РЕАЛЬНО виконується.  # Модулі  - [`violation_map`] — переклад `rules_core::diagnostics::Violation` ⇄ `harness::pipeline::Violation`, і `Fixability` ⇄ `Fixability`; - [`detect`] — канонічний детектор (`DetectFn`) поверх `rules_core::concerns::run_concern` і межа редагування (`target_files`), яку рахуємо з його першого прогону; - [`verify`] — `FixDeps::verify` одного attempt-у: канонічний прогін + test-gate (`compose_verify_report`); - [`config`] — `PipelineConfig` з `ConcernMeta` (fixability, драбина); - [`attempt`] — `PipelineDeps::attempt`, обгортка над `llm_lib::fix::runner::run_attempt` (там-таки доккомент про відому прогалину з `AttemptContext::capture` — звіт задачі).

## Публічний API

- ConcernRun — Результат прогону одного concern-а в межах спільного прогону ([`fix_concerns`]).
- fix_concerns — Прогонить кілька concern-ів ПОСЛІДОВНО зі СПІЛЬНИМ бюджетом найдорожчого тиру.  Спільний бюджет — не деталь реалізації, а вимога спеки (рішення И `2026-08-08-llm-lib-acp-only-rust-goose.md`): кеп cloud-avg рахується на весь прогін, а не на concern. Інакше двадцять concern-ів отримали б двадцять окремих бюджетів найдорожчої моделі — рівно та вартість, від якої кеп і має захищати.  Послідовно, а не паралельно, теж навмисно: кожен concern бере snapshot робочого дерева й відкочує його на провалі, тож паралельні прогони затирали б відкати один одного.
- fix_concern — Публічний вхід крейта: прогонить один concern (`ruleId/concernId`) через петлю `fix` — реальний детектор + реальні метадані concern-а (`concern.json`) замість інʼєкцій-заглушок.  `files` — той самий per-file scope, що йде і в `rules_core::concerns::run_concern` (posix-relative, дзеркало `LintContext.files`); whole-repo concern-и ігнорують його як і раніше.  # Errors [`FixConcernError::InvalidKey`] — `key` не `ruleId/concernId`; [`FixConcernError::MissingPackageRoot`] — не резолвився корінь встановленого `@7n/rules` (`rules_root`); [`FixConcernError::MissingConcernMeta`] — немає/невалідний `concern.json`; [`FixConcernError::Detect`] — провалився перший (розвідувальний) прогін детектора; [`FixConcernError::Pipeline`] — провалилась сама петля `fix`.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
