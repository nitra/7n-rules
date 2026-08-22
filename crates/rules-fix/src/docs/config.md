---
type: Rust Module
title: config.rs
resource: crates/rules-fix/src/config.rs
docgen:
  crc: 1008a5c8
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
---

## Огляд

Побудова `harness::pipeline::PipelineConfig` з `rules_core::concern_meta::ConcernMeta` (`concern.json` конкретного concern-а): `fixability` мапиться через [`crate::violation_map::to_pipeline_fixability`], драбина звужується ТУТ (`select_ladder` із `meta.skip_local_tier`/`meta.cloud_timeout_ms`), а `policy` виставляється так, щоб повторне звуження всередині `run_fix` було no-op — див. доккоментар [`build_pipeline_config`].

## Публічний API

- build_pipeline_config — Складає [`PipelineConfig`] для одного прогону петлі `fix` над одним concern-ом. `target_files` — межа редагування (типово: файли з початкового прогону детектора, [`crate::detect::target_files_from_violations`]).  `key` — повний ключ concern-а (`"<rule>/<concern>"`), а не `meta.name`: саме він іде в `PipelineConfig::unit` як одиниця роботи агрегатного рядка ланцюжка. `meta.name` — лише basename каталогу (`"cspell"`), тож однойменні концерни різних правил злились би для аналітики в одну одиницю; повний ключ — той самий простір імен, яким concern адресують CLI й реєстр.  # Чому драбина звужується тут, а не в `run_fix`  Новий контракт `PipelineConfig::ladder` очікує ПОВНУ драбину і звужує її сам (`select_ladder` за `policy`) — але той внутрішній виклик передає `cloud_timeout_ms: None` літерально, тож per-concern `meta.cloud_timeout_ms` через нього НЕ проноситься. Звуження тут, із таймаутом concern-а, плюс `policy.local_rungs`/`egress`, під якими внутрішнє повторне звуження ідемпотентне над уже звуженим набором, — зберігає поведінку `meta.cloud_timeout_ms` без зміни API harness.  # Errors Порожня драбина після звуження (`skip_local_tier` без жодної хмарної моделі в env) — текстом, придатним для діагностики CLI.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
