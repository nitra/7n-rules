---
kind: nitra-plan
spec: ../specs/2026-06-02-flow-coverage-stryker-local.md
flow: ../../.worktrees/flow-coverage-stryker-local.flow.json
status: draft
---

# План: coverage-gate локальний Stryker

Дата: 2026-06-02
Spec: [2026-06-02-flow-coverage-stryker-local](../specs/2026-06-02-flow-coverage-stryker-local.md)

## Кроки

1. У runStryker (js-lint/coverage/coverage.mjs) резолвити локальний @stryker-mutator/core/bin/stryker.js через createRequire(import.meta.url) і запускати через process.execPath; fallback на npx; оновити коментар — acceptance: node --check ок; локальний core резолвиться.
2. Тести js-lint/coverage зелені (наявні мок-runner); якщо є дешевий юніт на резолвер-гілку — додати — acceptance: bun test js-lint/coverage зелений.
3. Change-файл (--ws npm) + flow verify у worktree (coverage-gate має пройти) — acceptance: verify coverage-gate зелений; eslint exit 0; change-файл у npm/.changes/.
