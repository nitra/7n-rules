---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-16T09:06:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR cspell-fix: заміна whole-file omlx-апплай на classify→словник

## Context and Problem Statement
`cspell-fix.mjs` мав режим фіксу через `llmLintFix` — модель отримувала весь файл і повертала виправлений вміст як JSON. На реальних файлах репо (~90% «Unknown word» — валідні українські/технічні слова, не одруки) це призводило до систематичних timeout (120 с / `curl exit 28`) і parse-fail; корисних виправлень — нуль.

## Considered Options
* **Whole-file omlx-apply** (`llmLintFix`): модель отримує весь файл → переписує → diff; поточна реалізація.
* **Classify→dict-suggest**: модель отримує список distinct-слів (≤80), повертає `[{w, verdict, fix}]`; `valid` → авто-дописується в `.cspell.json#words`; `typo` → список на рев'ю, не застосовується.
* **Detect-only (baseline)**: лише підрахунок знахідок, нуль автоматизації.

## Decision Outcome
Chosen option: "Classify→dict-suggest", because вимір на реальному репо (3 семпл-файлі, ~55 distinct слів) показав: whole-file apply → 2/2 провалів (timeout/parse-fail); classify → 1 bounded omlx-виклик, 79/80 коректних класифікацій, +79 слів у `.cspell.json` без жодного timeout. Підхід безпечний (лише append до словника, код не мутується).

### Consequences
* Good, because transcript фіксує очікувану користь: нуль timeout/parse-fail; детермінований прогрес (diff `.cspell.json` видно в `git diff`); одне слово класифікується один раз незалежно від кількості файлів, де воно зустрічається.
* Bad, because класифікатор може дати хибний verdict (на семплі 1 з 19: `аутейдж` → valid замість typo); тому typo-пропозиції йдуть лише на рев'ю, не застосовуються автоматично.

## More Information
Реалізація: `npm/rules/text/lint/cspell-fix.mjs` — `unknownWords()`, `appendWordsToDict()`, `classifyPrompt()`, `runCspellText()`. Словник-ціль: `.cspell.json#words` (sorted, dedup через `Set`). Cap: `MAX_CLASSIFY_WORDS = 80` distinct-слів за прогін; надлишок логується (не обрізається тихо). Changeset: `npm/.changes/260615-1315.md`.

---

## ADR Принцип bounded output для opportunistic LLM-fix стратегій

## Context and Problem Statement
Проєктування уніфікованої абстракції «opportunistic LLM-fix tier» виявило принципову відмінність між стратегіями: doc-files не падає на timeout (output = обмежений doc), а cspell падає (output = весь файл-вхід). Потрібно сформулювати загальне правило, якому мусить відповідати кожна стратегія.

## Considered Options
* **Bounded output**: кожна стратегія повертає artifact, розмір якого не залежить від розміру вхідного файлу.
* **Whole-input rewrite**: модель повертає весь вхідний файл із правками (поточна cspell-реалізація).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Bounded output", because вимір підтвердив: `docgen-gen.mjs` (6k вхідних токенів) генерує ~0.6k output (doc по секціях) — без timeout; cspell whole-file apply на тому ж файлі → 120 с timeout (`curl exit 28`). Latency моделі залежить від OUTPUT-токенів, не input. «apply через перепис усього входу» є архітектурно забороненим патерном.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність timeout навіть на великих файлах; дві валідні форми (apply=bounded artifact, suggest=bounded JSON) покривають поточні потреби doc-files і cspell.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Задокументовано в `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` (розділ «Принцип: bounded output»). Форми: `apply` — doc-files (`generateDoc` → обмежений doc); `suggest` — cspell (JSON-масив вердиктів). Per-target loop/circuit-breaker лишається у doc-files (single-call у cspell, як показав експеримент).

---

## ADR `llmFix:true` у `meta.json` як реальний opt-in гейт (не декоративний прапор)

## Context and Problem Statement
Поле `meta.json: llmFix:true` існувало як задекларований opt-in для opportunistic LLM-fix, але `orchestrate.mjs` (`runLint`) його не читав — opportunistic-fix запускався просто на `!readOnly`. Нове правило з LLM-кроком отримувало б його ввімкненим автоматично, без явного дозволу.

## Considered Options
* **Реально дротувати `llmFix`**: `orchestrate.mjs` читає `metaById[id]?.llmFix`, передає в `lint(files, cwd, { readOnly, llmFix })`; правило без прапора → detect-only.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Реально дротувати `llmFix`", because це єдиний спосіб забезпечити safety-тріаж: лише правила з явним `llmFix:true` отримують fix/suggest-сходинку; решта — детект без мутацій незалежно від `readOnly`.

