---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:49:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

<output_was_truncated_see_audit_trail_for_full_output>

---
Produce ADR documentation for this session.

## ADR про вибір місця вмонтування гарантії `.worktrees/` у `.gitignore`

## Context and Problem Statement
`n-cursor worktree add` і `flow init` створюють каталог `.worktrees/` у корені репо, але не гарантують наявності відповідного запису в `.gitignore`. У новому або чужому репо всі worktree-артефакти вилізали в `git status` як untracked, що ускладнювало роботу.

## Considered Options
* Додати виклик `ensureGitignoreEntries()` у `worktree add` CLI-команду (lazy, в момент створення каталогу)
* Додати новий top-level sync-крок у `runSync()` всередині `syncClaudeConfig()` (при кожному sync)
* Додати новий top-level sync-крок у `runSync()` як окремий незалежний крок, сусід `syncClaudeConfig()` (b1, безумовно)
* Гейтувати sync-крок за наявністю worktree-правила в `.n-cursor.json` (b2, аналогія до adr-гейту)

## Decision Outcome
Chosen option: "Окремий top-level sync-крок у `runSync()` (b1, безумовно)", because продюсер `.worktrees/` — `flow`/`worktree-cli` — завжди активний (правило `n-flow.mdc` — `alwaysApply: true`), тож гарантія має бути безумовною; вмонтування всередині `syncClaudeConfig()` некоректне — ця функція покриває тільки Claude/Cursor-конфіг і має ранній `return` при `claude-config: false`; гейт b2 міг би розсинхронізувати продюсера і запис у `.gitignore` (вимкнене worktree-правило + активний flow → дірка лишається). Утиліта `ensureGitignoreEntries()` вже існувала і була idempotent, тому інтеграція коштувала один виклик.

### Consequences
* Good, because запис `.worktrees/` у `.gitignore` гарантується при кожному `npx @nitra/cursor` sync, незалежно від конфігурації правил і без додаткових ручних дій у нових репо.
* Good, because функція `syncClaudeConfig` лишається з чесним неймінгом — Claude/Cursor-конфіг, без домішки worktree-концерну.
* Bad, because репо, яке взагалі не використовує worktree, отримує рядок `.worktrees/` у `.gitignore` — нешкідливий no-op, але технічно зайвий запис.

## More Information
- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` (обгортка над `ensureGitignoreEntries`)
- Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (4 тести: fresh-repo, idempotency, append-only, existing gitignore)
- Підключення: `npm/bin/n-cursor.js`, функція `runSync()`, окремий `runSyncStep`
- Spec: `docs/specs/2026-06-01-worktree-add-gitignore.md`
- Plan: `docs/plans/2026-06-01-worktree-add-gitignore.md`
- Коміт: `e0f5e52 feat(sync): гарантувати .worktrees/ у .gitignore під час sync`
- Існуюча утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs` (idempotent append-only, використовується також для Stryker temp-каталогів)
