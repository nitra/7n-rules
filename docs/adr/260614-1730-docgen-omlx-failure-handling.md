---
type: ADR
title: "Docgen omlx failure handling: model fallback, класифікація помилок і circuit breaker"
description: Масовий docgen захищається від stale моделей, memory ceiling каскадів і permanent prompt-збоїв через fallback, класифікацію помилок та recovery-поведінку.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Під час масового запуску `docgen-files-batch.mjs` omlx одночасно тримав у пам'яті дві gemma-моделі: резидентну `gemma-4-e4b-it-OptiQ-4bit` з `N_LOCAL_MIN_MODEL` і стару `gemma-4-e2b-it-4bit`, яку код запитував через `DEFAULT_OMLX_MODEL` / `DEFAULT_LOCAL_MODEL`. Завантаження другої моделі спричиняло `memory ceiling`, після чого всі наступні файли падали каскадом.

Окремо docgen-оркестратор обробляв transient, systemic і permanent збої однаково: `catch → ✗ → продовжити`. Через це timeout не отримував коректного retry, systemic memory failure списував сотні файлів, а надто довгі vendored/minified файли потрапляли в чергу повторів, хоча retry не міг допомогти.

## Considered Options

- Увімкнути `model_fallback` у `~/.omlx/settings.json`, щоб запити до відсутніх моделей перенаправлялися на доступну модель.
- Залишити `model_fallback: false`, виправити stale `DEFAULT_OMLX_MODEL` і додати preflight-перевірку з гучним фейлом при порожньому `N_LOCAL_MIN_MODEL`.
- Прибрати хардкод `DEFAULT_OMLX_MODEL` повністю і лишити тільки `N_LOCAL_MIN_MODEL` як канон.
- Додати класифікатор помилок + retry з backoff для transient + circuit breaker для systemic + окремий `skipped[]` для permanent.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "увімкнути `model_fallback` і спроєктувати класифікацію omlx-помилок з retry, circuit breaker та skipped permanent-файлами", because user явно попросив увімкнути fallback і підготувати спеку по всіх пропозиціях, а transcript показав, що без класифікації один systemic-збій породжує каскад ~200 марних фейлів.

### Consequences

- Good, because запит до неіснуючої моделі більше не завершується `not_found_error`, а перенаправляється на доступну `gemma-4-e4b-it-OptiQ-4bit`.
- Good, because systemic-каскад має зупинятися після K підряд-збоїв замість списання решти батчу.
- Good, because transient-збої на кшталт `ETIMEDOUT` отримують retry з backoff замість некоректного завершення без відновлення.
- Good, because permanent-збої на кшталт `Prompt too long` і vendored/minified файлів переходять у `skipped[]` без беззмістовних повторів.
- Good, because transcript фіксує можливий recovery через `GET /v1/models/status` і `POST /v1/models/{id}/unload` для конкурентних моделей.
- Bad, because transcript підтверджує конкретний негативний наслідок fallback: поле `model` у відповіді omlx може містити запитаний неіснуючий id, а не фактичну модель, тому wire-trace і CRC-штамп можуть відображати невірну модель.
- Neutral, because пороги K, кількість retry і backoff у transcript не були фінально зафіксовані.

## More Information

- Змінений локальний конфіг: `~/.omlx/settings.json` → `model.model_fallback: true`.
- Сервер перезапущено через `kill 42238` + `omlx start`.
- Верифікація: `curl -X POST /v1/chat/completions` з `model: "foo-bar-baz"` повернув HTTP 200 і `content: ok`.
- Stale fallback у коді: `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'` у `npm/lib/omlx.mjs:49`.
- Пріоритет резолюції моделі в `docgen-gen.mjs:372`: `N_CURSOR_DOCGEN_MODEL` → `N_LOCAL_MIN_MODEL` через `resolveModel('min')` → `omlx/${DEFAULT_OMLX_MODEL}`.
- Реалізаційні файли для failure handling: `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/lib/omlx.mjs`, `npm/lib/llm.mjs`.
- Поточна проблема: `ETIMEDOUT` у `callOmlxRaw` потрапляє в `r.error → break`, а не в retry-гілку.
- Permanent приклад: `Prompt too long: 9177917 tokens`, файл `run/auth/src/lib/lib/euscp.js`; pre-send guard має виключати `run/auth/src/lib/lib/eusc*.js` або подібні vendored/minified файли ще на рівні `scanForDocFiles`.
- Recovery API omlx: `GET /v1/models/status`, `POST /v1/models/{id}/unload`, `POST /v1/models/{id}/load`.
- HTTP endpoint `/v1/models/fallback` не підтверджений; transcript уточнює, що реальне налаштування fallback відбувається через `~/.omlx/settings.json` і restart.
- Спека подальших змін: `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md`.

