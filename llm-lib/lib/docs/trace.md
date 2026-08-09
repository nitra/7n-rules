---
type: JS Module
title: trace.mjs
resource: llm-lib/lib/trace.mjs
docgen:
  crc: 4c2e9b2a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`tracePath` і `writeTrace` утворюють спільний журнал для LLM wire-trace: `tracePath` задає місце запису, а `writeTrace` додає туди JSONL-рядки з міткою часу. Секція описує збереження трасування в append-only форматі та локальні fail-safe гілки, які обмежують збій у межах цього запису.

## Поведінка

`tracePath` визначає спільне місце запису для всього LLM wire-trace і повертає шлях, який далі використовує `writeTrace` як ціль для дописування JSONL-рядків. `writeTrace` бере готовий запис, додає службову мітку часу, створює потрібні каталоги для шляху призначення і дописує один рядок у trace; якщо під час IO стається помилка, вона приглушується, щоб трасування не впливало на основний виклик. Джерело йде з викликача, а результатом є append-only журнал у спільному файлі, який може бути перевизначений через змінні середовища для тестів або CI.

## Публічний API

- tracePath — Шлях глобального trace (env-override `N_LLM_TRACE_PATH`, legacy `N_CURSOR_TRACE_PATH`).
- writeTrace — Дописує один trace-запис (JSONL). Поля: `caller`, `rule`, `rung`, `model`,
`backend:"pi-ai"`, `kind:"agent"|"one-shot"|"skill"`, `cwd`, плюс довільна
корисна навантага. Ніколи не кидає.

## Сценарії використання

- `llm-lib/tests/trace.test.mjs` (writeTrace; tracePath) — дописує JSONL-запис із ts і полями; best-effort: помилка IO не кидає; env-override N_CURSOR_TRACE_PATH; дефолт — під ~/.n-cursor/

## Гарантії поведінки

- Містить локальні fail-safe гілки; помилки IO не кидаються назовні.
