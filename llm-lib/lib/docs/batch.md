---
type: JS Module
title: batch.mjs
resource: llm-lib/lib/batch.mjs
docgen:
  crc: 5e13af10
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тип 2b (OpenAI-сумісний API, batch) — `submitBatch` обирає між клієнтською
емуляцією (v1, чанкований конкурентний прогін через Тип 2a
`llm_lib::local_cloud`) і справжнім `/v1/batches` litellm batch-adapter-а
(спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`), під тим
самим інтерфейсом `submit → progress → results` для обох. Вибір —
`backend` (дефолт `'auto'`: реальний Batch API лише коли резолвлений
провайдер `litellm` і кешована мережева проба адаптера пройшла; локальний
omlx завжди йде емуляцією).

Тонкий JS-клієнт до Rust-крейта `llm_lib::batch`/`llm_lib::remote_batch`
через napi FFI in-process (`llm-lib/crates/llm-lib-napi`) — жодного
власного чанкінгу чи HTTP тут (анти-приклад, якого це узагальнює:
`mlmail/use-summary.js` чанкує переклади проти omlx вручну, з
вистражданими лімітами).

## Поведінка

submitBatch повертає результати в тому ж порядку, що й вхідні items; для кожного item результат містить або `ok`, або `error`.

Для кожного item `customId` має бути унікальним у межах одного виклику; конфлікт ідентифікаторів лишається на стороні викликача.

За помилок виконання batch у відповіді зберігається один результат на кожен вхідний item, тож користувацький контракт не зводиться до часткової втрати елементів.

`onProgress`, якщо заданий, отримує агрегований прогрес виконання для всього набору items.

## Публічний API

- submitBatch — Batch-виклик Типу 2b. `modelSpecOrTier` — той самий контракт, що й у
[`oneShotLocalCloud`] з `local-cloud.mjs`: явний `"provider/model-id"`
або абстрактний тир (`min`/`avg`/`max`).

## Сценарії використання

- `llm-lib/tests/batch.test.mjs` (submitBatch) — делегує modelSpecOrTier/items у native.submitBatch і віддає його результат; явний; кожен item нормалізується до {customId, prompt, system}, навіть без власного system; localProviders/system/chunkSize/concurrency прокидаються в options/config; onProgress прокидається останнім аргументом; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
