---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T10:06:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

ADR генератор розібрав transcript і запакував рішення в MADR.

---

## ADR Видалення `lint-ci` та `doc-files <sub>` як надлишкових CLI-точок входу

## Context and Problem Statement
Проект мав три зайві CLI-точки входу: `lint-ci` (чистий аліас `lint --read-only --full`) і `doc-files <sub>` (deprecated-аліас `scan|check|gen|stamp` → `lint-doc-files`/`fix-doc-files`). Мета — мінімальна CLI-поверхня `n-cursor`. Водночас `rule-meta.json` enum тримав мертві значення `quick|ci` замість реальних `per-file|full`.

## Considered Options
* Видалити `lint-ci` та `doc-files <sub>` (breaking → major bump)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `lint-ci` та `doc-files <sub>`", because обидві команди мали 0 живих callerів: `lint-ci` — чистий аліас (`runLint({ full: true, readOnly: true })`), `doc-files <sub>` — deprecated-аліас, що не викликався ні hook, ні скілами, ні `.github` workflow; дублювання поверхні суперечить заявленій меті minimal-surface.

### Consequences
* Good, because transcript фіксує очікувану користь: скорочено кількість команд у `switch (command)` та `default`-помилці; виправлено schema `rule-meta.json` enum до реальних значень `per-file|full`; видалено застарілу прозу в `js-lint-ci.mdc`.
* Bad, because breaking change — потребує major-bump (`npm/.changes/260615-0638.md`, `bump: major, section: Removed`).

## More Information
Видалено: `case 'lint-ci'` та `case 'doc-files'` з `npm/bin/n-cursor.js`; рядки шапки CLI (`npx @nitra/cursor lint-ci`, `npx @nitra/cursor doc-files <sub>`); `lint-ci` з переліку `default`-помилки. Виправлено: `npm/schemas/rule-meta.json` enum `["quick","ci"]` → `["per-file","full"]`; опис поля `lint`; `npm/rules/js-lint-ci/js-lint-ci.mdc` — замінено посилання на `lint-ci` на `lint --full` / `lint --read-only --full`. Changeset: `npm/.changes/260615-0638.md`. Перевірка: `node --check npm/bin/n-cursor.js` OK; `vitest` lint-оркестратора — 6/6 passed; 0 посилань на `lint-ci` у коді/тестах.

---

## ADR Opportunistic LLM-fix tier у lint-кроці doc-files (референс-реалізація)

## Context and Problem Statement
Lint-крок правила `doc-files` (`npm/rules/doc-files/js/lint.mjs`) виконував лише детект застарілих доків (exit 1 + `→ перегенеруй: npx @nitra/cursor fix-doc-files`) і не мав `readOnly`-параметра, бо генерація через локальну LLM недетермінована. Задокументована мета сесії — зробити doc-files референсом для уніфікованого патерну «detect → LLM-fix (якщо доступна модель) → skip+exit 1 (якщо недоступна)», щоб надалі поширити на інші правила.

## Considered Options
* Opportunistic-fix: якщо omlx піднято — генерувати stale, якщо ні — skip + exit 1 (гейт тримається)
* Перенести LLM-генерацію в основний `lint --doc-files` флаг
* Влити генерацію завжди у fix-by-default lint (без preflight)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Opportunistic-fix з preflight і circuit-breaker", because цей варіант зберігає інваріант «gating завжди чесний» (omlx down → exit 1, не false-green), не ламає детермінований lint-цикл (preflight лише коли є stale), і дозволяє CI (`--read-only`) лишатися дешевим/портабельним.

### Consequences
* Good, because transcript фіксує очікувану користь: у fix-by-default lint stale-доки тепер авто-генеруються локально (без окремого `fix-doc-files`); `preflightProblem` та `runGenerationBatch` витягнуті й експортовані як спільне ядро для майбутніх інстансів; `meta.json: llmFix:true` — оголошений opt-in механізм; тести переписані — detect-гілка ізольована `{readOnly:true}`, gating-гілка замокована без реальних omlx-викликів; 131/131 passed.
* Bad, because lint-крок тепер side-effecting у fix-режимі (генерує файли); PostToolUse convergence-loop починає авто-генерувати доки при кожному збереженні файлу з активним omlx — наслідок свідомий, але потребує спостереження.

## More Information
Змінені файли: `npm/rules/doc-files/js/lint.mjs` (новий контракт `lint(files, cwd, {readOnly})`), `npm/rules/doc-files/js/docgen-files-batch.mjs` (витяг `runGenerationBatch`, `export preflightProblem`), `npm/rules/doc-files/meta.json` (`llmFix:true`), `npm/schemas/rule-meta.json` (нова властивість `llmFix`), `npm/rules/doc-files/js/tests/lint.test.mjs` (переписано, stable mock-wrapper). Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Changeset: `npm/.changes/260615-0907.md` (`minor`, Changed). ESLint — чисто.
