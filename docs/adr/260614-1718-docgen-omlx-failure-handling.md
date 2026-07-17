---
type: ADR
title: "Docgen: класифікація omlx-помилок і recovery"
description: Docgen-оркестратор має класифікувати omlx-збої на transient, systemic і permanent та реагувати retry, circuit breaker або skip.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`docgen-files-batch.mjs` обробляв усі збої виклику omlx однаково: `catch → ✗ → push → continue`. У transcript зафіксовано, що після `memory ceiling` на одному файлі наступні приблизно 200 файлів теж падали каскадом, хоча проблема була системною, а не повʼязаною зі змістом кожного файла. Окремо зафіксовано permanent-випадок `Prompt too long: 9177917 tokens` для vendored/minified файла, де retry не може допомогти.

## Considered Options

- Залишити поточну поведінку: єдиний `catch`, без класифікації.
- Триступенева класифікація `transient | systemic | permanent` з різними стратегіями реакції.
- Скидати KV-/prompt-cache між файлами через `/admin/api/hot-cache/clear` або `/admin/api/ssd-cache/clear`.
- Вивантажувати конкурентну модель через `POST /v1/models/{id}/unload` у preflight або recovery.

## Decision Outcome

Chosen option: "Триступенева класифікація `transient | systemic | permanent` з recovery через retry, circuit breaker, skip і unload конкурентних моделей", because transcript показує різні причини збоїв: `ETIMEDOUT` потребує retry з backoff, `memory ceiling` потребує зупинки каскаду та recovery, а `Prompt too long` має бути deterministic skip без повторів.

### Consequences

- Good, because transient-збої на кшталт `spawnSync curl ETIMEDOUT` отримують шанс на відновлення через retry з backoff замість негайного провалу.
- Good, because systemic-збої на кшталт `memory ceiling` зупиняють батч через streak/circuit breaker і не витрачають curl-раунди на решту файлів.
- Good, because permanent-збої на кшталт `Prompt too long` потрапляють в окремий `skipped[]` і не засмічують чергу повторного прогону.
- Good, because preflight/recovery може вивантажувати конкурентну модель через `POST /v1/models/{id}/unload`, якщо в памʼяті одночасно перебувають несумісні gemma-моделі.
- Bad, because transcript не містить підтвердження негативних наслідків для класифікації; пороги retry, backoff і K підряд systemic-збоїв лишилися незафіксованими.
- Neutral, because transcript фіксує, що скидання hot-cache не обрано: per-request KV-cache omlx звільняє автоматично, а prefix/hot-cache може бути корисним для повторного system-prompt docgen.

## More Information

- Основний файл оркестратора: `npm/rules/doc-files/js/docgen-files-batch.mjs`.
- Транспортний шар: `npm/lib/omlx.mjs`.
- Зародок класифікації вже був у `omlxHealthCheck` (`npm/lib/llm.mjs:137-150`): `memory ceiling→memory-guard`, `curl→down`.
- Зафіксовані помилки: `spawnSync curl ETIMEDOUT` (transient), `Cannot load … memory ceiling` (systemic), `Prompt too long: 9177917 tokens` (permanent).
- Vendored/minified приклад: `run/auth/src/lib/lib/euscp.js` або `run/auth/src/lib/lib/eusc*.js`.
- omlx API, зафіксовані transcript: `GET /v1/models/status`, `POST /v1/models/{id}/unload`, `POST /v1/models/{id}/load`.
- Preflight у `docgen-files-batch.mjs:66-80` уже викликав `omlxHealthCheck`.

## Update 2026-06-14

Драфт уточнює очікувані класи помилок для `docgen-files-batch.mjs`: `spawnSync curl ETIMEDOUT` як transient, `memory ceiling exceeded` як systemic, `Prompt too long: 9177917 tokens` як permanent. Для systemic-збоїв запропоновано circuit-breaker після K підряд помилок; для permanent — окремий `skipped[]`; для transient — retry з backoff. Також зафіксовано, що `omlxHealthCheck` у `npm/lib/llm.mjs:137-150` уже має зародок мапінгу `memory ceiling→memory-guard`, `omlx curl→down`.

## Update 2026-06-14

Драфт додає конкретні реакції на класи помилок: `ETIMEDOUT` і `curl exit 18/52/56` мають іти у retry з exponential backoff; `memory ceiling` і недоступний сервер — у streak-лічильник із circuit breaker; `Prompt too long` — у `⊘ skip` без ретраю. Окремо зафіксовано, що `omlx.mjs:144-147` тоді спрямовував `ETIMEDOUT` у `break`, а не в retry, і що endpoint для скидання моделей/кешу ще досліджувався.
