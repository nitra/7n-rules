---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T16:01:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR cspell-fix: заміна whole-file omlx-apply на classify → словник

## Context and Problem Statement
`npm/rules/text/lint/cspell-fix.mjs` використовував підхід detect → group-by-file → `llmLintFix` (модель повертає весь файл цілком як JSON). На реальному репо (292 файли з 1406 знахідками, ~90% яких — валідні укр/тех-слова) це виражалось у `curl exit 28: timeout 120s`, memory-guard reject для великих файлів і нульовому результаті: re-detect після «фіксу» усе одно показував 1406 знахідок і гейт лишався червоним.

## Considered Options
* Whole-file apply через `llmLintFix` (попередня реалізація)
* Classify → `.cspell.json` dict-append: один bounded JSON-виклик на ≤80 distinct-слів, валідні слова → `.cspell.json#words`, typo → список на рев'ю без автозастосування

## Decision Outcome
Chosen option: "Classify → `.cspell.json` dict-append", because емпіричний експеримент (worktree `exp/cspell-fix`, той самий репо) показав: whole-file approach дав 2/2 фейли (timeout/parse-fail, 0 корисних змін), а classify → dict дав +79 валідних слів у `.cspell.json` за 1 bounded omlx-виклик без жодних таймаутів. Крім того, ~90% «Unknown word» — валідні укр/тех-слова, а не одруки, тому реальний ремедіейшн = поповнення словника, не переписування файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль таймаутів (проти 25 whole-file викликів у старій схемі), нуль memory-guard reject, 79/80 слів класифіковано коректно, результат видно в `git diff .cspell.json` як детермінований append.
* Bad, because модель допустила 1 хибну класифікацію зі зразка (`аутейдж→аудит` — outage спотворено в audit); але схема є suggest-only (не apply) — шкідливе слово відхиляється в рев'ю, а не вноситься автоматично.

## More Information
Код: `npm/rules/text/lint/cspell-fix.mjs` — функції `unknownWords`, `appendWordsToDict`, `classifyPrompt`, `runCspellText`. Словник-таргет: `.cspell.json#words`. Cap: `MAX_CLASSIFY_WORDS=80` distinct-слів за прогін; надлишок логується без тихого обрізання. Тести: `npm/rules/text/lint/tests/cspell-fix.test.mjs`. Changeset: `npm/.changes/260615-1315.md` (minor/Changed).

---

## ADR bounded output як архітектурний принцип opportunistic LLM-fix tier

## Context and Problem Statement
Під час реалізації opportunistic LLM-fix tier для lint-правил виявилось два наявні підходи до LLM-кроку: `doc-files` генерує bounded artifact (doc ≤0.8k tok, незалежно від розміру джерела), а `cspell-fix` запитував whole-file rewrite (output = весь файл назад, тобто O(input)). Потрібно було сформулювати принцип, щоб не повторювати проблему на нових інстансах.

## Considered Options
* Довільна форма output (whole-file rewrite дозволений)
* Bounded output як обов'язкова вимога до кожної стратегії

## Decision Outcome
Chosen option: "Bounded output як обов'язкова вимога", because transcript зафіксував пряму причинно-наслідкову залежність: `docgen-gen.mjs` bounded через секційну генерацію (`extractFacts` → секції по 0.5k tok) → 0 таймаутів; `cspell-fix` whole-file → `curl exit 28: timeout 120s` на `docgen-gen.mjs` (6.0k tok вхід). «Стратегія мусить давати bounded output» — сформульовано в сесії як явне правило.

### Consequences
* Good, because transcript фіксує очікувану користь: classify-форма (bounded JSON ≤80 слів) vs apply whole-file — 0 таймаутів проти N таймаутів; `generateDoc` working stably за тим самим принципом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зафіксовано у `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` (розділ «Принцип: bounded output»). Дві валідні outcome-форми: `apply` (bounded artifact, наприклад doc) та `suggest` (bounded JSON-класифікація). Whole-input rewrite заборонено. Інші варіанти в transcript не обговорювалися, але whole-file rewrite показав себе нежиттєздатним емпірично.

---

## ADR спільний `preflightLocalModel` у `npm/lib/llm.mjs`

## Context and Problem Statement
Два lint-правила (`doc-files` і `cspell`) мали дубльований локальний preflight (omlx health-check: memory-guard / down / auth), реалізований кожне у власному `preflightProblem`. При наявності двох реалізацій однієї перевірки будь-яка зміна логіки вимагала б синхронного оновлення обох файлів.

## Considered Options
* Залишити локальні `preflightProblem` у кожному правилі
* Витягти спільну функцію `preflightLocalModel(model)` у `npm/lib/llm.mjs`

## Decision Outcome
Chosen option: "Витягти `preflightLocalModel` у `npm/lib/llm.mjs`", because `lib/llm.mjs` вже містить `omlxHealthCheck` та `pickBackend`; preflight є суто функцією від model-id, не від правила; дублювання коду в двох місцях уже конкретно призвело б до розбіжностей (одна реалізація мала cap `MAX_FIX_FILES=25`, інша — ні).

### Consequences
* Good, because transcript фіксує очікувану користь: один place-of-truth для health-check логіки; обидва правила отримали єдиний knob `N_LOCAL_MIN_MODEL` (рішення D2); тести `134/134 passed` після рефактору.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Код: `npm/lib/llm.mjs` — функція `preflightLocalModel(model): string|null`. Споживачі: `npm/rules/doc-files/js/docgen-files-batch.mjs` (замінено `preflightProblem()` → `preflightLocalModel(DEFAULT_LOCAL_MODEL)`), `npm/rules/text/lint/cspell-fix.mjs` (замінено локальну → `preflightLocalModel(model)`). Changeset: `npm/.changes/260615-1344.md` (patch/Changed).

---

## ADR `meta.json: llmFix:true` як реальний opt-in гейт для LLM-fix кроку

## Context and Problem Statement
`doc-files/meta.json` містив `llmFix:true`, але `orchestrate.mjs` цей прапор не читав: opportunistic-fix запускався просто на `!readOnly`, тобто для **будь-якого** правила без явної opt-in перевірки. Будь-яке нове правило з LLM-кроком отримало б його увімкненим за замовчуванням — safety-тріаж не забезпечувався кодом.

## Considered Options
* Прапор `llmFix:true` у `meta.json` (поведінковий opt-in)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`meta.json: llmFix:true` як єдиний opt-in механізм, що реально читається оркестратором", because рішення D4 (сесія): один прапор, boolean, явно декларує можливість LLM-мутацій для правила; логічні лінтери без `llmFix:true` лишаються detect-only навіть у fix-режимі.

### Consequences
* Good, because transcript фіксує очікувану користь: `orchestrate.mjs` читає `metaById[id]?.llmFix` і передає `{ readOnly, llmFix }` у `lint()`; правило без прапора → detect-only незалежно від `--read-only`; новий тест `«без llmFix → detect-only, генерацію не чіпаємо»` підтверджує гейт (`73/73 passed`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Код: `npm/rules/lint/js/orchestrate.mjs` — читає `meta.llmFix`, передає далі. `npm/rules/doc-files/js/lint.mjs` — `if (readOnly || !llmFix) return detect`. `npm/rules/text/lint/cspell-fix.mjs` — `if (readOnly || !llmFix)` аналогічно. `npm/rules/text/meta.json` — додано `llmFix:true`. `npm/bin/n-cursor.js` case `lint-text` — передає `llmFix:!args.includes('--read-only')`. Changeset: `npm/.changes/260615-1359.md` (minor/Changed).
