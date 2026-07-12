---
type: ADR
title: Local LLM через omlx для one-shot JS-скілів
description: One-shot local LLM виклики переводяться на прямий HTTP до omlx, а pi лишається для агентних задач із tool-loop.
---

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

У монорепо прості local LLM виклики проходили через `pi` CLI, хоча не потребували агентного tool-loop. Водночас є локальний OpenAI-compatible endpoint `http://localhost:8000/v1/chat/completions` від `omlx`. Потрібно визначити межу між прямим local inference через `omlx` і використанням `pi`.

## Considered Options

- Прямий HTTP до `omlx` для всіх one-shot JS-скілів; `pi` лишається для агентних задач.
- Повна заміна `pi` власним JS-оркестратором через наявний `subagent-runner.mjs` для всіх скілів, включно з агентними.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Прямий HTTP до omlx для one-shot JS-скілів; pi лишається для агентних задач", because transcript фіксує, що `coverage-classify` і `fix/llm-worker` є one-shot запитами без потреби в tool-loop, а `coverage-fix` є повноцінним агентним сценарієм і перенесення вимагало б власного циклу інструментів з непідтвердженою якістю.

### Consequences

- Good, because прості inference-виклики більше не залежать від `pi` CLI і можуть напряму використовувати локальний OpenAI-compatible endpoint.
- Good, because transcript фіксує наявний патерн `callOmlxMessages()` у `npm/skills/docgen/js/docgen-gen.mjs`, який можна винести у спільну утиліту.
- Bad, because `coverage-fix` лишається привʼязаним до `pi`, тобто повного видалення залежності від `pi` не відбувається.
- Bad, because transcript не містить фінального рішення для fallback-поведінки, якщо `omlx` недоступний: кидати помилку чи відкочуватися на `pi`/cloud.

## More Information

Файли для міграції на `omlx`, зафіксовані в transcript:

- `npm/scripts/coverage-classify/index.mjs:33`
- `npm/scripts/fix/llm-worker.mjs:96`

Файл, що лишається на `pi`:

- `npm/scripts/coverage-fix.mjs` — агентний виклик без `--no-tools`.

Планований спільний модуль: `npm/lib/omlx.mjs`, винесення `callOmlxMessages()` з `npm/skills/docgen/js/docgen-gen.mjs:99–139`.

Наявна, але не обрана для цього рішення інфраструктура: `npm/scripts/dispatcher/lib/subagent-runner.mjs`.

Endpoint: `http://localhost:8000/v1/chat/completions`.
