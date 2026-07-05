---
type: ADR
title: "Task orchestration DAG в npm/scripts/graph"
description: Новий autonomous DAG реалізується окремим модулем `npm/scripts/graph/` із sentinel-based state machine та top-level `n-cursor watch`.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Існуючий `npm/scripts/dispatcher/graph.mjs` був read-only прототипом для `docs/graphs/<g>/nodes/*.md` і статусів з artifact-файлів `plan/claim/fact/ask/ans`. Новий дизайн із transcript описує автономний DAG задач на основі `tasks/<node>/task.md`, worktree-ізоляції, сигнальних файлів і lifecycle через wrapper/agent/CLI/watch. Ці моделі несумісні за file layout і state machine.

## Considered Options

- Розширити існуючий `dispatcher/graph.mjs` із backward-compat шаром.
- Створити окремий модуль `npm/scripts/graph/` і залишити legacy dispatcher незайманим.
- Центральний JSON-state файл `.n-cursor/state.json`.
- Sentinel-файли у директорії вузла, де присутність файлів визначає стан.
- `n-cursor graph watch` як підкоманда.
- `n-cursor watch` як top-level команда.

## Decision Outcome

Chosen option: "окремий `npm/scripts/graph/` із sentinel-based state machine та top-level `n-cursor watch`", because transcript фіксує несумісність старого artifact-based dispatcher з новою моделлю `tasks/`, а sentinel-файли роблять кожен вузол самодостатнім без daemon або централізованого lock/state-файлу.

### Consequences

- Good, because старі dispatcher-тести лишаються зеленими, а нова система отримує ізольований простір для власних тестів.
- Good, because `graph status` і `graph scan` можуть деривувати стан звичайним читанням файлів у `tasks/<node>/`.
- Good, because `n-cursor watch` зручно запускати з `post-merge` hook як коротку top-level команду.
- Bad, because до видалення legacy dispatcher існуватимуть дві graph-реалізації, що може плутати користувачів.
- Neutral, because transcript не містить підтвердженого вирішення race condition між записом `outputs_NNN.md` і видаленням worktree.

## More Information

Нові файли: `npm/scripts/graph/config.mjs`, `state.mjs`, `scan.mjs`, `setup.mjs`, `init.mjs`, `invalidate.mjs`, `signals.mjs`, `run.mjs`, `kill.mjs`, `watch.mjs`, `index.mjs`, `tests/state.test.mjs`.

State derivation: лише `task.md` → `waiting`; `run_NNN.md` без `outputs_NNN.md` і активний worktree → `running`; `outputs_NNN.md` → `resolved`; `invalidated` → `invalidated`; `run_NNN.md` без output і без worktree → `failed`. Сигнали агента `graph done <path>`, `graph audit <path>`, `graph failed <path>`, `graph spawn <path>` пишуть `.signal`. CLI routing: `npm/bin/n-cursor.js` імпортує `../scripts/graph/index.mjs` для `graph` і `../scripts/graph/watch.mjs` для `watch`.

## Update 2026-06-06

Додати до рішення про новий `npm/scripts/graph/` такі уточнення з transcript:

- Для всіх спроб вузла використовується єдиний `run_NNN.md` замість окремих `error.md`, `repair_history.md`, `outputs.md`-журналів. Frontmatter містить `created_at`, `actor`, `result`, опційно `worktree`; `actor` має значення `agent | engineer | human | auditor`.
- Усі робочі файли вузла immutable: кожна спроба створює новий `run_NNN.md`, а успішний результат — окремий `outputs_NNN.md`. Стан відновлюється скануванням файлів, а не append-only оновленням.
- `ops/` і `patches/` не потрібні для поточного дизайну: spawn відбувається у worktree і мержиться атомарно, а reasoning інженера фіксується в `## Reasoning` відповідного `run_NNN.md`.
- Після merge wrapper може покладатися на git `post-merge` hook, який запускає `graph run --auto` для пошуку розблокованих наступників.
- Аудит ініціює сам агент через `graph audit <path>` замість `graph done <path>`. Аудитор пише наступний `run_NNN.md` з `actor: auditor`; після 3 поспіль `result: failed` система зупиняється і чекає людину.

## Update 2026-06-06

Додатково зафіксувати `n-cursor watch` як pull-модель сигналізації людині:

- `watch` сканує граф і репортить проблемні вузли без push-інфраструктури.
- Сигнали для людини: ≥ 3 поспіль failed-аудити, failed-інженер на кореневому рівні, stale worktree без змін довше `stale_worktree_min`.
- `post-merge` hook може запускати `n-cursor watch` поряд із `graph run --auto`.
