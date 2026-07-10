---
type: ADR
title: Ліквідація n-cursor flow та злиття з n-cursor graph
description: Весь namespace `flow` поглинається в `graph`, щоб оркестрація вузлів мала одну CLI-точку входу.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

`n-cursor flow` і `n-cursor graph` частково дублювали lifecycle задач: worktree-ізоляцію, планування, перевірку, запуск, скасування та відновлення. Після переходу до файлового стану вузлів (`task.md`, `plan_NNN.md`, `run_NNN.md`, `outputs_NNN.md`, `pending-audit_NNN.md`) окремий namespace `flow` перестав мати самостійну роль.

## Considered Options

- Залишити `flow` і `graph` як два рівноправні namespace з чіткою межею.
- Повністю поглинути `flow` у `graph`, перейменувавши `flow plan` на `graph plan` і замінивши решту команд graph-командами або аудит-чергою.

## Decision Outcome

Chosen option: "Повністю поглинути `flow` у `graph`", because після видалення `flow init`, `flow spec`, `flow verify`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel` і `flow repair` у `flow` залишався б лише planning-крок, що не виправдовує окремий namespace.

### Consequences

- Good, because агент працює з одним namespace `n-cursor graph` для lifecycle вузла.
- Good, because `.flow.json`, `docs/specs/` і `docs/plans/` більше не потрібні як окреме сховище стану.
- Neutral, because transcript фіксує потребу оновити `docs/думка.MD` і таблицю команд під новий контракт.
- Bad, because transcript не містить підтвердження негативних наслідків, окрім необхідності міграції старих згадок `flow`.

## More Information

Видалені або замінені команди:

- `flow init` → worktree створює `graph run`.
- `flow spec` → поглинуто в `graph plan`.
- `flow plan` → перейменовано на `graph plan`.
- `flow verify` → замінено аудит-чергою.
- `flow review` → замінено аудит-чергою.
- `flow gate` → видалено як зайву обгортку.
- `flow run` → `graph run`.
- `flow resume` → повторний `graph run`, бо стан у файлах.
- `flow cancel` → `graph kill`.
- `flow repair` → не потрібен, бо `.flow.json` видалено.

Stage 1: `graph plan` читає `task.md`, враховує `mode: human|agent`, створює `plan_001.md` для atomic-шляху або дочірні `task.md` для composite-шляху. Stage 2: агент читає `plan_001.md`, виконує роботу, пише `outputs_NNN.md` і завершує через `graph done`, `graph audit <path>` або `graph failed`.

Аудит-черга: `graph audit` створює `pending-audit_NNN.md`, де `NNN` дорівнює відповідному `outputs_NNN.md`; `n-cursor watch` знаходить такі файли й запускає auditor-агента. Рішення зафіксовано в `docs/думка.MD`.

## Update 2026-06-07

Додатково зафіксовано деталі аудит-черги та Stage 1/Stage 2:

- `graph audit` створює `pending-audit_NNN.md`, де `NNN` відповідає `outputs_NNN.md`.
- `n-cursor watch` підхоплює вузли у стані `pending-audit` і запускає auditor-агента.
- `flow spec` поглинається в `graph plan`; `graph plan` створює `plan_001.md` для atomic-шляху або дочірні `task.md` для composite-шляху.
- `graph plan` не викликає `graph spawn` автоматично; агент робить це явно після перегляду результату.
- `graph verify`/`flow verify` замінено аудит-чергою, яка читає `task.md ## Done when`, `outputs_NNN.md`, `plan_001.md` і git diff, якщо це потрібно аудитору.

## Update 2026-06-07

Уточнення до дворівневого протоколу після поглинання `flow` у `graph`:

- `graph` керує зовнішнім lifecycle вузла: worktree, deps, merge, cascade.
- Внутрішній протокол вузла зводиться до `graph plan` як Stage 1 і виконання як Stage 2.
- Для composite-шляху обрано explicit-модель: `graph plan` створює дочірні `task.md`, а агент окремо викликає `graph spawn`.
- `run_NNN.md` має незалежний лічильник для всіх акторів, а `outputs_NNN.md` і `pending-audit_NNN.md` звʼязані спільним `NNN`.

## Update 2026-06-07

Додано уточнення щодо режимів planning-кроку:

- У `mode: human` planning виконує IDE-агент; CLI має бути тонким helper/preflight, а не self-contained діалогом.
- У `mode: agent` planning може запускати subagent subprocess з таймаутом від `budget_sec`.
- `graph plan --finalize` може валідувати наявність і коректність `plan_001.md` після того, як IDE-агент створив план.
- Варіант self-contained CLI-діалогу відхилено як дублювання можливостей IDE-агента.

## Update 2026-06-07

Під час оновлення `docs/думка.MD` зафіксовано фінальний стан рішення:

- `n-cursor flow` ліквідовано за рішенням ітеративного дизайну 2026-06-07.
- Усі згадки `flow plan` замінено на `graph plan`.
- `graph verify` видалено: перевірка замінена аудитом з черги.
- Таблиця команд `graph` включає `graph plan [<path>]`, `graph audit <path>`, `n-cursor watch`; `n-cursor flow` позначено як видалений.
