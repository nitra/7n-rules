---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T22:12:14+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR Гарантія `.worktrees/` у `.gitignore` через окремий sync-крок

## Context and Problem Statement
Команда `n-cursor worktree add` створює у корені репо директорію `.worktrees/<sanit>/` та супутні файли (`.flow.json`, `.events.jsonl`, `.flow-lock-*`), які є суто локальними артефактами і не мають потрапляти у git. Утиліта `ensureGitignoreEntries()` та конвенція `syncClaudeConfig` для adr-фрагмента вже існували, але `worktree add` не викликав жодної з них — тому в новому репо ці файли вилазили в `git status` як untracked.

## Considered Options
* Додати виклик у команду `worktree add` (lazy, в момент створення директорії)
* Додати рядок всередину наявної функції `syncClaudeConfig` (поряд з adr-фрагментом)
* Окремий top-level `runSyncStep` у `runSync()` — сусід, але НЕ всередині `syncClaudeConfig` (обраний варіант)
* Гейтити запис за наявністю `worktree`-rule у `.n-cursor.json` (b2, відхилено)

## Decision Outcome
Chosen option: "Окремий top-level `runSyncStep` з функцією `syncGitignoreWorktree(projectRoot)`", because `syncClaudeConfig` має ранній `return` при `claude-config: false`, що відʼєднало б запис від реального продюсера (`flow`/`alwaysApply`); a `worktree add` не покриває репо, де worktree ще не створювали. Нова функція — тонка обгортка над `ensureGitignoreEntries` з одним патерном `.worktrees/` — безумовна (b1), бо продюсер (`flow`, `alwaysApply`) завжди активний, на відміну від опційного `worktree`-rule.

### Consequences
* Good, because transcript фіксує очікувану користь: idempotent append-only запис не шкодить репо, де рядок уже є; нова логіка ізольована у `npm/scripts/lib/sync-gitignore-worktree.mjs` з окремим тест-файлом; 16/16 тестів зелені після реалізації.
* Bad, because `.worktrees/` додається в `.gitignore` навіть у репо, що жодного разу не використовувало worktree — хоча це нешкідливий no-op, transcript визнає це як мінус b1.

## More Information
Змінені файли (коміт `e0f5e52`): `npm/scripts/lib/sync-gitignore-worktree.mjs` (новий модуль), `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (4 тести), `npm/bin/n-cursor.js` (import + `runSyncStep` у `runSync()`), `docs/specs/2026-06-01-worktree-add-gitignore.md`, `docs/plans/2026-06-01-worktree-add-gitignore.md`. Утиліта-основа: `npm/scripts/utils/ensure-gitignore-entries.mjs`.

---

## ADR Прибрати `coverage` gate з `flow verify` (лише `lint`)

## Context and Problem Statement
`flow verify` хардкодив `DEFAULT_GATES = [lint, coverage]` у `npm/scripts/dispatcher/lib/reviewer.mjs`. Gate `coverage` запускав `npx @nitra/cursor coverage`, що включає Stryker (мутаційне тестування, 215 файлів / 28 552 мутантів у прогоні під час сесії) і блокував turnstile на хвилини навіть для тривіальних L1-змін.

## Considered Options
* Прибрати `coverage` gate повністю, лишити лише `lint` (обраний варіант)
* Level/risk-scaled gates: Stryker лише для L≥2 (обговорювалось, але відхилено на користь простішого рішення)
* Конфіг gate-ів через `.n-cursor.json#flow.gates` (обговорювалось як варіант 1)
* `coverage --no-mutation` (новий прапор у CLI, варіант 3, не обраний)
* Stryker `--incremental` (варіант 4, ортогональний, не обраний)

## Decision Outcome
Chosen option: "Прибрати `coverage` gate повністю", because користувач явно заявив «я взагалі не хочу Stryker у flow і coverage також» — coverage і тести лишаються доступними через `npx @nitra/cursor coverage` та CI окремо, але turnstile їх більше не тригерить.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow verify` тепер завершується за секунди (лише `bun run lint`); тести reviewer 27/27 зелені після зміни.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли (коміт `84bf217`): `npm/scripts/dispatcher/lib/reviewer.mjs` (`DEFAULT_GATES` — видалено `coverage` запис, оновлено JSDoc), `npm/scripts/dispatcher/lib/tests/reviewer.test.mjs` (прибрано `coverage`-рядки зі всіх тестових runner-fixtures), `npm/rules/flow/flow.mdc` та `.cursor/rules/n-flow.mdc` (рядок «Проганяє Quality Gates (lint + coverage)» → «Проганяє Quality Gate (lint)»).
