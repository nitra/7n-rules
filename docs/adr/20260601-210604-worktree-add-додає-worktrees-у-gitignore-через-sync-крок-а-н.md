---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:06:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR `worktree add` додає `.worktrees/` у `.gitignore` через sync-крок, а не через CLI

## Context and Problem Statement
`n-cursor worktree add` створює каталог `.worktrees/<name>/` та інвентарний `.md`-файл, але ніколи не додавав `.worktrees/` у `.gitignore`. У репо без цього рядка worktree-артефакти вилізали в `git status` як untracked, а інвентарний `.md` можна було випадково закомітити.

## Considered Options
* Додати виклик `ensureGitignoreEntries` у команду `add` у `worktree-cli.mjs` (lazy, в момент створення каталогу)
* Додати крок у top-level sync (`npm/bin/n-cursor.js`), незалежний від `syncClaudeConfig` (eager, при кожному синку)

## Decision Outcome
Chosen option: "Окремий top-level `runSyncStep` у `npm/bin/n-cursor.js`", because в `n-cursor.js` вже є усталена конвенція керування `.gitignore` (`syncGitignoreAdrFragment` у `sync-claude-config.mjs`) з готовою утилітою `ensureGitignoreEntries` (idempotent append-only). Вмонтування в CLI (`worktree add`) означало б паралельний механізм повз наявну конвенцію і спрацьовував би лише через CLI, а не через `npx @nitra/cursor`.

### Consequences
* Good, because `ensureGitignoreEntries` — idempotent: якщо рядок уже є, виконується no-op; наявні репо (де рядок закомічено вручну) не постраждають.
* Bad, because transcript не містить підтверджених негативних наслідків.

---

## ADR `.worktrees/` додається у `.gitignore` безумовно (без гейту за worktree-rule)

## Context and Problem Statement
Обираючи, чи гейтити новий sync-крок на наявність worktree-правила в `.n-cursor.json` (за симетрією з `adr`-гейтом), потрібно було вирішити: безумовний запис (b1) чи умовний (b2).

## Considered Options
* b1 — додавати `.worktrees/` завжди, без гейтингу
* b2 — гейтити на `rules.includes('worktree')`, за симетрією з `const includeAdrHook = rules.includes('adr')`

## Decision Outcome
Chosen option: "b1 (безумовно)", because продюсер артефактів `.worktrees/` — `flow` (правило `n-flow.mdc` має `alwaysApply: true`) і `worktree-cli` — активний завжди. Гейт b2 міг би розсинхронізуватись: хтось вимикає worktree-rule, але далі кличе `flow init` → `.worktrees/` створюється, а ignore-рядка немає. Adr-гейт коректний саме тому, що продюсер (adr Stop-hook) і гейт (adr-rule) — та сама сутність; для worktree ця умова не виконується.

### Consequences
* Good, because transcript фіксує очікувану користь: `.worktrees/` гарантовано ігнорується в будь-якому репо зі встановленим `@nitra/cursor`, навіть якщо worktree-rule вимкнено.
* Bad, because репо, яке не використовує worktree взагалі, отримає один зайвий рядок у `.gitignore`; transcript визнає це нешкідливим no-op.

---

## ADR Новий gitignore-крок для `.worktrees/` розміщується поза `syncClaudeConfig`

## Context and Problem Statement
`syncClaudeConfig` (`npm/scripts/sync-claude-config.mjs`) вже містить merge `.gitignore`-фрагмента для adr-артефактів. Постало питання, чи вкладати новий `.worktrees/`-запис всередину цієї функції або додавати його окремим кроком у `npm/bin/n-cursor.js`.

## Considered Options
* Вкласти виклик `ensureGitignoreEntries('.worktrees/')` всередину `syncClaudeConfig`
* Окремий top-level `runSyncStep` у `n-cursor.js`, що кличе нову функцію (напр. `syncGitignoreWorktree(projectRoot)`)

## Decision Outcome
Chosen option: "Окремий top-level `runSyncStep`", because `syncClaudeConfig` по JSDoc відповідає за `.claude/settings.json`, slash-команди та ADR Stop-hook — Claude/Cursor-конфіг-бандл. `.worktrees/` — ортогональний концерн, не пов'язаний з ним. Критичний аргумент: `syncClaudeConfig` має ранній `return` при `claude-config: false`; вкладення всередину призвело б до тієї самої дірки — ignore-рядок зникав би для тих, хто вимкнув claude-config, хоча flow від нього не залежить.

### Consequences
* Good, because неймінг залишається чесним: кожен `runSyncStep` — один концерн; нема прихованого зчеплення через `claude-config`-опт-аут.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ключові файли: `npm/bin/n-cursor.js` (top-level sync-кроки, `runSyncStep`), `npm/scripts/sync-claude-config.mjs` (`syncGitignoreAdrFragment`, гейт `includeAdrHook`, ранній return на `claude-config: false`), `npm/scripts/utils/ensure-gitignore-entries.mjs` (idempotent append-only утиліта), `npm/scripts/lib/worktree-cli.mjs` (`cmdAdd`). Правило `n-flow.mdc`: `alwaysApply: true`. Рядки `.gitignore` у корені репо: рядок 9 — `.claude/worktrees/`, рядок 10 — `.worktrees/`.
