---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: bf77cc0a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль оркеструє `git-reconcile`: збирає Git-факти, нормалізує branch/worktree/stash inventory, делегує моделі лише semantic triage та конфлікти, переносить корисні зміни у свіжий worktree, перевіряє результат і прибирає тільки доведено зайві sources.

## Поведінка

- Після `fetch --prune` local branch ancestry-aware зіставляється зі своїм tracking upstream без фізичного fast-forward.
- `synced` і `behind-only` утворюють один candidate на remote tip; `ahead` — один candidate на local tip; `diverged` лишає два незалежні candidates.
- Local worktree protection переноситься на effective candidate, тому grouping не дозволяє cleanup активного checkout.
- Local і remote refs зберігаються як точні aliases для фінального cleanup, але pre-analysis не виконує `pull`, `merge --ff-only` або `update-ref`.
- LLM працює через `min → validation → max` лише над bounded Git-фактами; Git-операції, gates, PR і cleanup виконує JS.
- `.changes + lockfile` є валідним release PR, доки exact release narrative ще не присутній у base `CHANGELOG.md`.
- Змінений `bun.lock`, tests, scoped docs/lint, changelog, final diff і CI baseline проходять детерміновані gates.
- Cleanup зберігає current, dirty, locked, protected, open-PR та worktree з унікальними commits.

## Перевірки

Regression suite покриває tracking ancestry, effective-tip selection, diverged histories, worktree protection, patch-equivalence, lockfile remediation, CI classification і safe cleanup.
