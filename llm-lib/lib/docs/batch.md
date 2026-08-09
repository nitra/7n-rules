---
type: JS Module
title: batch.mjs
resource: llm-lib/lib/batch.mjs
docgen:
  crc: 1f69a064
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тип 2b (OpenAI-сумісний API, batch) — `submitBatch` завжди йде через
справжній `/v1/batches` OpenAI-сумісний batch-adapter резолвленого
провайдера (спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`).
Клієнтську емуляцію (v1, чанкований прогін через Тип 2a) вилучено —
провайдер без зареєстрованого `base_url`/`api_key` у `localProviders`
повертає явну помилку, без тихого фолбеку.

Тонкий JS-клієнт до Rust-крейта `llm_lib::batch`/`llm_lib::remote_batch`
через napi FFI in-process (`llm-lib/crates/llm-lib-napi`) — жодного
власного HTTP тут (анти-приклад, якого це узагальнює: `mlmail/use-summary.js`
чанкує переклади проти omlx вручну, з вистражданими лімітами).

## Публічний API

- submitBatch — Batch-виклик Типу 2b. `modelSpecOrTier` — той самий контракт, що й у
[`oneShotLocalCloud`] з `local-cloud.mjs`: явний `"provider/model-id"`
абстрактний тир (`min`/`avg`/`max`) або явний env-selector.

## Сценарії використання

- `llm-lib/tests/batch.test.mjs` (submitBatch) — делегує modelSpecOrTier/items у native.submitBatch і віддає його результат; явний; кожен item нормалізується до {customId, prompt, system}, навіть без власного system; localProviders/system/pollIntervalMs/pollTimeoutMs прокидаються в options/config; onProgress прокидається останнім аргументом; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
