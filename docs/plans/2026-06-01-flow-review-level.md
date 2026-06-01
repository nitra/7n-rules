---
kind: nitra-plan
status: draft
spec: ../specs/2026-06-01-flow-review-level.md
flow: ../../.claude/worktrees/strange-kirch-a95b58.flow.json
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# flow review + level — план реалізації

> TDD, дрібні кроки, ін'єкції IO, fail-closed/soft за специфікою. Канон —
> `npm/scripts/dispatcher/lib/`. Коміти часті; версію руками не чіпати.

**Goal:** `flow review` (adversarial diff-review) + scale-adaptive `level` в `init`.

## Кроки

1. level: чиста функція detectLevel(desc)→0..3 за keyword-таблицею — acceptance: юніт-тести fix→0, platform→3, feature→2, дефолт→1
2. level: reviewersForLevel(level)→1..3 — acceptance: L0/L1→1, L2→2, L3→3
3. init: писати level у стан через detectLevel(desc) — acceptance: тест init фіксує level у .flow.json
4. review: diffFromBase(base, run)→текст git diff — acceptance: тест склеює staged+worktree diff, порожній→''
5. review: reviewerPrompt(diff) + parseFindings(text) fail-soft — acceptance: валідний JSON→масив, сміття→[] без throw
6. review: handler flow review — base зі стану, N=reviewersForLevel, спавн через runner, запис review у стан — acceptance: тест із fake-runner пише review.findings і повертає 0
7. review: порожній diff→лог і код 0; нема стану→1 — acceptance: тести обох гілок
8. CLI: маршрутизація review в index.mjs (SUBCOMMANDS/DEFAULT_HANDLERS/USAGE) — acceptance: runFlowCli(['review']) кличе handler
9. контракт flow.mdc: крок Review + згадка рівнів — acceptance: bun rules/flow/fix.mjs зелений
10. changeset .changes + усі тести dispatcher зелені — acceptance: vitest scripts/dispatcher pass, eslint моїх файлів чистий
