---
type: ADR
title: "Fail-fast у lint — лише для --read-only"
description: "У fix-режимі per-file правило з ненульовим кодом не спиняє оркестратор; прогін доходить до кроку виправлення (конформність-драбина). Fail-fast лишається тільки в --read-only (CI/детект)"
---

# Fail-fast у lint — лише для --read-only

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Оркестратор `n-cursor lint` (`npm/rules/lint/js/orchestrate.mjs`) спиняв прогін на першому правилі з ненульовим кодом (fail-fast) — і в детект-режимі, і у fix-режимі. На практиці це означало, що `lint --full` із наявними per-file порушеннями (напр. `js-lint`) **ніколи не доходив** до конформність-фази з драбиною ескалації та хуком аналітики: реальний прогін показав exit 1 на js-lint, а крок виправлення конформності так і не починався.

## Considered Options

* Лишити fail-fast скрізь (status quo).
* Fail-fast лише в `--read-only`; у fix-режимі проганяти всі правила й доходити до кроку виправлення, повертаючи найгірший код.

## Decision Outcome

Chosen option: "Fail-fast лише в `--read-only`", because у fix-режимі сенс прогону — виправити максимум, тож зупинка на першому правилі суперечить меті: крок виправлення (конформність-драбина) має починатися навіть якщо ранній per-file лінтер лишив порушення. `runPerFileRules` тепер повертає `{ stop, code }`: у `--read-only` повертає `{ stop:true }` на першому ненульовому (детект для CI), у fix-режимі акумулює найгірший код і йде далі. `runLint` після per-file фази виконує `runFullConformancePhase` (драбина + escalation-аналітика), а наприкінці повертає найгірший код. Поведінка `--read-only` не змінилась.

### Consequences

* Good, because `lint --full` (fix) тепер завжди доходить до кроку виправлення конформності — драбина ескалації й аналітика виконуються попри наявні per-file порушення.
* Good, because `--read-only` лишається швидким fail-fast для CI/pre-commit (детект без марних подальших прогонів).
* Bad, because у fix-режимі прогін довший: усі per-file правила + конформність виконуються навіть за наявних порушень (раніше спинявся на першому).
* Bad, because exit-код тепер «найгірший по фазах», а не «перший» — семантика коду незмінна (нуль/ненуль), але джерело ненульового може бути не найранішим правилом.

## More Information

Реалізація: `npm/rules/lint/js/orchestrate.mjs` (`runPerFileRules`, `runFullConformancePhase`, `runLint`). Супутні правки того ж набору (знахідки escalation-аналітики): `applyChanges` створює батьківську теку перед записом (`llm-fix-apply.mjs`); новий детермінований T0-патерн `changelog-create-change-file` (`t0.mjs`) створює change-файл через `writeChange` замість LLM.

## Update 2026-06-19

- Для CI/deploy перевірки потрібно запускати `npx @nitra/cursor lint --full --read-only`.
- `--read-only` означає detect-only: без мутацій і без LLM; якщо правило має `llmFix:true`, у CI воно не викликає LLM, а fail-иться з non-zero exit при невиправленому порушенні.
- `--full` потрібен у CI, бо без нього конформність-фаза не виконується і структурні правила не перевіряються.
- Локальний dev-flow лишається `npx @nitra/cursor lint`: розробник виправляє локально, CI лише детерміновано верифікує результат.
