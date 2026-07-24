---
type: JS Module
title: local-cloud.mjs
resource: llm-lib/lib/local-cloud.mjs
docgen:
  crc: fc09aee2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає Node-доступ до одного OpenAI-сумісного запиту `chat/completions` для локального або хмарного провайдера через спільний Rust-шар. `oneShotLocalCloud` існує як тонкий JS-вхід до `llm_lib::local_cloud` через `napi FFI in-process` у `llm-lib/crates/llm-lib-napi`, щоб визначення моделей, конфігурація локальних провайдерів і HTTP-взаємодія залишалися в єдиній реалізації без окремого клієнта в JS і без агентського циклу.

## Поведінка

1. `oneShotLocalCloud` приймає запит на один OpenAI-сумісний chat-виклик для локального або хмарного провайдера без агентського циклу.
2. Визначає цільову модель як явну специфікацію провайдера або як абстрактний тир, щоб використовувати спільне правило резолву моделей із Rust-шару.
3. Передає текст користувача, optional system-повідомлення та конфігурацію локальних провайдерів до in-process Rust-клієнта через napi FFI.
4. Делегує HTTP-взаємодію з OpenAI-compatible ендпоінтом Rust-реалізації, щоб у JS-шарі не виникало окремого клієнта й розрізненого читання `settings.json`.
5. Повертає текст відповіді моделі як результат одного синхронного за сценарієм запиту.

## Публічний API

- oneShotLocalCloud — Один chat-виклик Типу 2a. `modelSpecOrTier` — або явний `"provider/model-id"`,
або абстрактний тир (`min`/`avg`/`max`, рішення К), що резолвиться в Rust
через ту саму [`llm_lib::resolve_model`], що й `resolveModel` з
`model-tiers.mjs`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
