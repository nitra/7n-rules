---
type: ADR
title: "Агентна пастка: JS-owned tool-free loop через omlx замість імітації pi tool-loop локально"
---

# Агентна пастка: JS-owned tool-free loop через omlx замість імітації pi tool-loop локально

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

Рішення розділити транспорт (omlx — локальне, pi — хмарне, див. `260610-1336`, `260610-1344`) залишило одну точку прив'язки до `pi`: `coverage-fix.mjs` — це повноцінний агент із tool-loop (читає/пише тест-файли, ганяє `bun test`, ітерує до 0 fail). Постало питання: чи можна реалізувати агентну поведінку у власному JS-оркестраторі, щоб **повністю** відмовитись від `pi` для локальних моделей без втрат?

Два факти з розвідки задають межі рішення:

1. **omlx (MLX-сервер на `http://localhost:8000/v1/chat/completions`) — text-only.** Він не приймає поле `tools` і не повертає `tool_calls`. Локальна модель через omlx фізично не може видати структурований виклик інструмента.
2. **У репо немає власного OpenAI-style tool-loop.** Уся агентика делегована в `claude-agent-sdk`; `npm/scripts/dispatcher/lib/subagent-runner.mjs` — лише проксі-шар до SDK (`query()` з `allowedTools`), а не самостійний цикл `model → tool_call → execute → feedback`.

## Considered Options

* **Портувати OpenAI-style tool-loop у власний JS** проти omlx (модель емітить `tool_calls`, JS виконує інструменти).
* **JS-owned tool-free loop**: модель = чистий текстовий трансформер (текст → JSON), петлею володіє JS-оркестратор (виконує read/write/`bun test`, переформульовує промпт на провалі); `pi`/SDK лишається як cloud-escalation для складних агентних задач.
* **Лишити `coverage-fix` на `pi` без змін** (поточний стан після `260610-1344`).

## Decision Outcome

Chosen option: **JS-owned tool-free loop**.

Дослівний порт tool-loop неможливий проти поточного omlx — він text-only, тож емісія `tool_calls` локальною моделлю виключена; а малі локальні моделі (`gemma-4b`) і так слабкі в багатокроковому tool-use — саме тому `coverage-fix` дефолтиться на cloud.

Натомість агентну поведінку дає патерн, який команда вже прототипувала в `benchmarks/tool-free/run.mjs`: **петлею володіє JS, а не модель**. Модель лише генерує артефакт (текст/JSON), а інструменти (read/write/run test) виконує оркестратор детерміновано. omlx це підтримує на 100%, бо моделі не треба вміти tool-calling. Локально це строго краще за `pi`: швидше (немає ~97с/tool-крок проти ~35–71с/виклик у пілоті), детерміновані сайд-ефекти, немає flaky-викликів слабкої моделі.

Межа `pi`/omlx переформульовується від «one-shot vs agent» до «хто володіє петлею»:

| Клас задачі | Хто володіє петлею | Бекенд | Модель уміє tools? |
| --- | --- | --- | --- |
| Локальні one-shot (docgen, classify) | немає петлі | прямий omlx | ні (не треба) |
| Локальні «агентні» (fix tests локально) | JS-оркестратор | прямий omlx | ні (JS виконує інструменти) |
| Складні агентні / cloud | SDK / `pi` | `pi` (cloud) | так (SDK tool-loop) |

`coverage-fix` на практиці **вже cloud**: `LOCAL_MAX=''` за замовчуванням, тож `resolveModel('max') → CLOUD_MAX`, а worktree-версія хардкодить `claude-haiku-4-5-20251001`. У цільовій архітектурі він **природно лишається на `pi`** — жодної втрати. Якщо ж захочемо ганяти його локально — переписуємо на tool-free JS-петлю з ескалацією в `pi`/SDK тільки на провалі (escalation вже є в бенчмарку).

### Consequences

* Good, because `pi` лишається рівно тим, чим планувалося — шаром для хмари й справжнього SDK tool-loop; локальна агентика стає JS-петлею над text-only omlx.
* Good, because tool-free петля детермінована (JS володіє сайд-ефектами) і швидша за pi tool-loop локально.
* Good, because не треба реалізовувати й підтримувати власний OpenAI-style tool-calling парсер проти сервера, який його не підтримує.
* Bad, because tool-free працює лише коли задачу можна звести до «згенеруй цей артефакт як текст»; повна свобода `coverage-fix` (знайти довільні тест-файли, вигадати структуру) важче втискається в text-only — тому escalation-to-cloud лишається страхувальною сіткою, а не видаляється.
* Bad, because твердження в `260610-1344`, ніби `subagent-runner.mjs` реалізує «повноцінний ReAct tool-loop на JS», некоректне: фактично це проксі до `claude-agent-sdk`. Власного локального tool-loop у репо немає — JS-петлю tool-free треба написати.

## More Information

Прототип патерну: `benchmarks/tool-free/run.mjs` — локальний text-only worker (`pi --no-tools`, ~35–71с/виклик, JSON-вихід + детермінований check-gate) з ескалацією в haiku через SDK (`allowedTools: ['Read','Edit','Bash']`) тільки на провалі.

Підтвердження text-only omlx: `npm/skills/docgen/js/docgen-gen.mjs:99–139` (`callOmlxMessages()`) шле лише `{ model, messages, max_tokens, temperature }`, читає `choices[0].message.content` — жодного `tools`/`tool_calls`.

Прив'язка до cloud: `npm/lib/models.mjs` — `resolveModel('max') → LOCAL_MAX || CLOUD_MAX`, `LOCAL_MAX` дефолт `''`.

Залежність: `260610-1336` (рішення розділити транспорт), `260610-1344` (one-shot → omlx, agent → pi). Цей ADR розв'язує відкрите там питання про агентну точку.
