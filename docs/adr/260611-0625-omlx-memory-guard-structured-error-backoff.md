---
type: ADR
title: "omlx `memory-guard` як окремий клас помилки для intelligent backoff"
---

# ADR: omlx `memory-guard` як окремий клас помилки для intelligent backoff

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

При масовому прогоні `doc-files gen` на 8GB Mac M2 omlx-сервер іноді відмовляє у завантаженні моделі (3.5GB), коли поточне RAM-споживання машини перевищує динамічну стелю. До Кроку 0 preflight не розрізняв цю ситуацію від «сервер зламаний» — і зупинявся з однаковим повідомленням про помилку. Це приводило до того, що правильний відгук («зачекай, поки пам'ять звільниться») та неправильний («підніми omlx serve») злипалися в одній гілці обробки.

## Considered Options

* Розрізняти `down` / `memory-guard` / `auth` / `error` у типі відповіді та обробляти окремо.
* Вважати будь-яку відмову сервера «fatal» і зупиняти прогін одразу.

## Decision Outcome

Chosen option: "Розрізняти типи preflight-помилки", because omlx API повертає `message` з рядком `"memory ceiling"` при memory-guard — це детектується детерміновано. Preflight `omlxHealthCheck` повертає `{ ok, reason: 'down'|'memory-guard'|'auth'|'error', detail }`, і конвеєр/пілот обирає стратегію залежно від `reason`: `down` → зупинитись; `memory-guard` → polling до звільнення; `auth` → вказати, звідки взяти ключ.

### Consequences

* Good, because авто-пілот (фоновий процес) може чекати до 6 годин, перевіряючи щохвилини, і стартувати генерацію щойно пам'ять звільниться — без участі користувача.
* Good, because в CLI одна зрозуміла зупинка замість лавини помилок по файлах: текст підказки відповідає конкретній причині.
* Good, because `memory-guard` означає «властивість моменту», а не дефект конвеєра — не треба скидати стан чи перезапускати сервер.
* Bad, because детекція залежить від рядка у `message`; зміна тексту відповіді omlx-API зламає детектор. Поточний маркер: `MEMORY_GUARD_MARKER = 'memory ceiling'` у `npm/lib/llm.mjs`.

## More Information

- Реалізація: `npm/lib/llm.mjs` → `omlxHealthCheck`, `npm/lib/omlx.mjs` → `callOmlx`.
- Авто-пілот із polling: `/tmp/doc-files-autopilot.sh` (скрипт сесії 2026-06-11).
- Дока: `npm/lib/docs/llm.md`, `npm/lib/docs/omlx.md`.

## Update 2026-06-14

- Для docgen-оркестратора зафіксовано три класи omlx-збоїв: `transient` (`spawnSync curl ETIMEDOUT`), `systemic` (`memory ceiling exceeded`) і `permanent` (`Prompt too long: 9177917 tokens`).
- Поточна поведінка `docgen-files-batch.mjs` (`catch → ✗ → push → continue`) спричинила каскад приблизно 200 наступних невдалих файлів після memory-збою на файлі №57.
- Потрібна реакція за класом: retry з backoff для transient, circuit breaker для systemic, окремий `skipped[]` без retry для permanent.
- Зародок класифікації вже є в `omlxHealthCheck` у `npm/lib/llm.mjs:137-150`; transcript пропонує винести спільний `classifyOmlxError`.
- Permanent-case: мініфікований vendored-файл `*/lib/lib/eusc*.js` на приблизно 9.17M токенів варто відсіювати ще до відправлення в LLM.

## Update 2026-06-14

- Уточнено recovery-стратегію для memory ceiling: проблема була не у KV-/prompt-cache, а в одночасній присутності двох gemma-моделей у RAM (`gemma-4-e4b-it-OptiQ-4bit` і `gemma-4-e2b-it-4bit`) понад стелю 12.7 GB.
- Transcript відкинув скидання `/admin/api/hot-cache/clear` як основне рішення, бо per-request KV-cache omlx звільняє автоматично, а prefix/hot-cache корисний для повторюваного system-prompt docgen.
- Для preflight/recovery варто використовувати `GET /v1/models/status` і `POST /v1/models/{id}/unload`, щоб прибирати конкурентну модель перед батчем або після systemic-збою.
- Resume безпечний: файли без записаної документації лишаються `stale` і підбираються наступним прогоном через CRC.