### Consequences
* Good, because transcript фіксує очікувану користь: нові lint-правила безпечні за замовчуванням; `text` і `doc-files` — єдині поточні `llmFix`-capable правила (явно в `meta.json`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/lint/js/orchestrate.mjs`, `npm/rules/doc-files/js/lint.mjs`, `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/text/meta.json`. Bin `lint-text` передає `llmFix:true` (standalone завжди llmFix-capable). Попутно закрито pre-existing `no-unsanitized/method` помилку ESLint у `orchestrate.mjs` (dynamic `import(lintPath)` — package-internal шлях, нуль зовнішнього входу; justified disable-коментар). Changeset: `npm/.changes/260615-1359.md`.

---

## ADR Спільний `preflightLocalModel` у `npm/lib/llm.mjs`

## Context and Problem Statement
Дві незалежні реалізації preflight-перевірки локального omlx-бекенду: `preflightProblem()` у `docgen-files-batch.mjs` і локальна `preflightProblem(model)` у `cspell-fix.mjs`. Обидві виконують той самий omlx health-check (memory-guard / down / auth) — дублювання логіки.

## Considered Options
* **Спільна функція `preflightLocalModel(model)` у `npm/lib/llm.mjs`**: правила імпортують єдину функцію.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Спільна функція `preflightLocalModel(model)` у `npm/lib/llm.mjs`", because оскільки обидва правила вже імпортують `callLlm`/`omlxHealthCheck` з `lib/llm.mjs`, логічно тримати всю omlx-інфраструктуру там; дублювання усувається без зміни публічного контракту.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка зміни omlx health-check (коди помилок, memory-guard поріг); doc-files і cspell ділять спільну цеглину opportunistic LLM-fix tier.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/lib/llm.mjs` (нова export `preflightLocalModel`), `npm/rules/doc-files/js/docgen-files-batch.mjs` (видалено локальний `preflightProblem`, import змінено), `npm/rules/text/lint/cspell-fix.mjs` (аналогічно). Тест-моки оновлено: `vi.mock('../../../../lib/llm.mjs', { preflightLocalModel: () => null })` замість `omlxHealthCheck`. Changeset: `npm/.changes/260615-1344.md`.

---

## ADR Перенесення worktree-lifecycle з `@nitra/cursor` у `@7n/mt`

## Context and Problem Statement
`n-cursor worktree` (`npm/scripts/worktree-cli.mjs`) є єдиним власником lifecycle-команд git-worktree (create/list/remove/prune). `@7n/mt` (Rust, `mono`-монорепо) будує task-graph на файловій системі й потребує тих самих механізмів: discovery worktree вже є в `lib.rs`, але lifecycle — ні. Тримати lifecycle у `@nitra/cursor` (загальний тул) і дублювати або делегувати у двох місцях небажано.

## Considered Options
* **Перенести повний lifecycle у `@7n/mt`** (Rust + npm-wrapper `@7n/mt`); `@nitra/cursor` залежить від `@7n/mt`; скіли курсора кличуть `mt` напряму.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести повний lifecycle у `@7n/mt`", because `@7n/mt` уже публікується з платформними бінарниками (`@7n/mt-{darwin-arm64,linux-x64}`), має `discover_worktrees`/`sanitize_branch` у Rust, і `@7n/mt` є рантайм-пакетом (без зворотної залежності від `@nitra/cursor`) — цикл залежностей відсутній.

### Consequences
* Good, because transcript фіксує очікувану користь: lifecycle і discovery worktree в одному місці; `@nitra/cursor` стає тоншим (видалити `worktree-cli.mjs`/`lib/worktree.mjs`/`skills/worktree/`); `mt worktree` доступний у всіх репо, де є `@7n/mt`.
* Bad, because `@nitra/cursor` (загальний тул) набуває залежності від `@7n/mt` (специфічний пакет екосистеми) — кожен консумер cursor муситиме мати `@7n/mt` у своєму `bun install`.

## More Information
Рішення по layout: checkout `.worktrees/<sanit>/` лишається; інвентар → `.worktrees/.meta/<sanit>.md` (відокремлення checkout-каталогів від metadata; discovery тривіальне — кожен підкаталог крім `.meta` = worktree). Іменування команд: `create|list|remove|prune` + `inventory` (JSON для task-graph); зворотня сумісність з `add` не потрібна. Sequencing: спершу publish `@7n/mt` з worktree-lifecycle, потім міграція `@nitra/cursor` на опубліковану версію. `skills/worktree/` у cursor — прибрати зовсім. Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. mt уже містить частковий `lib/commands/worktree.mjs` (JS, `add|remove|list`) — порт до Rust і доповнення `prune`/`inventory`/`.meta`-layout є кроком 1.
