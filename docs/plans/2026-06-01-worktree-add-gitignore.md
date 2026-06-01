---
kind: nitra-plan
status: draft
spec: ../specs/2026-06-01-worktree-add-gitignore.md
flow: ../../.worktrees/feat-worktree-gitignore.flow.json
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# Sync гарантує `.worktrees/` у `.gitignore` — план

**Goal:** Дефолтний `npx @nitra/cursor` sync безумовно гарантує рядок
`.worktrees/` у кореневому `.gitignore` (окремий top-level крок, не в
`syncClaudeConfig`).

**Architecture:** Нова тонка функція `syncGitignoreWorktree(projectRoot)` у
`npm/scripts/lib/sync-gitignore-worktree.mjs` поверх наявної
`ensureGitignoreEntries`. Підключення — окремий `runSyncStep(...)` у `runSync()`
(`npm/bin/n-cursor.js`), сусід Claude-конфіг-кроку; репорт `.gitignore (worktree)`.

**Tech Stack:** Node ESM (`.mjs`), vitest, `node:fs`.

**Канон (обовʼязково):**

- TDD: спершу падаючий тест, тоді реалізація.
- Кожен новий `.mjs` — багаторядковий верхній JSDoc українською (`scripts.mdc`).
- Тести співрозташовані: `lib/<f>.mjs` ↔ `lib/tests/<f>.test.mjs`; без
  `process.chdir` — `cwd`/`projectRoot` параметром.
- Версію/CHANGELOG руками НЕ чіпати — change-файл наприкінці; bump робить CI.
- Часті коміти (тримає `checkDirtyNpmRequiresVersionBump` зеленим).
- Команда тестів: `cd npm && npx vitest run scripts/lib/tests/sync-gitignore-worktree.test.mjs`.

**Поточний стан (зафіксовано):**

- `ensureGitignoreEntries(cwd, entries, sectionLabel)` —
  `npm/scripts/utils/ensure-gitignore-entries.mjs`: idempotent, append-only,
  header-секція; створює `.gitignore`, якщо немає.
- Зразок sync-gitignore: `syncGitignoreAdrFragment` →
  `sync-claude-config.mjs:535`; гейт `includeAdrHook`; репорт у `n-cursor.js:1433`.
- `runSync()` — `n-cursor.js:1312`; Claude-конфіг-крок ~1411 (`runSyncStep`).
- `.worktrees/` уже в `.gitignore` цього репо → новий крок тут = no-op.

## Кроки

1. Падаючий тест модуля — acceptance: `lib/tests/sync-gitignore-worktree.test.mjs`:
   у tmp-каталозі без `.gitignore` `syncGitignoreWorktree(dir)` повертає
   `{ written: true }` і `.gitignore` містить рядок `.worktrees/`; тест червоний
   (модуля ще нема).
2. Тест idempotency + append-only — acceptance: повторний виклик повертає
   `{ written: false }` і не дублює рядок; наявний кастомний `.gitignore`
   (напр. `node_modules/`) зберігається; тести червоні.
3. Реалізація модуля — acceptance: `sync-gitignore-worktree.mjs` із верхнім
   JSDoc + `syncGitignoreWorktree(projectRoot)` поверх `ensureGitignoreEntries`
   (`['.worktrees/']`, header `# @nitra/cursor — локальні git-worktree, не коміти`);
   усі тести кроків 1-2 зелені.
4. Підключення в sync — acceptance: у `runSync()` доданий `runSyncStep(...)` що
   кличе `syncGitignoreWorktree(cwd())` і друкує `.gitignore (worktree)` при
   `written`; імпорт додано.
5. Регресія — acceptance: `cd npm && npx vitest run scripts/` зелене (новий
   модульний тест + наявні `ensure-gitignore-entries`/`sync-claude-config`).
6. Реліз — acceptance: `flow verify` зелений; `flow release --bump patch
   --section Added` із change-файлом.
