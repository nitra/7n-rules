---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:04:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

Чекаю твоєї відповіді — потрібен дозвіл на запис у worktree. Підтверди, щоб оновити spec-файл і рухатись далі до плану.

---

## ADR worktree add — gitignore через sync

## Context and Problem Statement
`n-cursor worktree add` створює `.worktrees/<name>/` та сусідні файли, але у чужому/новому репо не гарантує присутності `.worktrees/` у `.gitignore`. Worktree-артефакти вилазять у `git status` як untracked, а інвентарний `.md` може випадково потрапити в коміт.

## Considered Options
* Записати `.worktrees/` у `.gitignore` з `worktree add` CLI (варіант A)
* Записати `.worktrees/` через sync-крок `syncClaudeConfig` у `sync-claude-config.mjs` (варіант B)
* Розширити наявний `syncGitignoreAdrFragment` через `.gitignore.snippet` (варіант C1 у межах B)
* Окремий виклик `ensureGitignoreEntries` поряд з ADR-кроком (варіант C2 у межах B)

## Decision Outcome
Chosen option: "B/C2 — окремий `ensureGitignoreEntries` у sync-кроці, безумовно", because sync є канонічним шляхом для керованих gitignore-записів у цьому репо (механіка ADR-фрагмента вже усталена в `sync-claude-config.mjs`), а окремий виклик семантично чистіший від розширення ADR-snippet, який є частиною ADR hook-шаблону. Умова — безумовно (b1), бо `.worktrees/` — такий само «завжди-ігнорований» артефакт як `node_modules/`, гейтинг за `n-worktree` rule зайвий.

### Consequences
* Good, because transcript фіксує очікувану користь: в нових/чужих репо `.worktrees/` гарантовано ігнорується після першого `npx @nitra/cursor` без ручного втручання.
* Good, because `ensureGitignoreEntries` — idempotent append-only; якщо рядок вже є (як у поточному репо) — no-op.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Точка вмонтування: `npm/scripts/sync-claude-config.mjs`, функція `syncClaudeConfig`, поряд з `syncGitignoreAdrFragment`
- Утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs`, сигнатура `ensureGitignoreEntries(cwd, entries, sectionLabel)` → `{ added: string[] }`
- Зразок повернення: додатковий прапор `gitignoreWorktree: boolean` у звіт (за зразком `gitignoreAdr`)
- Вже існуючий рядок `.worktrees/` у `.gitignore` цього репо знаходиться на рядку 10, поряд з `.claude/worktrees/` (рядок 9)
- Spec-документ: `docs/specs/2026-06-01-worktree-add-gitignore.md` у worktree `feat-worktree-gitignore`
