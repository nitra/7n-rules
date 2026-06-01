---
kind: nitra-plan
status: draft
spec: ../specs/2026-06-01-flow-risk-review.md
flow: ../../.claude/worktrees/strange-kirch-a95b58.flow.json
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# risk-aware review — план реалізації

> TDD, ін'єкції IO. Канон — `npm/scripts/dispatcher/lib/`.

**Goal:** risk керує глибиною/фокусом `flow review`; сигнал init→spec→review.

## Кроки

1. level.mjs: detectRisk(desc)→low|med|high за keyword-таблицею — acceptance: security→high, migration→med, дефолт→low
2. level.mjs: reviewersForRisk(risk) + reviewersFor(level,risk)=max(level,risk) кап 3 — acceptance: L0+high→3, L2+low→2, L0+low→1
3. init: писати risk=detectRisk(desc) у стан поряд з level — acceptance: тест init фіксує risk
4. spec: зчитати risk зі spec-frontmatter (parseFrontMatter), override state.risk якщо валідний — acceptance: тест spec з risk:high у frontmatter пише state.risk=high
5. review: reviewersFor(level,risk) замість reviewersForLevel; reviewerPrompt(diff,risk) додає безпекову лінзу для high — acceptance: тест high→3 рецензенти; промпт містить «БЕЗПЕЦ» для high
6. контракт flow.mdc: згадка risk у кроках init/spec/review — acceptance: bun rules/flow/fix.mjs зелений
7. changeset + усі тести dispatcher зелені + eslint моїх файлів чистий — acceptance: vitest pass, eslint clean
