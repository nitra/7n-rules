---
type: JS Module
title: batch.mjs
resource: llm-lib/lib/batch.mjs
docgen:
  crc: 10b603cc
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тип 2b (OpenAI-сумісний API, batch) — **лише емуляція** у v1 (рішення Р,
задача T6): чанкований конкурентний прогін через Тип 2a
(`llm_lib::local_cloud`) під інтерфейсом `submit → progress → results` —
той самий інтерфейс, яким говорив би й справжній OpenAI Batch API
(`/v1/batches`, v2), якому локальний omlx (перший споживач) не має.

Тонкий JS-клієнт до Rust-крейта `llm_lib::batch` через napi FFI
in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного чанкінгу
тут (анти-приклад, якого це узагальнює: `mlmail/use-summary.js` чанкує
переклади проти omlx вручну, з вистражданими лімітами).

## Публічний API

- submitBatch — Емуляція batch-виклику Типу 2b. `modelSpecOrTier` — той самий контракт,
що й у [`oneShotLocalCloud`] з `local-cloud.mjs`: явний
`"provider/model-id"` або абстрактний тир (`min`/`avg`/`max`).

## Сценарії використання

- `llm-lib/tests/batch.test.mjs` (submitBatch) — делегує modelSpecOrTier/items у native.submitBatch і віддає його результат; явний; кожен item нормалізується до {customId, prompt, system}, навіть без власного system; localProviders/system/chunkSize/concurrency прокидаються в options/config; onProgress прокидається останнім аргументом; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
