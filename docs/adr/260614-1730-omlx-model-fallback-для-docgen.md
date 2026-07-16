---
type: ADR
title: omlx model_fallback для docgen
description: Увімкнути model_fallback в omlx, щоб stale model-id не валив docgen-батч через відсутню модель.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Під час масового запуску `docgen-files-batch.mjs` у пам'яті одночасно опинилися дві gemma-моделі: резидентна `e4b-it-OptiQ-4bit` із `N_LOCAL_MIN_MODEL` і модель, яку хардкодно запитував код через `DEFAULT_OMLX_MODEL` / `DEFAULT_LOCAL_MODEL`, — `e2b-it-4bit`. Завантаження другої моделі спричиняло `memory ceiling`, і починаючи з файлу №58 решта батчу падала каскадом.

Додатково в headless-shell без `~/.zshenv` `N_LOCAL_MIN_MODEL` міг бути порожнім, тому fallback-ланцюг доходив до stale-хардкоду з моделлю, якої вже немає на сервері.

## Considered Options

- Увімкнути `model_fallback: true` у `~/.omlx/settings.json`, щоб запити до відсутніх моделей перенаправлялися на доступну модель.
- Залишити `model_fallback: false`, виправити stale `DEFAULT_OMLX_MODEL` і додати preflight-перевірку з гучним фейлом при порожньому `N_LOCAL_MIN_MODEL`.
- Прибрати хардкод `DEFAULT_OMLX_MODEL` повністю, залишивши тільки `N_LOCAL_MIN_MODEL` як канон.

## Decision Outcome

Chosen option: "Увімкнути `model_fallback: true` у `~/.omlx/settings.json`", because користувач явно вказав `став model_fallback: true, перезапускай` після аналізу варіантів у transcript.

### Consequences

- Good, because запити до stale або відсутнього model-id більше не валять docgen-батч помилкою `not_found_error`; omlx перенаправляє їх на доступну `gemma-4-e4b-it-OptiQ-4bit`.
- Bad, because transcript підтверджує негативний наслідок: поле `model` у відповіді omlx може містити запитаний, а не фактичний model-id, тому wire-trace або CRC-штамп можуть показувати не ту модель.
- Neutral, because класифікація omlx-помилок, circuit breaker і preflight unload лишаються окремими змінами оркестратора, а цей ADR фіксує лише конфігураційний fallback.

## More Information

- Змінений конфіг: `~/.omlx/settings.json` → `model.model_fallback: true`.
- Сервер перезапущено через `kill 42238` + `omlx start`.
- Верифікація: `curl -X POST /v1/chat/completions` з `model: "foo-bar-baz"` повернув HTTP 200 і `content: ok`.
- Stale fallback у коді: `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'` у `npm/lib/omlx.mjs:49`.
- Пріоритет резолюції моделі в `docgen-gen.mjs:372`: `N_CURSOR_DOCGEN_MODEL` → `N_LOCAL_MIN_MODEL` через `resolveModel('min')` → `omlx/${DEFAULT_OMLX_MODEL}`.
- Спека подальших змін оркестратора: `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md`.

## Update 2026-06-14

- Перевірено, що `/v1/models/fallback` фактично не є реальним HTTP endpoint; попередній висновок OpenAPI-парсера був хибним через дублікати ключів у відповіді.
- Реальний спосіб увімкнення fallback — змінити `~/.omlx/settings.json`, після чого перезапустити omlx-сервер.
- Варіант конфігурації з мапінгом: `"model_fallback": { "enabled": true, "mappings": { "*": "gemma-4-e4b-it-OptiQ-4bit" } }`.
- Wildcard `"*"` працює як catch-all; transcript також згадує точніший варіант `{"mlx-community/*": "gemma-4-e4b-it-OptiQ-4bit"}`.
