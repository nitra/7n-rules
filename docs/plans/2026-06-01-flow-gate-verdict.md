---
kind: nitra-plan
status: draft
spec: ../specs/2026-06-01-flow-gate-verdict.md
flow: ../../.claude/worktrees/strange-kirch-a95b58.flow.json
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# flow gate — план реалізації

> TDD, дрібні кроки, ін'єкції IO. Канон — `npm/scripts/dispatcher/lib/`.

**Goal:** `flow gate` — структурований вердикт PASS/CONCERNS/FAIL зі synthesis
verify-гейтів і review-findings; release м'яко попереджає на FAIL.

## Кроки

1. gate: чиста computeGate(state)→{verdict,score,reasons} — acceptance: всі зелені→PASS; failed gate→FAIL; high finding→FAIL; med→CONCERNS; порожні gates→CONCERNS
2. gate: score-обчислення з клампом 0..100 — acceptance: тести штрафів за failed/high/med і clamp на 0
3. gate: handler flow gate — нема стану→1, пише gate у .flow.json, FAIL→1 інакше 0 — acceptance: тести трьох гілок + запис gate у стан
4. release: м'який варн при gate.verdict FAIL — acceptance: тест що release логує попередження і не падає на FAIL-гейті
5. CLI: маршрутизація gate в index.mjs — acceptance: runFlowCli(['gate']) кличе handler
6. контракт flow.mdc: крок gate перед release — acceptance: bun rules/flow/fix.mjs зелений
7. changeset + усі тести dispatcher зелені + eslint моїх файлів чистий — acceptance: vitest scripts/dispatcher pass, eslint clean
