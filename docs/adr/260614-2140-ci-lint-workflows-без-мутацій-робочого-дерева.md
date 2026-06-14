---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T21:40:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Напишу ADR-записи безпосередньо на основі аналізу сесії.

## ADR CI lint-workflows без мутацій робочого дерева

## Context and Problem Statement
CI-воркфлоу `lint-text.yml` і `lint-style.yml` запускали lint із прапорами автофіксу (`bun run lint-text` / `stylelint --fix`), що потенційно змінювало файли під час перевірки. Це порушувало принцип «CI не мутує дерево» і суперечило архітектурі, де fix-режим — прерогатива локального запуску.

## Considered Options
* Зберегти мутуючі команди в CI (поточний стан)
* Перейти на read-only-варіанти (`n-cursor lint-text --read-only`, `npx stylelint` без `--fix`)

## Decision Outcome
Chosen option: "read-only-варіанти в CI", because transcript явно вимагає: «CI більше не мутує дерево». `n-cursor` є workspace-symlink → локальне джерело, тому `--read-only` доступний у CI без додаткових залежностей.

### Consequences
* Good, because CI тепер лише детектує порушення — не змінює файли у процесі перевірки; підтверджено `conftest verify`: lint_text 5/5, lint_style_yml 4/4; сьют зелений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `.github/workflows/lint-text.yml` (рядок `run`), `.github/workflows/lint-style.yml` (прибрано `--fix`). Синхронно оновлено канон: snippet-шаблон, `formatting.mjs` (checkText), `lint_text_test.rego`, `lint_style_yml_test.rego`, `n-text.mdc`. Коміти: `0d3eaeac`, `11aa4f92`.

---

## ADR Видалення скіла /n-fix як делегата

## Context and Problem Statement
Скіл `/n-fix` існував як делегат — він не мав власної логіки, а лише перенаправляв до `/n-lint`. Наявність двох скілів з однаковим функціоналом створювала плутанину і захаращувала каталог скілів.

## Considered Options
* Залишити `/n-fix` як alias-делегат
* Повністю видалити `/n-fix` (функціонал у `/n-lint`)

## Decision Outcome
Chosen option: "Повністю видалити `/n-fix`", because transcript підтверджує: скіл «раніше делегат — тепер прибрано зовсім». Скіл був data-driven (`meta.json.auto:"завжди"` + `orchestrator:true`), не хардкод — видалення каталогу автоматично прибирає його з discovery.

### Consequences
* Good, because transcript фіксує очікувану користь: `auto-skills.test.mjs` лишився зеленим після оновлення фікстур (5 тестів виправлено — `'fix'` прибрано з `ALL_SKILLS` і всіх `expect().toEqual([...])`); структура `npm/skills/` стала чистішою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено: `npm/skills/fix/SKILL.md`, `npm/skills/fix/meta.json`, `.cursor/skills/n-fix/SKILL.md`, `.claude/commands/n-fix.md`. Оновлено: `CLAUDE.md` (запис у списку скілів), `npm/scripts/tests/auto-skills.test.mjs` (фікстури). Коміт: `6f49a0c8`.

---

## ADR Переміщення lint-оркестратора у rules/lint/

## Context and Problem Statement
Оркестратор lint-процесу (`scripts/lint-cli.mjs`) жив у `scripts/`, тоді як усі інші одиниці функціоналу пакунку організовані у `rules/<id>/`. Це порушувало структурну консистентність (spec consolidation §7).

## Considered Options
* Залишити `scripts/lint-cli.mjs` без змін
* Перемістити у `npm/rules/lint/js/orchestrate.mjs` і зареєструвати `lint` як правило

## Decision Outcome
Chosen option: "Перемістити у `rules/lint/`", because transcript посилається на «spec consolidation §7» — оркестратор має жити поряд із тим, що він оркеструє.

### Consequences
* Good, because правило `lint` тепер є discovery-visible через той самий механізм, що й усі інші правила; `fix-mjs-contract.test.mjs` оновлено 36→37 (нове правило зараховано); `bin/n-cursor.js` імпортує з `../rules/lint/js/orchestrate.mjs`; no-op `fix.mjs` підтверджує, що `lint` сам по собі не є fixable-rule.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`git mv npm/scripts/lint-cli.mjs npm/rules/lint/js/orchestrate.mjs`; `git mv npm/scripts/tests/lint-cli.test.mjs npm/rules/lint/js/tests/orchestrate.test.mjs`. Створено: `npm/rules/lint/meta.json` (`{"auto":"завжди"}`), `npm/rules/lint/fix.mjs` (no-op). Документ: `npm/scripts/docs/lint-cli.md` → `npm/rules/lint/js/docs/orchestrate.md` (frontmatter перештамповано: `source: rules/lint/js/orchestrate.mjs`). Коміт: `aaae92fd`.

