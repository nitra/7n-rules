---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T21:56:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

Аналізую транскрипт і формую ADR-документацію.

---

## ADR Гарантія `.worktrees/` у `.gitignore` через окремий sync-крок

## Context and Problem Statement
`n-cursor worktree add` створює в корені репо каталог `.worktrees/<sanit>/` і sibling-файли (`.flow.json`, `.events.jsonl`, `.md`), але жодним кодом не дописував `.worktrees/` у `.gitignore`. У нових/чужих репо ці локальні артефакти потрапляли в `git status` як untracked і могли бути випадково закомічені.

## Considered Options
* Дописати `.worktrees/` у `.gitignore` в команді `worktree add` (lazy, в момент створення каталогу)
* Дописати `.worktrees/` у `.gitignore` всередині наявної функції `syncClaudeConfig` поряд з adr-фрагментом
* **Новий безумовний top-level крок у `runSync()`** — окремий `runSyncStep`, що кличе `syncGitignoreWorktree(projectRoot)` поверх наявного `ensureGitignoreEntries`

## Decision Outcome
Chosen option: "Новий безумовний top-level крок у `runSync()`", because `worktree add` і `flow init` — продюсери `.worktrees/` — активні завжди (`n-flow.mdc: alwaysApply: true`), тому гейтити ignore-рядок за будь-яким тумблером правил або за опт-аутом `claude-config: false` означало б залишити ту саму дірку; окремий крок тримає концерни розділеними й дозволяє безумовне (b1) додавання з єдиним репортом.

### Consequences
* Good, because transcript фіксує очікувану користь: idempotent append-only `ensureGitignoreEntries` — no-op, якщо рядок уже є; нові/чужі репо отримують `.worktrees/` у `.gitignore` автоматично після першого `npx @nitra/cursor`.
* Good, because `syncClaudeConfig` лишається чесним за назвою (тільки Claude/Cursor-конфіг), а новий `syncGitignoreWorktree` — самодостатній, ізольований концерн з власним тест-файлом.
* Bad, because transcript не містить підтверджених негативних наслідків; Stryker у `flow verify` завис під час прогону через відсутній `node_modules` у worktree та неправильний PATH, що косвено спровокувало засмічення `main` (але це наслідок середовища verify, а не рішення про gitignore).

## More Information
- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` (обгортка над `ensureGitignoreEntries`)
- Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` — 4 кейси: порожнє репо → `written: true`; idempotency; append-only зі збереженням кастомного вмісту
- Підключення: `npm/bin/n-cursor.js`, `runSync()` — `runSyncStep('❌ … .gitignore (worktree): ', () => syncGitignoreWorktree(cwd()))`
- Коміт із реалізацією: `e0f5e52` на гілці `feat-worktree-gitignore`
- Варіант "всередині `syncClaudeConfig`" відхилено: ця функція має ранній `return` при `claude-config: false`, що відʼєднало б ignore-рядок від завжди-активного flow-продюсера; плюс порушило б семантику її назви

---

## ADR Вибір підходу до видалення Stryker-мутацій із `flow verify` для малих задач

## Context and Problem Statement
`flow verify` завжди виконує два gate-и: `lint` і `coverage` (`npx @nitra/cursor coverage`), де `coverage` запускає Stryker на повному репо (215 файлів, 28 552 мутанти без incremental-базлайну) — це суттєво уповільнює verify навіть для тривіальних L1-задач і заблокувало поточний flow.

## Considered Options
* Gate-и керовані через `.n-cursor.json` (`"flow": { "gates": ["lint"] }`)
* **Level/risk-scaled gates** — `coverage` (Stryker) лише для L≥2 або risk≥med; для L0/L1 — лише `lint` (+ опц. tests)
* Tests-only режим coverage (`--no-mutation` прапор у `n-cursor coverage`)
* Stryker `--incremental` (ортогонально — залишити мутації, але лише на змінених файлах)

## Decision Outcome
Chosen option: "Level/risk-scaled gates", because це узгоджується з наявною level-машинерією flow (L0–L3, risk low/med/high), усуває ручні тумблери — тривіальні задачі (L1) автоматично без Stryker, архітектурні (L≥2) з ним — і поєднується з `--incremental` для швидкості на великих рівнях.

### Consequences
* Good, because transcript фіксує очікувану користь: L1-задачі (як поточна) проходять verify за секунди без Stryker; мутаційна гарантія зберігається для задач, де вона цінна.
* Bad, because потребує правки `verify()`/`reviewer.mjs` — більше логіки, ніж варіант 1 (конфіг-файл); рішення зафіксоване в кінці transcript як обраний підхід, але реалізація ще не розпочата.

## More Information
- `DEFAULT_GATES` визначено в `npm/scripts/dispatcher/lib/reviewer.mjs:14` — `[{ name: 'lint', cmd: [...] }, { name: 'coverage', cmd: [...] }]`
- `verify()` у `npm/scripts/dispatcher/lib/commands.mjs` не передає кастомні gate-и в `runReview` попри те, що параметр `gates` там уже є
- Стан на момент закінчення transcript: реалізація level-scaled gates — наступна flow-задача після відновлення репо (засмічення `main` через Stryker-тести, що виконують реальні git-операції)
- Додаткової інформації про терміни або конкретний API level-гейтингу в transcript не зафіксовано
