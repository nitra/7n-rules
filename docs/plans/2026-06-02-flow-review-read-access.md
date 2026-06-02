---
kind: nitra-plan
spec: ../specs/2026-06-02-flow-review-read-access.md
flow: ../../.worktrees/flow-review-read-access.flow.json
status: draft
---

# План: flow review read-доступ

Дата: 2026-06-02
Spec: [2026-06-02-flow-review-read-access](../specs/2026-06-02-flow-review-read-access.md)

## Кроки

1. Падаючий тест: reviewerPrompt містить інструкцію про Read-верифікацію cross-file та заборону «з diff не видно» — acceptance: тест існує і падає.
2. Рефайн reviewerPrompt у review.mjs (read-доступ + обов'язкова верифікація + заборона нефальсифіковних findings; лінза й JSON-контракт збережені) — acceptance: новий + наявні тести зелені.
3. Change-файл (--ws npm) + локальні тести/lint — acceptance: bun test review зелений; eslint exit 0; change-файл у npm/.changes/.
