---
type: ADR
title: "Lint-оркестратор: check-script, read-only та fix"
description: Lint-оркестратор працює на рівні check-script, має ортогональні осі scope і behavior, а `--read-only` передається як параметр у кожен check-script.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Існуючий lint-оркестратор розрізняв переважно scope запуску, але не мав єдиного detect-only режиму без мутацій файлів. Також у transcript уточнено, що правильна одиниця оркестрації — не `.mdc` правило і не конкретний tool, а check-script, який реалізує перевірку.

Потрібно уніфікувати поведінку lint/fix, CI detect-only і майбутню інтеграцію fix-двигуна без привʼязки оркестратора до oxlint, eslint, knip або інших конкретних інструментів.

## Considered Options

* Додати `--read-only` до оркестратора і передавати `{ readOnly: true }` у check-script.
* Залишити `n-cursor fix` як окремий legacy-аліас.
* Поглинути `n-cursor fix` lint fix-режимом без alias.
* Використовувати omlx або прямі локальні виклики для LLM-ескалації.
* Інші варіанти для read-only у transcript не обговорювалися.

## Decision Outcome

Chosen option: "Check-script orchestration з `--read-only` і lint fix-mode", because користувач підтвердив, що параметр `read-only` не має фільтрувати flags на рівні оркестратора: оркестратор передає `{ readOnly: true }`, а кожен check-script сам вирішує, що робити.

Прийнята семантика:

* одиниця оркестрації — check-script;
* default behavior — fix-mode;
* `--read-only` — detect-only без мутацій файлів;
* CI і pre-commit використовують read-only;
* scope-вісь незалежна: default diff від origin, `--full` повний прогін;
* `n-cursor fix` поглинається lint fix-режимом без legacy alias;
* LLM-ескалація fix-режиму має використовувати локальний omlx або прямі локальні виклики, а не хмарні як основний шлях.

### Consequences

* Good, because read-only має чіткий контракт: жоден файл не змінюється, а check-script лише репортує знахідки.
* Good, because fix-mode стає єдиним локальним workflow: автофікс застосовується спершу, а exit 1 лишається для невиправних залишків.
* Good, because оркестратор не знає про конкретні tools усередині check-script і не дублює їхню логіку.
* Bad, because видалення `n-cursor fix` без alias є breaking change.

## More Information

Спека з transcript: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`. Канон scope-осі: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`. Оркестратор: `npm/scripts/lint-cli.mjs`. Контракт: `lint(files, cwd, { readOnly })` або еквівалентний параметр у check-script. Transcript також фіксує рішення реалізувати lint-фазу для всіх правил і зняти заборону паралельного eslint/oxlint для різних файлів.

## Update 2026-06-14

Уточнено рівень абстракції оркестратора: одиницею оркестрації є не `.mdc` правило і не конкретний tool, а `check-<id>.mjs` / check-script. Оркестратор передає параметр `{ readOnly: true }` кожному check-script, а сам check-script вирішує, як інтерпретувати read-only для своїх інструментів і перевірок.
