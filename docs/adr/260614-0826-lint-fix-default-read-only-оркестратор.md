---
type: ADR
title: "Lint fix default і read-only режим оркестратора"
description: Lint-оркестратор має мати ортогональні осі scope та behavior: за замовчуванням fix, а --read-only для detect-only без мутацій.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Існуючий lint-оркестратор розрізняв scope, але не мав єдиного режиму detect-only без мутацій файлів. Водночас існував окремий `n-cursor fix` з convergence-loop і check-gate. Потрібно було уніфікувати точки виклику так, щоб `lint` став єдиним оркестратором: за замовчуванням виправляє, а з `--read-only` лише детектує.

Також потрібно було узгодити scope-вісь із каноном changed-vs-origin / `--full` і визначити, що робити з LLM-ескалацією, правилами без lint-фази та попередньою забороною паралельного eslint/oxlint.

## Considered Options

- Додати `--read-only` до lint-оркестратора: default = fix, `--read-only` = detect-only.
- Зберегти окремий `n-cursor fix` як deprecation alias.
- Видалити `n-cursor fix` без alias.
- Використовувати omlx або прямі локальні виклики як основний LLM для fix-ескалації.
- Зберегти категорію `manual` для concerns без автофіксу.
- Автофіксувати всі concerns через Tier0 або Tier1+ LLM.
- Реалізувати lint лише для правил, які вже мали lint-фазу.
- Реалізувати lint для всіх правил.
- Залишити заборону паралельного eslint/oxlint.
- Зняти заборону для паралельних запусків по різних файлах.

## Decision Outcome

Chosen option: "Єдиний lint-оркестратор: fix default, `--read-only` detect-only, `--full` для scope", because transcript прямо фіксує семантику: `lint` за замовчуванням виправляє, `lint --read-only` лише детектує, `n-cursor fix` не потрібен як alias, а всі правила мають отримати lint-фазу.

### Consequences

- Good, because `--read-only` гарантує detect-only режим без мутацій файлів і підходить для CI та pre-commit.
- Good, because fix-режим повертає exit 1 лише на невиправних залишках після автофіксу, що підтримує локальний workflow.
- Good, because `n-cursor fix` видаляється без legacy alias, а convergence-loop стає engine lint fix-режиму.
- Good, because усі правила отримують єдину точку входу `lint(files, cwd, { readOnly })`.
- Bad, because transcript не містить підтверджених негативних наслідків видалення `n-cursor fix` для зовнішніх користувачів.
- Neutral, because transcript не містить підтвердження якості LLM-виправлень для security-findings або інших складних concerns.

## More Information

Transcript facts:

- Behavior axis: default fix / `--read-only` detect-only.
- Scope axis: default diff від origin / `--full` повний обхід.
- CI автоматично використовує read-only.
- Pre-commit hook використовує read-only.
- Контракт правила: `lint(files, cwd, { readOnly })`.
- Read-only інваріант: LLM не викликається, файли не змінюються.
- `n-cursor fix` видаляється без deprecation alias.
- `_fix-check --json` переходить у `lint --read-only --json`.
- LLM-ескалація має використовувати omlx або прямі локальні виклики; cloud не є основним шляхом.
- Категорії `manual` немає: все фікситься через Tier0 або Tier1+ LLM.
- Правила без попередньої lint-фази: `n-adr`, `n-changelog`, `n-bun`, `n-feedback`, `n-vue`, `n-worktree` — також мають отримати lint.
- Заборону паралельного eslint/oxlint знято для паралельних запусків по різних файлах.
- Спека: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`.