## Update 2026-06-14

- Уточнено класи помилок для docgen-оркестратора: `spawnSync curl ETIMEDOUT` як transient, `memory ceiling exceeded` як systemic, `Prompt too long: 9177917 tokens` як permanent.
- Зафіксовано проблему каскаду: після systemic-збою приблизно з файлу №57 наступні ~200 файлів списувалися через єдиний `catch → ✗ → push → continue`.
- Запропоновано `skipped[]` для permanent-помилок і збереження CRC-resume: невдалі файли без запису лишаються stale і підхоплюються наступним прогоном.

## Update 2026-06-14

- Уточнено реакції за класами: transient (`ETIMEDOUT`, `curl exit 18/52/56`) → retry з exponential backoff; systemic (`memory ceiling`, сервер недоступний) → streak-лічильник і circuit breaker; permanent (`Prompt too long`) → `⊘ skip` без retry.
- Для permanent-класу додано pre-send guard за розміром і виключення мінімізованих/vendored шляхів на рівні `scanForDocFiles`.
- Transcript підтверджує наявність `/admin` API та `/v1/models/status` в omlx OpenAPI, але endpoint для скидання моделей/кешу в цій чернетці лишився предметом окремого дослідження.

## Update 2026-06-14

- Додано окреме уточнення про recovery через вивантаження конкурентних моделей: `GET /v1/models/status` і `POST /v1/models/{id}/unload` мають використовуватися в preflight / recovery замість очищення KV-/prompt-cache.
- Причина: transcript показав одночасну присутність `gemma-4-e4b-it-OptiQ-4bit` і `gemma-4-e2b-it-4bit` у RAM, що перевищувало memory ceiling; per-request cache звільняється автоматично, а персистентним споживачем були ваги моделей.
- Hot-cache не треба скидати між файлами, бо prefix-cache для спільного system-prompt docgen корисний для повторного прогону.

## Update 2026-06-14

- Уточнено runbook-факт: HTTP endpoint `/v1/models/fallback` фактично не існує; попередній OpenAPI-парсинг дав хибний висновок через дублікати ключів.
- Реальний спосіб увімкнути fallback — змінити `~/.omlx/settings.json`, зокрема `model_fallback`, і перезапустити omlx server.
- Для wildcard fallback можна налаштувати mapping `"*"` або точніший `"mlx-community/*"` на `gemma-4-e4b-it-OptiQ-4bit`.

## Update 2026-06-14

- Масовий docgen-прогін на 266 файлах показав три різні класи omlx-збоїв: `ETIMEDOUT`/curl як transient, `memory ceiling` як systemic, `Prompt too long` як permanent.
- Класифікатор `classifyOmlxError(message) → 'transient' | 'systemic' | 'permanent'` додано в `npm/lib/llm.mjs`.
- `callOmlxRaw` у `npm/lib/omlx.mjs` отримав retry/backoff для transient-збоїв; у transcript зафіксовано hardcoded backoff `[2000, 8000]` мс і підтримку `backoffMs` в opts для тестів.
- Permanent-файли переводяться у skip-лічильник замість повторних ретраїв.
- `docgen-scan.mjs` поважає `.gitignore` через `git check-ignore --stdin`; `stderr` приглушено для graceful-поведінки поза git-репозиторієм.
- `DEFAULT_OMLX_MODEL` видалено; модель має приходити з `N_LOCAL_MIN_MODEL` / `resolveModel('min')`, а відсутність моделі має падати fail-loud.
- У `~/.omlx/settings.json` увімкнено `model.model_fallback: true`; curl-запит до неіснуючої моделі `foo-bar-baz` повернув відповідь замість 404.

## Update 2026-06-14

- Для systemic-збоїв docgen-оркестратор завершує batch з `exit 2` і actionable-повідомленням; невдалі файли лишаються stale і підбираються наступним прогоном через CRC.
- Для великих файлів обрано pre-send byte-guard замість chunk+merge: якщо оцінка розміру перевищує `0.5 × (N_CURSOR_DOCGEN_CTX || 131072)`, файл instant-skipʼається з маркером `Prompt too long`.
- Причина вибору guard: transcript фіксує, що проблемні файли корпусу були vendored Emscripten-блобами (`euscp*.js`), для яких chunk+merge не дає корисного результату.
- `DEFAULT_OMLX_MODEL` прибрано з `npm/lib/omlx.mjs` і `npm/rules/doc-files/js/docgen-gen.mjs`; канонічний шлях резолву — `N_LOCAL_MIN_MODEL` через `resolveModel('min')`.
- Transcript не містить підтвердженого негативного наслідку для fail-loud моделі; для byte-guard зафіксовано нейтральний ризик евристики `bytes / 4`.
