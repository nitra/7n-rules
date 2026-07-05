---
type: ADR
title: "Adaptive thinking замість ручного extended thinking на Claude 4.6+"
description: Для Claude 4.6+ ручні thinking budgets, sampling-параметри й assistant prefills замінюються adaptive thinking, prompt controls та structured outputs.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Механізм `thinking: { type: "enabled", budget_tokens: N }` вимагав вручну задавати ліміт токенів. Для Opus 4.6 і Sonnet 4.6 він deprecated, а на Opus 4.7+ повертає 400. Transcript також фіксує, що `temperature`, `top_p`, `top_k` на Opus 4.7+ повертають 400, а last-assistant-turn prefills у 4.6-сімʼї більше не приймаються.

## Considered Options

- Зберегти ручний `budget_tokens` extended thinking.
- Перейти на `thinking: { type: "adaptive" }` і керувати глибиною через `effort`.
- Залишити sampling-параметри `temperature`, `top_p`, `top_k`.
- Видалити sampling-параметри і переносити керування стилем у prompt.
- Залишити assistant-turn prefills.
- Замінити prefills на `output_config.format` і system-prompt інструкції.

## Decision Outcome

Chosen option: "adaptive thinking, prompt controls and structured outputs", because transcript фіксує, що adaptive thinking є рекомендованою заміною ручного budget, sampling-параметри на Opus 4.7+ не приймаються API, а structured outputs дають надійніший контракт для JSON/YAML без assistant prefill hacks.

### Consequences

- Good, because adaptive thinking автоматично керує глибиною розмірковування і прибирає потребу в beta-заголовку `interleaved-thinking-2025-05-14`.
- Good, because `output_config.format` з `json_schema` замінює ручні prefills для структурованих відповідей.
- Bad, because continuation-сценарії треба переписати як user-turn із текстом на кшталт `[last text]. Continue from there.`
- Neutral, because transcript не містить підтвердження негативних наслідків від видалення `budget_tokens`; на 4.6 короткостроково згадано escape hatch для поступової міграції.

## More Information

Застосовується до файлів із `client.messages.create()` або `client.beta.messages.create()` з параметром `thinking`. Новий патерн: `thinking={"type":"adaptive"}` і `output_config={"effort":"high"}` або інший рівень `low | medium | high | xhigh | max`. Для Opus 4.7+ потрібно прибрати `temperature`, `top_p`, `top_k`. Top-level `output_format` deprecated API-wide і замінюється на `output_config.format`.
