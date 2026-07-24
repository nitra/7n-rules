---
type: JS Module
title: batch.mjs
resource: llm-lib/lib/batch.mjs
docgen:
  crc: 4412e8c2
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тонкий JS-клієнт до `llm_lib::batch` у `llm-lib/crates/llm-lib-napi`, який через in-process `napi FFI` лише емулює Type 2b у v1: під одним `submit → progress → results` інтерфейсом він прокидає batch-запит у `llm_lib::local_cloud` і повертає результат як сумісний OpenAI Batch API-контракт для майбутнього `/v1/batches`. Єдина публічна точка входу — `submitBatch`. Це узагальнення анти-прикладу на кшталт `mlmail/use-summary.js`, де чанкінг доводиться робити вручну під обмеження провайдера.

## Поведінка

1. `submitBatch` приймає batch-запит для Type 2b і передає його в native-реалізацію, щоб отримати той самий бізнес-інтерфейс `submit → progress → results`, який очікується від batch-потоку поверх локальних провайдерів.
2. `submitBatch` зберігає порядок вхідних items у результатах, щоб кожен результат можна було зіставити з початковим `customId`.
3. `submitBatch` нормалізує вхідні items перед передачею далі: бере `customId` і `prompt` як є, а відсутній `system` не підміняє значенням.
4. `submitBatch` передає конфіг локальних провайдерів, загальний `system`, а також ліміти chunking і concurrency у native-шар, щоб контроль виконання залишався в реалізації batch-крейта.
5. `submitBatch` підтримує `onProgress`, щоб викликати повідомлення про хід виконання під час обробки batch-у.
6. `submitBatch` дозволяє підмінити native-реалізацію для тестів, не змінюючи зовнішню поведінку публічного API.

## Публічний API

- submitBatch — Емуляція batch-виклику Типу 2b. `modelSpecOrTier` — той самий контракт,
що й у [`oneShotLocalCloud`] з `local-cloud.mjs`: явний
`"provider/model-id"` або абстрактний тир (`min`/`avg`/`max`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
