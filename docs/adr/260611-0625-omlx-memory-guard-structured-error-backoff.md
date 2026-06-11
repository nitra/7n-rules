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
