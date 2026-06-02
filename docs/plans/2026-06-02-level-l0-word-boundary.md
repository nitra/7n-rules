---
kind: nitra-plan
spec: ../specs/2026-06-02-level-l0-word-boundary.md
flow: ../../.worktrees/flow-level-l0-word-boundary.flow.json
status: draft
---

# План: L0 word-boundary

Дата: 2026-06-02
Spec: [2026-06-02-level-l0-word-boundary](../specs/2026-06-02-level-l0-word-boundary.md)

## Кроки

1. Падаючі тести: prefix/fixture/suffix→1, fix typo→0, перейменування→0, guard fix mdc→1 — acceptance: тести падають.
2. level.mjs: L0_WORD_KEYS/L0_SUBSTR_KEYS + hasWord(isAlnum-межі, без regex) — acceptance: усі кейси зелені.
3. Change-файл (--ws npm) + тести/oxlint — acceptance: bun test level зелений; oxlint 0; change у npm/.changes/.
