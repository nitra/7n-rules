---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:40:37+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

Готово. Зміни в `main`:

- `npm/scripts/lib/sync-gitignore-worktree.mjs` — новий модуль (4 тести, 100% coverage)
- `npm/bin/n-cursor.js` — окремий `runSyncStep` у `runSync()`, безумовно дописує `.worktrees/` у `.gitignore` (b1)
- `npm/package.json` — `3.8.0 → 3.9.0`
- spec + plan задокументовано в `docs/`

---

## ADR Sync гарантує `.worktrees/` у `.gitignore` (b1, безумовно)

## Context and Problem Statement
`n-cursor worktree`/`flow` CLI постійно створює каталог `.worktrees/` і suplings (`.flow.json`, `.events.jsonl`, `.md`). У нових або чужих репо ці артефакти потрапляли в `git status` як untracked, бо `.worktrees/` у `.gitignore` не додавався автоматично — тільки вручну або якщо рядок вже закомічено.

## Considered Options
* **A — `worktree add`**: дописувати рядок при кожному виклику `worktree-cli.mjs add`.
* **B — окремий top-level sync-крок у `runSync()`** (обраний): новий `runSyncStep` поряд з `syncClaudeConfig`, викликає `syncGitignoreWorktree()` безумовно (b1).
* **B2 — sync зі гейтом за worktree-rule**: додавати рядок тільки якщо worktree-rule увімкнений у `.n-cursor.json`.

## Decision Outcome
Chosen option: "B (b1 — окремий sync-крок, безумовно)", because продюсер артефактів — `flow`/worktree-CLI з `alwaysApply: true` — завжди активний, тому гейт за rule-тумблером (b2) розсинхронив би запис у `.gitignore` з реальним виробником. Вкладати в `syncClaudeConfig` (A) неправильно: концерн інший, а рання відмова при `claude-config: false` приховала б рядок. Окремий безумовний крок — найпростіший і без дірок.

### Consequences
* Good, because `.worktrees/` гарантовано в `.gitignore` після будь-якого `npx @nitra/cursor` синку, незалежно від тумблерів правил.
* Good, because `ensureGitignoreEntries` — idempotent append-only: у репо, де рядок вже є (як цей), крок — no-op; нічого не псується.
* Bad, because репо, що встановило n-cursor але не використовує worktree, отримає один зайвий рядок у `.gitignore` — нешкідливий, але не порожній side-effect.

## More Information
- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` (обгортка над `ensureGitignoreEntries`)
- Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (4 тести, 100% coverage)
- Точка вмонтування: `npm/bin/n-cursor.js`, функція `runSync()`, окремий `runSyncStep`
- Базова утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs` (idempotent, append-only, з header-коментарем)
- Гейтинг b2 відкинуто: `n-flow.mdc` → `alwaysApply: true`; відсутній гейт-тумблер не зупиняє продюсера артефактів
