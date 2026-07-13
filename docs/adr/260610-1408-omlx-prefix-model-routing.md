---
type: ADR
title: "Маршрутизація локальних one-shot LLM-викликів через omlx-префікс моделі"
description: Локальні one-shot LLM-виклики маршрутизуються напряму в omlx через префікс моделі `omlx/`, а pi лишається для хмарних і агентних SDK-викликів.
---

**Status:** Accepted

**Date:** 2026-06-10

## Context and Problem Statement

У проєкті всі виклики до LLM проходили через CLI `pi`. Для локальних one-shot сценаріїв це створювало overhead і зайву залежність від `pi`, хоча такі виклики не потребують SDK tool-loop. Після рішення використовувати прямий HTTP до omlx потрібен був єдиний механізм вибору транспорту без окремих env-прапорів для кожного скіла.

## Considered Options

- Перевести локальні one-shot виклики на прямий HTTP до `http://localhost:8000` через omlx, залишивши `pi` для хмарних і агентних SDK-викликів.
- Залишити єдиний шар `pi` для всіх викликів.
- Використовувати префікс у назві моделі: `omlx/<model-id>` означає прямий HTTP до omlx, усе інше — `pi` CLI.
- Використовувати окремий env-прапор per-skill, наприклад `N_CURSOR_DOCGEN_BACKEND=omlx`.
- Використовувати єдиний глобальний перемикач `N_CURSOR_LLM_BACKEND`.

## Decision Outcome

Chosen option: "локальні one-shot виклики через прямий omlx HTTP з маршрутизацією за префіксом `omlx/`, а `pi` — для хмарних і агентних SDK-викликів", because transcript фіксує, що one-shot точки (`coverage-classify`, `fix/llm-worker`, docgen Tier 1) не потребують tool-loop, їх можна замінити прямим HTTP, а routing має жити в дефолтній реалізації `callModel` без per-skill env-флагів.

### Consequences

- Good, because transcript фіксує очікувану користь: усунення CLI-overhead для one-shot точок і збереження `pi` там, де потрібен справжній SDK tool-loop.
- Good, because routing централізується в `npm/lib/omlx.mjs` через `isOmlxModel`, `omlxModelId` і `callOmlx`, а сигнатура інʼєкції в тестах лишається стабільною через `callModel`.
- Bad, because omlx text-only не приймає `tools` і не повертає `tool_calls`, тому JS-owned loop не є прямою заміною pi-агента для складних завдань.
- Neutral, because transcript не містить підтвердження негативних наслідків від самої конвенції `omlx/` у назві моделі.

## More Information

- Новий спільний транспорт: `npm/lib/omlx.mjs`.
- One-shot callers: `npm/scripts/coverage-classify/index.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/skills/docgen/js/docgen-gen.mjs`.
- `npm/lib/models.mjs` оновлено коментарем про конвенцію `omlx/`-префікса для локальних моделей.
- Rename інʼєкції: `callPi` → `callModel` / `opts.callModel` у `coverage-classify/index.mjs` і тестах.
- Повʼязаний ADR у transcript: `docs/adr/260610-1349-агентна-пастка-js-owned-loop-через-omlx-замість-pi-tool-loop.md`.
- Change-файл: `npm/.changes/260610-1402.md`.
