---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-16T16:41:16+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

я хочу зробити з mt publish, не починай 2 поки я не скажу
[assistant]
Зрозумів — чекаю. Як опублікуєш `@7n/mt@0.5.0`, скажи — тоді розпочну крок 2.

---
END OF TRANSCRIPT

## ADR cspell-fix: заміна whole-file rewrite на класифікацію з поповненням словника

## Context and Problem Statement
Наявна реалізація `cspell-fix` у `npm/rules/text/lint/cspell-fix.mjs` використовувала підхід whole-file `llmLintFix`: модель отримувала цілий файл як JSON і мала повернути виправлений файл. На практиці це призводило до масових таймаутів (`curl exit 28: timeout 120s`), memory-guard reject (CHANGELOG.md потребував ~18 GB), помилок парсингу відповіді, та capped на 25 із 293 файлів, залишаючи гейт червоним.

## Considered Options
* Whole-file omlx-апплай (`llmLintFix`) — попередній підхід
* Classify-and-dict: classify невідомих слів → valid додаються в `.cspell.json`, typo — лише на рев'ю без авто-застосування

## Decision Outcome
Chosen option: "Classify-and-dict", because підхід bounded output усуває операційний провал: один виклик LLM на ≤80 distinct-слів (з `new Set()` по всьому виводу cspell), нуль таймаутів і guard-помилок, детермінований прогрес (sorted diff у `.cspell.json`), і відсутність мутацій вихідного коду.

### Consequences
* Good, because transcript фіксує очікувану користь: 79/80 класифікацій коректні, +79 валідних слів у словник за один прогін, 0 таймаутів/guard/parse-fail (порівняно з ~25 у старій схемі), виправлення видно у `git diff`.
* Bad, because transcript не містить підтверджених негативних наслідків; 1 хибний typo-виклик (`stry→try`) проскочив як valid, але він — лише пропозиція, не застосовано автоматично.

## More Information
Файл: `npm/rules/text/lint/cspell-fix.mjs`. Константа `MAX_CLASSIFY_WORDS = 80`. Дедуплікація через `new Set()` у `unknownWords()`. Changeset: `npm/.changes/260615-1315.md`. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Живий замір на цьому репо: 1406 знахідок cspell, нова схема — 80/788 distinct-слів за прогін.

## ADR preflightLocalModel: спільне ядро preflight у lib/llm.mjs

## Context and Problem Statement
Дублювання `preflightProblem` у двох правилах: `npm/rules/doc-files/js/docgen-files-batch.mjs` і `npm/rules/text/lint/cspell-fix.mjs` — ідентична логіка omlx health-check (memory-guard / down / auth) без спільного ядра.

## Considered Options
* Залишити локальні `preflightProblem` у кожному правилі
* Винести спільний `preflightLocalModel(model)` у `npm/lib/llm.mjs`

## Decision Outcome
Chosen option: "Винести спільний `preflightLocalModel(model)` у `npm/lib/llm.mjs`", because це усуває дублювання й дає єдину точку для opportunistic LLM-fix tier preflight (рішення D1 зі спеки `2026-06-15-opportunistic-llm-fix-tier.md`).

### Consequences
* Good, because transcript фіксує очікувану користь: обидва правила тепер кличуть один хелпер; тести оновлено (mock `preflightLocalModel: () => null` у `docgen-files-batch.test.mjs`), 134/134 passed.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція: `preflightLocalModel(model)` у `npm/lib/llm.mjs`. Видалено: `preflightProblem()` із `docgen-files-batch.mjs` і `cspell-fix.mjs`. Changeset: `npm/.changes/260615-1344.md`.

## ADR llmFix opt-in: meta.json llmFix:true як реальний safety-тріаж

## Context and Problem Statement
Поле `meta.json: llmFix:true` було задекларовано у спеці як єдиний opt-in для opportunistic LLM-fix, але `runLint` (`npm/rules/lint/js/orchestrate.mjs`) його не читав — fix-сходинка запускалась просто на умові `!readOnly`. Нове правило з LLM-кроком отримало б його увімкненим без явного opt-in, що порушувало safety-тріаж.

## Considered Options
* Лишити прапор декоративним (fix на `!readOnly`)
* Провести `llmFix` через orchestrate → кожне правило → cspell-classify

## Decision Outcome
Chosen option: "Провести `llmFix` через orchestrate", because прапор `meta.json: llmFix:true` тепер є реальним gate: правила без нього отримують detect-only навіть в `--fix`-режимі.

### Consequences
* Good, because transcript фіксує очікувану користь: `text/meta.json` отримав `llmFix:true`; `doc-files` мав його раніше; тести додані (73/73 passed); pre-existing `no-unsanitized/method` на HEAD закрито justified disable-коментарем.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Проводка: `orchestrate.mjs` (`metaById[id]?.llmFix`), `doc-files/js/lint.mjs`, `text/js/lint.mjs`, `text/lint/lint.mjs`, `text/lint/cspell-fix.mjs`, `bin/n-cursor.js` (lint-text → `llmFix:true`). Changeset: `npm/.changes/260615-1359.md`.

## ADR перенесення worktree-lifecycle до @7n/mt

## Context and Problem Statement
worktree-керування (`n-cursor worktree add|remove|list|prune`) жило в `@nitra/cursor` (`npm/scripts/worktree-cli.mjs`), хоча `@7n/mt` вже виявляв активні worktree для task-graph. Потрібно було об'єднати власника lifecycle та визначитись із мовою реалізації.

## Considered Options
* Залишити lifecycle у `@nitra/cursor`
* Перенести lifecycle у `@7n/mt` — JS (вирівнювання наявного `commands/worktree.mjs`)
* Перенести lifecycle у `@7n/mt` — Rust (`mt-scanner`)

## Decision Outcome
Chosen option: "Перенести у `@7n/mt` — JS", because бенчмарк (2026-06-16) показав: Node-wrapper `bin/mt.js` додає ~35 мс підлоги до будь-якого шляху; Rust-spawn поверх нього додає ще ~10 мс; JS-lifecycle (~63 мс total) виходить швидшим, ніж Rust-via-wrapper (~70+ мс), бо уникає зайвого spawn.

### Consequences
* Good, because transcript фіксує очікувану користь: `commands/worktree.mjs` у mt вирівняно (`add`→`create`, `.meta/` layout, `firstFreeBranch`, `prune`, `inventory`); 17/17 тестів passed; `cli.mjs` хелп оновлено.
* Bad, because курсор-консумери після cursor-міграції повинні мати `@7n/mt` у залежностях; повне видалення `worktree-cli.mjs` зі скілами відкладено до публікації `@7n/mt`.

## More Information
Репо mt: `npm/lib/commands/worktree.mjs`, `npm/lib/commands/worktree.test.mjs`, `npm/.changes/260616-1404.md`. Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md` (у cursor). Бенчмарк: Rust noop ~10 мс, `git worktree list` ~11 мс, повний `mt worktree list` (JS) ~63 мс. worktree вважається ефемерним: `remove` видаляє і checkout, і git-гілку.
