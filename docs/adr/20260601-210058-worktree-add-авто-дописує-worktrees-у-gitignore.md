---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:00:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR `worktree add` авто-дописує `.worktrees/` у `.gitignore`

## Context and Problem Statement
`n-cursor worktree add` створює каталог `.worktrees/<sanit>/` і супутні локальні файли (інвентарний `.md`, `.flow.json`, `.events.jsonl`), але наразі ніяк не гарантує наявність рядка `.worktrees/` у `.gitignore`. У цьому репо рядок є через ручний коміт; у будь-якому новому/зовнішньому репо ці файли вилізуть у `git status` як untracked, і інвентарний `.md` легко випадково закомітити.

## Considered Options
* Вмонтувати виклик `ensureGitignoreEntries()` лише в підкоманду `add` у `worktree-cli.mjs` (принцип «хто створює — той і ігнорує»)
* Вмонтувати у `add` і `prune`
* Вмонтувати в кожну підкоманду включно з read-only `list`
* Вмонтувати на рівні диспетчера `npm/bin/n-cursor.js` (піднято користувачем наприкінці, transcript обривається до завершення дослідження)

## Decision Outcome
Chosen option: "вмонтувати виклик `ensureGitignoreEntries()` лише в підкоманду `add` у `worktree-cli.mjs`", because це мінімально інвазивно — лише там, де дерево вже й так модифікується; утиліта idempotent і append-only, тому для репо з уже наявним рядком — no-op. Рівень injection між `worktree-cli.mjs` і `n-cursor.js`-диспетчером залишається відкритим: користувач поставив питання про `n-cursor.js`, і transcript обривається на дослідженні `sync-claude-config.mjs` як потенційної альтернативи.

### Consequences
* Good, because в будь-якому репо після першого `worktree add` `.worktrees/` гарантовано ігнорується без ручного кроку.
* Good, because transcript фіксує очікувану користь: `ensureGitignoreEntries()` вже має тести, append-only логіку і header-коментар — інтеграція коштує ~один виклик.
* Bad, because `worktree-cli.mjs` отримує side-effect-запис у файл поза «своїм» каталогом; transcript визнає це свідомим компромісом, але не фіксує заперечень проти нього.

## More Information
* `npm/scripts/utils/ensure-gitignore-entries.mjs` — idempotent append-only утиліта (наявна, з тестами).
* `npm/scripts/worktree-cli.mjs` — точка вмонтування (підкоманда `cmdAdd`); зараз не імпортує `ensureGitignoreEntries`.
* `npm/bin/n-cursor.js` — диспетчер; містить усталений патерн gitignore-merge у кроці `syncClaudeConfig` через `npm/scripts/sync-claude-config.mjs` (канонічний фрагмент `rules/adr/js/hooks/template/.gitignore.snippet`); розглядався як альтернативна точка вмонтування — рішення до кінця transcript не прийнято.
* Flow-задача ініційована: `flow init feat-worktree-gitignore` → `.worktrees/feat-worktree-gitignore.flow.json` (level 1, risk low).
* Spec-документ створено: `docs/specs/2026-06-01-worktree-add-gitignore.md` у worktree (зафіксовано `flow spec`).
