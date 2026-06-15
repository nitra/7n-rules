---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T15:56:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR cspell-fix: заміна whole-file omlx-rewrite на classify → .cspell.json

## Context and Problem Statement
Наявна реалізація `cspell-fix.mjs` передавала весь вміст файлу в `llmLintFix` (модель мала повернути файл переписаним як JSON). На реальних файлах це спричиняло timeout 120 с (`curl exit 28`) і parse-fail, а 90 % «Unknown word» знахідок на цьому репо — валідні укр./тех-слова, а не одруки. Емпіричний вимір: 1406 знахідок у 292 файлах, жоден із топ-25 токенів не є одруком.

## Considered Options
* (a) whole-file rewrite через `llmLintFix` (стара схема)
* (b) bounded classify-промпт → валідні слова авто-дописуємо до `.cspell.json`; одруки — список на рев'ю
* (c) detect-only, нуль LLM

## Decision Outcome
Chosen option: "(b) classify → .cspell.json", because експеримент довів: (a) дає timeout/parse-fail на реальних файлах, реальна природа знахідок — словникові кандидати, а не одруки (≈90 %), тому (b) закриває їх детерміновано й безпечно, не мутуючи вихідний код.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль timeout/guard/parse-fail; +79 валідних слів у `.cspell.json` за один прогін (кожне знайдено один раз через `new Set()` незалежно від к-сті файлів); 4/4 тести зелені, eslint чисто.
* Bad, because одруки (typo) не виправляються автоматично — лише список на рев'ю; під час класифікації виявлено 1 хибний typo-виклик (`аутейдж → аудит` = outage→audit), що підтверджує правильність утримання від авто-апплаю.

## More Information
* Змінений файл: `npm/rules/text/lint/cspell-fix.mjs` — нові export: `unknownWords()`, `appendWordsToDict()`, `classifyPrompt()`, `runCspellText()`.
* Старий export `groupFindingsByFile` видалено (юзався тільки тестом).
* Тест: `npm/rules/text/lint/tests/cspell-fix.test.mjs`.
* Changeset: `npm/.changes/260615-1315.md` (bump: minor, section: Changed).
* Distinct-словарний cap: `MAX_CLASSIFY_WORDS = 80` — надлишок логується, не відкидається тихо.

---

## ADR Принцип «bounded output» для LLM-стратегій lint-правил

## Context and Problem Statement
Експеримент порівняння (a)/(b)/(c) для cspell виявив архітектурну першопричину провалу whole-file підходу: час генерації авторегресивної LLM визначається **к-стю output-токенів**. Whole-file rewrite масштабується разом із розміром файлу → таймаут на `docgen-gen.mjs` (6k tok, 120 с). `doc-files`-стратегія не падала саме тому, що `generateDoc` генерує bounded артефакт (~0.5–0.8k tok), а не повертає джерело.

## Considered Options
* Whole-file rewrite (unbounded output) — наявна cspell-схема
* Bounded output strategy — кожна стратегія повертає artifact або suggestions, що не залежать від розміру входу

## Decision Outcome
Chosen option: "bounded output strategy", because вимір показав: whole-file rewrite на `docgen-gen.mjs` (6k input) = 120 с timeout; bounded classify-промпт = ~1 с.

### Consequences
* Good, because transcript фіксує очікувану користь: doc-files (bounded артефакт) — без таймаутів навіть на великих файлах; cspell (bounded JSON) — 1 виклик замість 25 whole-file.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
* Принцип закріплено в `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` (секція «Принцип: bounded output»).
* Дві легальні форми: `apply` (bounded artifact, напр. `generateDoc` для doc-files) і `suggest` (bounded JSON, напр. classify для cspell).
* Заборонений анти-патерн: `apply через перепис усього входу`.

---

## ADR Єдиний knob N_LOCAL_MIN_MODEL для opportunistic LLM-fix tier

## Context and Problem Statement
До уніфікації cspell-fix використовував `N_CURSOR_FIX_MODEL`, а doc-files — `N_LOCAL_MIN_MODEL`. Два різних knob'и — пляма конфігурації для одного й того самого концептуального ресурсу (локальна LLM для fix tier).

