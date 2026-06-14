---
session: 8e308db4-fee9-44b0-bd83-2a55c74e2dc0
captured: 2026-06-14T17:30:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8e308db4-fee9-44b0-bd83-2a55c74e2dc0.jsonl
---

## ADR оновлення `model_fallback` і консолідація джерела omlx-моделі

## Context and Problem Statement
Під час масового запуску docgen-оркестратора (`docgen-files-batch.mjs`) в пам'яті одночасно перебувало дві моделі gemma: резидентна `e4b-it-OptiQ-4bit` (із `N_LOCAL_MIN_MODEL`) і та, яку хардкодно запитував код — `e2b-it-4bit` (з `DEFAULT_OMLX_MODEL` / `DEFAULT_LOCAL_MODEL`). При спробі завантажити другу модель omlx повертав `memory ceiling`, і починаючи з файлу №58 каскадно падали всі решта. Додатково в headless-шелі без `~/.zshenv` `N_LOCAL_MIN_MODEL` порожній → ланцюг fallback-ів зупинявся на стейл-хардкоді з неіснуючою моделлю.

## Considered Options
* Увімкнути `model_fallback: true` у `~/.omlx/settings.json` — усі запити до відсутніх моделей мовчки перенаправляються на доступну
* Залишити `model_fallback: false`, виправити stale `DEFAULT_OMLX_MODEL` і додати preflight-перевірку з гучним фейлом при порожньому `N_LOCAL_MIN_MODEL`
* Прибрати хардкод `DEFAULT_OMLX_MODEL` повністю, залишити тільки `N_LOCAL_MIN_MODEL` як канон

## Decision Outcome
Chosen option: "Увімкнути `model_fallback: true` у `~/.omlx/settings.json`", because user явно вказав "став model_fallback: true, перезапускай" після аналізу обох варіантів у transcript.

Застосовано: `~/.omlx/settings.json` → `"model_fallback": true`; сервер перезапущений через `kill 42238` + `omlx start`; перевірено: запит до неіснуючої моделі `foo-bar-baz` повернув відповідь (gemma-4-e4b-it-OptiQ-4bit) замість `not_found_error`.

### Consequences
* Good, because transcript фіксує очікувану користь: каскад збоїв через відсутню модель більше неможливий — omlx перенаправляє на наявну `gemma-4-e4b-it-OptiQ-4bit`.
* Bad, because transcript підтверджує конкретний негативний наслідок: поле `model` у відповіді omlx містить запитаний (неіснуючий) id, а не фактичний — wire-trace та CRC-штамп можуть відображати невірну модель.

## More Information
- Змінений конфіг: `~/.omlx/settings.json` → `model.model_fallback: true`
- Верифікація: `curl -X POST /v1/chat/completions` з `model: "foo-bar-baz"` → HTTP 200, `content: ok`
- Stale fallback у коді: `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'` (`npm/lib/omlx.mjs:49`) — модель більше не існує на сервері, але тепер захищено `model_fallback`
- Пріоритет резолюції моделі в `docgen-gen.mjs:372`: `N_CURSOR_DOCGEN_MODEL → N_LOCAL_MIN_MODEL (resolveModel('min')) → omlx/${DEFAULT_OMLX_MODEL}`
- Спека подальших змін оркестратора (circuit breaker, класифікатор помилок, preflight unload): `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md`

---

## ADR класифікація omlx-помилок і circuit breaker для docgen-оркестратора

## Context and Problem Statement
У масовому прогоні docgen-оркестратора (`docgen-files-batch.mjs`) три принципово різні класи збоїв — transient (ETIMEDOUT, curl exit codes), systemic (memory ceiling, сервер недоступний), permanent (prompt занадто довгий, vendored-файли) — обробляються однаково: `catch → ✗ → продовжити`. Через це один systemic-збій на 58-му файлі спричинив каскад ~200 фейків, а permanent-збої (9М токенів у `euscp.js`) потрапляють до черги «перегнати», хоча повтор нічого не дасть.

## Considered Options
* Класифікатор помилок + retry з backoff (transient) + circuit breaker (systemic) + окремий лічильник `skipped[]` (permanent)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Класифікатор помилок + retry з backoff (transient) + circuit breaker (systemic) + окремий лічильник `skipped[]` (permanent)", because user погодився на цей підхід і попросив підготувати спеку по всіх пропозиціях.

### Consequences
* Good, because transcript фіксує очікувану користь: systemic-каскад зупиняється після K підряд-збоїв замість падіння всіх ~200 файлів; transient-збої отримують реальний шанс на відновлення; permanent-файли не засмічують чергу ретраю.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файли реалізації: `npm/rules/doc-files/js/docgen-files-batch.mjs` (головний цикл, `generateOne`), `npm/lib/omlx.mjs` (транспорт, `callOmlxRaw`), `npm/lib/llm.mjs` (можливе спільне місце для `classifyOmlxError`)
- Зараз `ETIMEDOUT` у `callOmlxRaw` потрапляє у гілку `r.error → break` (не retry)
- Pre-send guard за розміром: виключити мініфіковані vendored-файли (`run/auth/src/lib/lib/eusc*.js`) ще на рівні `scanForDocFiles`
- API omlx для recovery: `GET /v1/models/status`, `POST /v1/models/{id}/unload`, `POST /v1/models/{id}/load`
- Спека: `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md`
