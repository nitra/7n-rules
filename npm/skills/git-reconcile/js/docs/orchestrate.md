---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: d2d35ba4
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль оркеструє `git-reconcile`: збирає Git-факти, делегує моделі лише
semantic triage та конфліктні перенесення, перевіряє результат, створює PR і
прибирає тільки Git-доведено зайві sources.

## Поведінка

- Після `fetch --prune` local і tracking branches групуються ancestry-aware без
  фізичного fast-forward; активні, dirty, locked, protected та open-PR
  checkout-и зберігаються.
- Stash inventory бачить tracked і untracked payload без `apply`. Stash, чиї
  paths уже тотожні policy base, позначається absorbed; серед exact patch
  duplicates найновіший лишається canonical, а старіші стають
  `patch-equivalent`.
- LLM отримує bounded Git-факти через `min → validation → max`. Triage повертає
  явний intent, а JS не дозволяє класифікувати завершену корисну зміну як
  `keep` лише через conflict: semantic conflict resolution виконується далі.
- Перенесена зміна проходить Git-state, tests, scoped docs/lint, changelog,
  lockfile, final diff та CI gates. `.changes + lockfile` лишається валідним
  release PR, якщо відповідний narrative ще не присутній у base changelog.
- Cleanup виконується за stable ref/OID після успішного перенесення або
  детермінованого доказу merged, absorbed чи exact-duplicate стану. Загальний
  `git stash clear` не використовується.
- Підсумок показує outcomes, фактичну кількість початкових і створених під час
  materialization branch/worktree/stash, що лишилися після cleanup, та
  агреговані причини їх збереження.

## Перевірки

Regression suite покриває tracking ancestry, untracked stash inventory,
absorbed/exact-duplicate cleanup, conflict-aware triage intent, behavioral
gates, CI classification і фактичний remaining summary.
