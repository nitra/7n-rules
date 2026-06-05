---
session: 6fe23dd0-c98a-4062-9d55-2dc4ce97b956
captured: 2026-06-05T10:10:49+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fe23dd0-c98a-4062-9d55-2dc4ce97b956.jsonl
---

## ADR `flow init` як мінімально необхідний старт для flow-турнікета

## Context and Problem Statement
У проєкті є дві точки входу для створення ізольованого worktree: `n-cursor worktree add` і `flow init`. Питання постало, бо worktree, створений напряму через `worktree add`, не мав flow-стану — і `flow review` падав із «стану нема». Потрібно було зрозуміти різницю й полагодити без перестворення worktree.

## Considered Options
* `flow init` зсередини вже наявного worktree (виявлено через `isLinkedWorktree` → пропускає `worktree add`, лише дописує `.flow.json`)
* Видалити worktree й перестворити через `flow init` з нуля

## Decision Outcome
Chosen option: "Виклик `flow init` зсередини наявного worktree", because `ensureWorktree` в `commands.mjs:76-77` детектує `isLinkedWorktree(cwd)` і не вкладає новий worktree — натомість лише записує `.flow.json` поруч (`.worktrees/<branch>.flow.json`), зберігаючи незакомічену роботу.

### Consequences
* Good, because transcript фіксує очікувану користь: незакомічені зміни збережено, стан записано (`level 1, risk low`), `flow review` підхопив `.flow.json` і відпрацював із 11 findings.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/dispatcher/lib/commands.mjs:76-90` — `ensureWorktree`, перевірка `isLinkedWorktree`
- `npm/scripts/dispatcher/lib/state-store.mjs:4-7` — стан лежить як sibling-файл `.worktrees/<sanitized-branch>.flow.json`
- `npm/scripts/dispatcher/lib/review.mjs:116-121` — `readState` на старті `flow review`, exit 1 при відсутньому стані
- Команда відновлення стану: `cd .worktrees/feat-coverage-changed-gate && npx @nitra/cursor flow init feat/coverage-changed-gate "<опис>"`
