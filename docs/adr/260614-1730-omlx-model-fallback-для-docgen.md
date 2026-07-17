---
type: ADR
title: "omlx model_fallback для docgen"
description: Для docgen увімкнено `model_fallback` в omlx settings, щоб запити до stale або відсутньої моделі перенаправлялися на доступну локальну модель.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Під час масового запуску docgen-оркестратора в памʼяті одночасно перебували дві gemma-моделі: резидентна `gemma-4-e4b-it-OptiQ-4bit` з `N_LOCAL_MIN_MODEL` і stale модель `gemma-4-e2b-it-4bit`, яку запитував код через fallback `DEFAULT_OMLX_MODEL` / `DEFAULT_LOCAL_MODEL`. Це спричиняло `memory ceiling` і каскадні падіння після файлу №58. У headless shell без `~/.zshenv` `N_LOCAL_MIN_MODEL` міг бути порожнім, тому ланцюг fallback доходив до stale hardcode.

## Considered Options

- Увімкнути `model_fallback` у `~/.omlx/settings.json`, щоб запити до відсутніх моделей перенаправлялися на доступну.
- Залишити `model_fallback: false`, виправити stale `DEFAULT_OMLX_MODEL` і додати preflight-перевірку з гучним fail при порожньому `N_LOCAL_MIN_MODEL`.
- Прибрати hardcode `DEFAULT_OMLX_MODEL` повністю і залишити тільки `N_LOCAL_MIN_MODEL` як канон.

## Decision Outcome

Chosen option: "Увімкнути `model_fallback` у `~/.omlx/settings.json`", because user явно попросив встановити `model_fallback: true` і перезапустити omlx, а перевірка запиту до неіснуючої моделі після цього повернула успішну відповідь замість `not_found_error`.

### Consequences

- Good, because запити до stale або неіснуючої моделі більше не валять docgen одразу: omlx перенаправляє їх на доступну `gemma-4-e4b-it-OptiQ-4bit`.
- Good, because рішення не потребує негайної зміни коду docgen-оркестратора.
- Bad, because transcript підтверджує: поле `model` у відповіді omlx може містити запитаний неіснуючий id, а не фактичну модель, тому wire-trace або CRC-штамп можуть відображати неправильну модель.
- Neutral, because transcript уточнює, що HTTP endpoint `/v1/models/fallback` фактично не існує; налаштування читається з `settings.json` при старті сервера.

## More Information

- Змінений конфіг: `~/.omlx/settings.json`.
- Зафіксовані варіанти конфігурації: `"model_fallback": true` або обʼєкт з `enabled: true` і `mappings`, наприклад wildcard `"*": "gemma-4-e4b-it-OptiQ-4bit"`.
- Після зміни потрібен restart omlx server.
- Верифікація transcript: `curl -X POST /v1/chat/completions` з `model: "foo-bar-baz"` повернув HTTP 200 і content `ok`.
- Stale fallback у коді: `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'` у `npm/lib/omlx.mjs:49`.
- Пріоритет резолюції моделі в docgen: `N_CURSOR_DOCGEN_MODEL → N_LOCAL_MIN_MODEL (resolveModel('min')) → omlx/${DEFAULT_OMLX_MODEL}`.
- Повʼязана спека подальших змін: `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md`.

## Update 2026-06-14

Драфт уточнює, що `/v1/models/fallback` фактично не існує як HTTP endpoint: попередній OpenAPI-парсинг дав хибний висновок через дублікати ключів у відповіді. Реальний спосіб увімкнення fallback — редагування `~/.omlx/settings.json` і перезапуск сервера. Зафіксований варіант конфігурації: `model_fallback.enabled: true` з wildcard mapping `"*": "gemma-4-e4b-it-OptiQ-4bit"`; також згадано, що можна використовувати точніший mapping `"mlx-community/*"`.
