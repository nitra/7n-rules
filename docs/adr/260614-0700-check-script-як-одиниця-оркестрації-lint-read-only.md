---
type: ADR
title: "Check-script як одиниця оркестрації lint read-only"
description: Оркестратор lint має ітерувати check-script-и та передавати їм параметр readOnly, не оперуючи безпосередньо mdc-правилами чи конкретними інструментами.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Потрібно було визначити правильний рівень абстракції для універсального lint-оркестратора. У transcript уточнено, що `.mdc` описує вимогу до якості, конкретні інструменти можуть перевіряти кілька вимог, а одиницею запуску має бути lint check-script.

Також потрібно було визначити, як оркестратор передає режим без мутацій: не через ручне виключення прапорів конкретних інструментів, а через параметр контракту для кожного check-script.

## Considered Options

- Оркестратор ітерує `.mdc`-правила.
- Оркестратор ітерує check-script-и `check-<id>.mjs`.
- Оркестратор сам знає прапори конкретних інструментів.
- Оркестратор передає `{ readOnly: true }`, а check-script сам вирішує, як це виконати.

## Decision Outcome

Chosen option: "Оркестратор ітерує check-script-и та передає `{ readOnly: true }`", because transcript прямо уточнює, що check-script є правильною одиницею оркестрації, а конкретний інструмент є деталлю реалізації всередині check-script.

### Consequences

- Good, because оркестратор не залежить від oxlint, knip чи інших інструментів і не дублює їхні прапори.
- Good, because `{ readOnly: true }` стає контрактом між оркестратором і check-script, а не між оркестратором і зовнішнім CLI.
- Neutral, because transcript не містить підтвердження наслідків для check-script-ів, які не мають автоматичного fix-режиму.

## More Information

Transcript facts:

- `.mdc` — декларативний опис вимоги до якості.
- `check-<id>.mjs` — lint-скрипт перевірки цієї вимоги.
- Один інструмент може перевіряти кілька `.mdc` через різні `check-*.mjs`.
- Оркестратор приймає `--read-only` і передає кожному check-script параметр `{ readOnly: true }`.
- Check-script сам вирішує, як інтерпретувати `readOnly`.
- Специфікацію було збережено у `docs/specs/lint-orchestrator.md`.
