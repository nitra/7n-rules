---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: ce5e2e20
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль оркеструє повний цикл `git-reconcile`: збирає Git-факти, делегує моделі лише semantic triage та конфлікти, переносить корисні зміни у свіжий worktree, перевіряє результат і прибирає тільки доведено зайві refs та worktree.

## Поведінка

- Inventory містить повні worktree records, dirty/protected/locked стан і відкриті PR. Якщо GitHub inventory неповний, cleanup діє fail-closed.
- LLM отримує bounded facts і працює через `min → validation → max`; Git-операції, gates та cleanup залишаються детермінованими.
- `.changes + lockfile` є валідним release PR. Якщо exact release narrative вже є у base `CHANGELOG.md`, такий source вважається patch-equivalent і окремий PR не створюється.
- Змінений `bun.lock` завжди проходить `bun install --frozen-lockfile`, незалежно від наявності `node_modules`. За потреби один canonical remediation оновлює lockfile, після чого всі guards виконуються повторно.
- PR description будується з final diff, ставить business та architecture вище implementation details і не публікує raw agent transcript.
- Failed PR check є regression лише коли однойменний check був green на exact base commit. Відсутній або pending baseline лишає PR непідтвердженим.
- Cleanup прибирає stale records та clean inactive worktree лише з керованих transient namespaces. Current, dirty, locked, protected, open-PR і worktree з унікальними commits зберігаються.

## Перевірки

Regression suite покриває parser worktree-стану, patch-equivalent guard, lockfile remediation, bounded PR narrative, CI baseline classification, safe cleanup і повний orchestration flow.