## Considered Options
* Залишити `N_CURSOR_FIX_MODEL` і `N_LOCAL_MIN_MODEL` як окремі knob'и
* Звести до `N_LOCAL_MIN_MODEL` як єдиного knob'а

## Decision Outcome
Chosen option: "`N_LOCAL_MIN_MODEL`", because рішення D2 сесії: cspell-фікс легший за прозу doc-files, але обидва — fix tier однієї ваги; один knob спрощує конфіг і виключає конфліктні стани.

### Consequences
* Good, because transcript фіксує очікувану користь: `cspell-fix.mjs:30` — `fixModel() = process.env.N_LOCAL_MIN_MODEL`, `docgen-files-batch.mjs` — `DEFAULT_LOCAL_MODEL` з того самого env; конфіг однорядний.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
* Env у `~/.zshenv`: `N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`.
* `N_CURSOR_FIX_MODEL` залишився в середовищі порожнім (перевірено під час сесії: `N_CURSOR_FIX_MODEL=`).

---

## ADR Спільний preflightLocalModel у npm/lib/llm.mjs

## Context and Problem Statement
`docgen-files-batch.mjs` і `cspell-fix.mjs` мали дубльовані локальні функції `preflightProblem()` з однаковою логікою: omlx health-check (memory-guard / down / auth). При зміні в одному місці інше легко забути.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "винести `preflightLocalModel(model)` у `npm/lib/llm.mjs`", because це очевидна де-дуплікація — обидві функції є verbatim copies однієї логіки поверх `omlxHealthCheck` + `pickBackend`, які вже живуть у `lib/llm.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: 134/134 тести зелені після рефакторингу; eslint чисто; обидва call-site зводяться до `preflightLocalModel(model)`.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
* Функція додана до `npm/lib/llm.mjs` після `omlxHealthCheck`.
* Changeset: `npm/.changes/260615-1344.md` (bump: patch, section: Changed).
* Тест mock оновлено в `npm/rules/doc-files/js/tests/docgen-files-batch.test.mjs`: `healthMock` (`omlxHealthCheck`) → `preflightLocalMock` (`preflightLocalModel`), бо зовнішній mock експорту не перехоплює внутрішній виклик у `lib/llm.mjs`.

---

## ADR opt-in llmFix:true у meta.json задротовано в orchestrate

## Context and Problem Statement
`meta.json: llmFix:true` для doc-files існував як декоративний прапор: `runLint` в `orchestrate.mjs` передавав `{ readOnly }` в `lint()` без читання `llmFix`. Opportunistic-fix активувався просто на `!readOnly` — тобто safety-тріаж (лише явно opt-in правила отримують LLM-fix) не забезпечувався кодом.

## Considered Options
* `llmFix: "apply"|"suggest"` (enum з під-типом форми)
* `llmFix: true` (boolean, стратегія сама знає форму)

## Decision Outcome
Chosen option: "`llmFix: true` (boolean)", because рішення D4 сесії — форма (apply vs suggest) належить стратегії, а прапор лише дозволяє/забороняє LLM-крок; enum ускладнив би meta без користі.

### Consequences
* Good, because transcript фіксує очікувану користь: `runLint` тепер читає `metaById[id]?.llmFix`, передає `{ readOnly, llmFix }` у `lint()`; правило без `llmFix:true` → detect-only незалежно від `--read-only`. `text/meta.json` отримав `llmFix:true`. Новий тест «без llmFix → detect-only» — зелений.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
* Zmini: `npm/rules/lint/js/orchestrate.mjs` (читає `meta.llmFix`), `npm/rules/doc-files/js/lint.mjs` (гейт `if (readOnly || !llmFix) return detect`), `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/cspell-fix.mjs` (гейт на `llmFix`), `npm/rules/text/meta.json`.
* Changeset: `npm/.changes/260615-1359.md` (bump: minor, section: Changed).
* Попутньо: pre-existing `no-unsanitized/method` помилка на main (рядок 118 orchestrate, `await import(lintPath)`) закрита justified disable-коментарем (`lintPath` — суто package-internal path).
