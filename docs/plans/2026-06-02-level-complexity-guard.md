---
kind: nitra-plan
spec: ../specs/2026-06-02-level-complexity-guard.md
flow: ../../.worktrees/flow-level-complexity-guard.flow.json
status: draft
---

# План: detectLevel COMPLEXITY-guard

## Кроки

1. Падаючі тести: fix mdc checker→2, fix суперечність→2, fix rego policy→2, чисте fix typo→0, prefix→1, feature→2 — acceptance: падають.
2. level.mjs: COMPLEXITY_KEYS + реордер (L2∪COMPLEXITY перед isL0) — acceptance: усі кейси зелені, hygiene без регресу.
3. Change-файл (--ws npm) + тести/oxlint — acceptance: bun test level зелений; oxlint 0; change у npm/.changes/.
