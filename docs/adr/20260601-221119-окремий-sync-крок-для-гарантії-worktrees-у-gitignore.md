---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T22:11:19+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR Окремий sync-крок для гарантії `.worktrees/` у `.gitignore`

## Context and Problem Statement
`worktree add` CLI і `syncClaudeConfig` не забезпечували наявність `.worktrees/` у `.gitignore` автоматично. У новому або чужому репо `flow`/`worktree add` могли створити каталог `.worktrees/`, який потрапляв у `git status` як untracked — аж до першого ручного редагування `.gitignore`.

## Considered Options
* Додавати рядок у `worktree add` CLI (команда `cmdAdd` у `worktree-cli.mjs`)
* Вмонтувати виклик `ensureGitignoreEntries` всередину `syncClaudeConfig` (поряд із `syncGitignoreAdrFragment`)
* Окремий top-level `runSyncStep` у `runSync()` (`n-cursor.js`), сусід виклику `syncClaudeConfig`

## Decision Outcome
Chosen option: "Окремий top-level sync-крок у `runSync()`", because:
- `syncClaudeConfig` описує лише Claude/Cursor-конфіг і має ранній return при `claude-config: false`; вмонтування туди зв'язало б `.worktrees/`-гарантію з опт-аутом, не пов'язаним із flow;
- `worktree add` CLI — lazy-підхід, покриває лише ті репо, де хтось вже викликав CLI; не захищає від первого ж `flow init`;
- окремий крок відповідає наявній конвенції (поряд стоїть `syncGitignoreAdrFragment` як сусідній крок).

Реалізація: новий модуль `npm/scripts/lib/sync-gitignore-worktree.mjs` поверх `ensureGitignoreEntries`; підключений як окремий `runSyncStep` у `n-cursor.js`; звітує `'.gitignore (worktree)'` так само, як `'.gitignore (adr fragment)'`.

### Consequences
* Good, because transcript фіксує очікувану користь: один виклик `ensureGitignoreEntries` — idempotent, append-only; якщо рядок вже є — no-op; у нових репо рядок зʼявляється при першому `npx @nitra/cursor`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/scripts/lib/sync-gitignore-worktree.mjs` (новий), `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (новий, 4 тести), `npm/bin/n-cursor.js` (import + `runSyncStep`). Коміт `e0f5e52`.

---

## ADR Безумовне додавання `.worktrees/` у `.gitignore` (без гейту за правилом)

## Context and Problem Statement
Аналогічна конвенція з `adr`-правилом гейтує `syncGitignoreAdrFragment` умовою `rules.includes('adr')`. Постало питання: чи слід так само гейтувати `.worktrees/` за `rules.includes('worktree')` (варіант b2) чи додавати безумовно (варіант b1).

## Considered Options
* b1 — безумовно (без гейту)
* b2 — гейт за наявністю worktree-rule у `.n-cursor.json` (симетрично до `adr`)

## Decision Outcome
Chosen option: "b1 — безумовно", because продюсер `.worktrees/` — це `flow` (`n-flow.mdc` має `alwaysApply: true`) і `worktree-cli`, які активні незалежно від будь-яких rule-тумблерів. Гейт b2 міг розсинхронізувати продюсера і ignore-рядок: вимкнення worktree-rule → рядок зникає, але `flow init` далі створює `.worktrees/` → повертається саме та dirty-status проблема, яку усуваємо. Для `adr` гейт коректний, бо продюсер (Stop-hook) і гейт — одна сутність; для `flow`/worktree-CLI — ні.

### Consequences
* Good, because transcript фіксує очікувану користь: логіка простіша (нема гілки), `.worktrees/` гарантовано ігнорується у будь-якому репо де встановлено `@nitra/cursor`, незалежно від конфігу правил.
* Bad, because репо, що поставило `@nitra/cursor` але ніколи не використовує worktree, отримує зайвий рядок у `.gitignore` — нешкідливий no-op.

## More Information
Обговорення в transcript: секції «b1 — безумовно» і «Чому adr ≠ worktree». Реалізація: `syncGitignoreWorktree` у `npm/scripts/lib/sync-gitignore-worktree.mjs`; виклик без умови у `runSync()`.

---

## ADR Прибрати `coverage` gate з `flow verify` (лишити тільки `lint`)

## Context and Problem Statement
`flow verify` ганяє два gate-и (`lint` + `coverage`) хардкодом у `DEFAULT_GATES` (`npm/scripts/dispatcher/lib/reviewer.mjs`). Gate `coverage` запускає `npx @nitra/cursor coverage`, який запускає Stryker (215 файлів, 28 552 мутанти при повному прогоні) — це суттєво затягує кожен `flow verify`, включаючи тривіальні L0/L1 задачі.

## Considered Options
* Level/risk-scaled gates (варіант 2): coverage gate лише для L≥2
* Gate через `.n-cursor.json` конфіг (варіант 1)
* `coverage --no-mutation` режим (варіант 3)
* Stryker `--incremental` (варіант 4, ортогонально)
* Повне видалення `coverage` з `DEFAULT_GATES`

## Decision Outcome
Chosen option: "Повне видалення `coverage` з `DEFAULT_GATES`", because користувач explicit вирішив, що Stryker і coverage взагалі не повинні входити у turnstile. Тести/мутації лишаються доступними окремо (`npx @nitra/cursor coverage`) і в CI, але `flow verify` більше їх не тригерить.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow verify` проходить за секунди (лише `lint`); усунено головну причину падіння verify через середовищні проблеми Stryker у git-worktree.
* Bad, because мутаційна перевірка більше не є частиною turnstile — вона покладається виключно на CI і ручний запуск `coverage`.

## More Information
Змінені файли: `npm/scripts/dispatcher/lib/reviewer.mjs` (`DEFAULT_GATES` → лише `lint`; JSDoc оновлено), `npm/scripts/dispatcher/lib/tests/reviewer.test.mjs` (прибрано `coverage`-кейси), `npm/rules/flow/flow.mdc` (рядок 81: «lint + coverage» → «lint»), `.cursor/rules/n-flow.mdc` (синхронізована копія). Коміт `84bf217`.
