---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:59:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR Гарантія `.worktrees/` у `.gitignore` через окремий sync-крок

## Context and Problem Statement
`n-cursor worktree add` і `flow init` створюють каталог `.worktrees/` у кореневому дереві репо, але не дописують відповідний `.gitignore`-патерн. У репо без закоміченого рядка `.worktrees/` усі worktree-артефакти (інвентарні `.md`, `.flow.json`, `.events.jsonl`) вилазять у `git status` як untracked і можуть випадково потрапити до коміту.

## Considered Options
* Дописувати `.worktrees/` у `.gitignore` всередині команди `worktree add` (`worktree-cli.mjs`)
* Дописувати у наявній функції `syncClaudeConfig` (`sync-claude-config.mjs`) разом з `gitignoreAdr`-фрагментом
* Окремий top-level `runSyncStep` у `runSync()` (`n-cursor.js`), що викликає нову функцію `syncGitignoreWorktree`

## Decision Outcome
Chosen option: "Окремий top-level `runSyncStep` у `runSync()`", because `worktree add` спрацьовує лише при створенні (пропускає репо, що вже існують), а `syncClaudeConfig` оголошує своїм скоупом виключно Claude/Cursor-конфіг і має ранній `return` при `claude-config: false` — обидва варіанти створювали б дірку в гарантії.

### Consequences
* Good, because крок безумовний (b1): продюсер `.worktrees/` — `flow init` / CLI — є `alwaysApply`, тож ignore-рядок гарантовано незалежно від тумблерів правил у `.n-cursor.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` — тонка обгортка над наявним `ensureGitignoreEntries()` (idempotent append-only).
- Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (4 кейси: fresh repo, idempotency, existing `.gitignore` append-only, `written` boolean у return).
- Точка вставки у `npm/bin/n-cursor.js`: `runSyncStep(...)` після блоку claude-config-звіту (`~1411`), окремий рядок репорту `'.gitignore (worktree)'`.
- Коміт реалізації: `e0f5e52 feat(sync): гарантувати .worktrees/ у .gitignore під час sync`.
- Spec: `docs/specs/2026-06-01-worktree-add-gitignore.md`; Plan: `docs/plans/2026-06-01-worktree-add-gitignore.md`.

---

## ADR Відмова від гейтингу `syncGitignoreWorktree` за worktree-правилом

## Context and Problem Statement
Під час дизайну постало питання, чи варто умовно (b2) дописувати `.worktrees/` у `.gitignore` лише коли worktree-правило увімкнено у `.n-cursor.json` — за аналогією з `gitignoreAdr`, де фрагмент додається лише при `rules.includes('adr')`.

## Considered Options
* Безумовно (b1) — записувати `.worktrees/` при кожному sync незалежно від конфігурації
* Гейт за worktree-правилом (b2) — симетрично до adr-фрагмента

## Decision Outcome
Chosen option: "Безумовно (b1)", because для `adr` гейт коректний — продюсер (ADR Stop-hook) і тумблер (adr-rule) це одна сутність; якщо правило вимкнено, артефактів нема. Для worktree продюсер (`flow init` / `worktree-cli`) є `alwaysApply: true` і незалежний від worktree-rule — гейт за правилом розсинхронізував би ігнорування з реальним продюсером.

### Consequences
* Good, because transcript фіксує очікувану користь: репо, де worktree-rule вимкнено, але `flow init` використовується, не отримає брудний `git status`.
* Bad, because репо, що поставило `@nitra/cursor`, але жодного разу не використало worktree, несе один зайвий ignore-рядок — нешкідливий no-op, але не нульовий side-effect.

## More Information
- Аналіз у `npm/scripts/sync-claude-config.mjs`: `const includeAdrHook = Array.isArray(rules) && rules.includes('adr')` — зразок гейтингу, від якого свідомо відступили.
- `n-flow.mdc` і `n-worktree.mdc` — обидва `alwaysApply: true`; worktree-rule відокремлений тумблер.
- Додаткової інформації про наслідки b2 у transcript не зафіксовано.
