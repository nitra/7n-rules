---
session: a8526b61-7bda-406e-b2f5-ce0c3c39d7e9
captured: 2026-06-10T13:44:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/a8526b61-7bda-406e-b2f5-ce0c3c39d7e9.jsonl
---

## ADR Переробка викликів local LLM: прямий HTTP до omlx для one-shot JS-скілів, pi — тільки для агентних задач

## Context and Problem Statement
У монорепо всі виклики до локальних моделей (coverage-classify, coverage-fix, fix/llm-worker) проходили через `pi` CLI. Постало питання, чи можна повністю відмовитись від `pi` для local-inference та ходити напряму до `http://localhost:8000/v1/chat/completions`, залишивши `pi` лише для хмарних запитів.

## Considered Options
* Прямий HTTP до omlx для всіх one-shot JS-скілів; `pi` залишається тільки для агентних задач
* Повна заміна `pi` власним JS-оркестратором (через наявний `subagent-runner.mjs`) для всіх скілів, включно з агентними
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прямий HTTP до omlx для one-shot JS-скілів; pi залишається для coverage-fix", because всі JS-скіли (coverage-classify, fix/llm-worker) є one-shot (один запит → одна відповідь) і завжди використовують Claude Haiku — жодного tool-loop не потрібно. `coverage-fix` залишається на `pi`, бо це повноцінний агент з tool-loop, і перенесення вимагало б реалізації власного циклу з невизначеною якістю виконання інструментів на локальній моделі.

### Consequences
* Good, because transcript фіксує очікувану користь: усуває залежність від `pi` CLI для простих inference-викликів, знижує latency і overhead для one-shot скілів.
* Good, because патерн `callOmlxMessages()` вже реалізований у `npm/skills/docgen/js/docgen-gen.mjs` (рядки 99–139) — міграція зводиться до винесення у спільну утиліту та перепідключення трьох точок.
* Bad, because `coverage-fix` залишається прив'язаним до `pi` — повне видалення залежності від `pi` не досягнуто.
* Bad, because поведінка fallback (якщо omlx недоступний — кидати помилку чи відкочуватись на pi-cloud) на момент завершення transcript залишилась відкритим питанням без зафіксованого рішення.

## More Information
Файли, що підлягають міграції на omlx:
- `npm/scripts/coverage-classify/index.mjs:33`
- `npm/scripts/fix/llm-worker.mjs:96`

Файл, що залишається на `pi`:
- `npm/scripts/coverage-fix.mjs` — агентний виклик без `--no-tools`

Планований спільний модуль: `npm/lib/omlx.mjs` (винесення `callOmlxMessages()` з `npm/skills/docgen/js/docgen-gen.mjs:99–139`).

Наявна інфраструктура: `npm/scripts/dispatcher/lib/subagent-runner.mjs` реалізує повноцінний ReAct tool-loop на JS, але не використовується для цього рішення.

Endpoint: `http://localhost:8000/v1/chat/completions` (OpenAI-сумісний API, omlx).