---

## ADR Спільне ядро LLM-фіксу та per-tool omlx-автофікс для cspell

## Context and Problem Statement
`llm-worker.mjs` (конформність-фіксер) містив дублікатну логіку парсингу JSON-відповіді моделі, читання файлів і застосування змін. Водночас detect-only інструменти без нативного `--fix` (cspell, knip, actionlint тощо) не мали жодного механізму автоматичного виправлення знахідок через omlx.

## Considered Options
* Залишити дублікатну логіку в `llm-worker.mjs`; cspell — тільки detect
* Виділити спільне ядро в окремий модуль; підключити omlx-фіксер для cspell у fix-режимі

## Decision Outcome
Chosen option: "Виділити ядро + omlx-фіксер для cspell", because transcript фіксує end-to-end валідацію на живому omlx: `"quik/jumpps/teh → quick/jumps/the"`. cspell обраний першим тулом через низький ризик (локалізовані знахідки-одруки). knip/jscpd/trufflehog свідомо залишено detect-only (knip: dynamic-usage хибнопозитиви; jscpd: великий рефактор; trufflehog: рішення людини).

### Consequences
* Good, because transcript фіксує очікувану користь: дублікатний код прибрано (llm-worker рефакторено на `llm-fix-apply`); cspell у fix-режимі виправляє одруки без ручного втручання; `groupFindingsByFile` експортовано для тестованості; 52 тести зелені.
* Bad, because `process.env.N_CURSOR_FIX_MODEL` у першій версії `llm-lint-fix.mjs` порушило правило js-run (пряме звернення замість `env` з `node:process`) — довелось виправляти перед комітом.

## More Information
Створено: `npm/scripts/lib/fix/llm-fix-apply.mjs` (parseChangesResponse, readFilesForFix, applyChanges), `npm/scripts/lib/fix/llm-lint-fix.mjs` (llmLintFix — generic), `npm/rules/text/lint/cspell-fix.mjs` (groupFindingsByFile + runCspellText). Тести: `npm/scripts/lib/fix/tests/llm-fix-apply.test.mjs`, `npm/rules/text/lint/tests/cspell-fix.test.mjs`. Модель: `N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`. Коміт: `b5d9347b`.

---

## ADR Інлайн внутрішніх subcommand'ів _fix-check і fix-t0 як прямих функцій

## Context and Problem Statement
Фази движка конформності (`_fix-check`, `fix-t0`) були реалізовані як внутрішні CLI-підкоманди: orchestrator, t0, post-tool-use-hook і lint-orchestrate викликали їх через `spawnSync('bun', [N_CURSOR_BIN, '_fix-check', ...])` / `spawnSync('bun', [N_CURSOR_BIN, 'fix-t0', ...])`. Це додавало subprocess round-trips для суто внутрішніх операцій.

## Considered Options
* Залишити `_fix-check`/`fix-t0` як внутрішні підкоманди bin
* Винести у прямі функції (`runFixCheck`, `listProjectRulesMdcFiles`) і видалити subcommand-cases з bin

## Decision Outcome
Chosen option: "Прямі функції без subcommand-обгорток", because тести вже мокали `spawnSync` (не тестували реальні subcommand'и), а subprocess round-trip — зайвий overhead для внутрішніх фаз.

### Consequences
* Good, because transcript фіксує очікувану користь: з `bin/n-cursor.js` видалено ~113 рядків (`resolveFixRuleIds`, `runRuleFixProcesses`, `runFixCommand`, локальний `listProjectRulesMdcFiles`, cases `_fix-check`/`fix-t0`); видалено невживані імпорти (`discoverCheckRulesFromCursorRules`, `listRuleIds`, `formatTimingSummary`, `ensureHkInstall/ensureTool`); сьют залишився зеленим.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створено: `npm/scripts/lib/fix/run-fix-check.mjs` (runFixCheck), `npm/scripts/lib/list-project-rules-mdc.mjs` (listProjectRulesMdcFiles). Оновлено: `npm/scripts/lib/fix/orchestrator.mjs`, `npm/scripts/lib/fix/t0.mjs`, `npm/rules/lint/js/orchestrate.mjs`, `npm/scripts/post-tool-use-fix.mjs`, `npm/scripts/tests/post-tool-use-fix.test.mjs`. Коміт: `e79040fe`.
