---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T06:41:46+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Видалення надлишкових CLI точок входу: `lint-ci` і `doc-files <sub>`

## Context and Problem Statement
CLI `@nitra/cursor` (`npm/bin/n-cursor.js`) накопичив дублюючі точки входу: `lint-ci` був чистим аліасом `lint --read-only --full`, а `doc-files <sub>` — deprecated-делегатом до `lint-doc-files`/`fix-doc-files` без жодного живого caller-а у коді, workflow або `package.json`. Ціль: мінімальна поверхня CLI.

## Considered Options
* Залишити `lint-ci` і `doc-files` — зберегти зворотну сумісність
* Видалити `lint-ci` і `doc-files <sub>` як надлишкові (0 живих callerів, аліаси без власної логіки)

## Decision Outcome
Chosen option: "Видалити `lint-ci` і `doc-files <sub>`", because grep по `.github`, root `package.json`, всіх `.mjs`/`.js` і MDC-файлах показав нуль живих викликів; обидва — чисті аліаси без власної поведінки.

### Consequences
* Good, because transcript фіксує очікувану користь: менше точок входу → менше підтримки; `lint --read-only --full` покриває CI-сценарій без окремої команди; `lint-doc-files` і `fix-doc-files` покривають doc-files без deprecated-шару.
* Bad, because видалення публічних команд — breaking change; зафіксовано у `npm/.changes/260615-0638.md` як `bump: major`, `section: Removed`.

## More Information
- `npm/bin/n-cursor.js` — видалено `case 'lint-ci'`, `case 'doc-files'`, рядки у шапці, перелік у `default`-помилці, коментар у root-guard.
- `npm/schemas/rule-meta.json` — enum `["quick","ci"]` → `["per-file","full"]` (узгодження з реальними значеннями `parseRuleLintSpec`).
- `npm/rules/js-lint-ci/js-lint-ci.mdc` — `lint-ci` → `lint --full` / CI `lint --read-only --full` у description та тілі.
- `npm/.changes/260615-0638.md` — changeset `bump: major, section: Removed`.
- Перевірено: `node --check bin/n-cursor.js` OK; `vitest run` — 6/6 passed.

---

## ADR Opportunistic LLM-fix tier як новий патерн для lint-правил

## Context and Problem Statement
doc-files lint-правило детектить застарілі доки, але не може їх автоматично полагодити в стандартному fix-by-default lint-циклі — бо генерація потребує локальної LLM (omlx). Це єдине lint-правило без fix-гілки в `lint()`. Виникла ідея: якщо omlx доступний — генерувати, інакше — report-skip (exit 1 у будь-якому разі). Під час обговорення виявлено, що це є референсним прообразом для всіх lint-правил із LLM-fixable помилками (cspell тощо).

## Considered Options
* Залишити lint-крок detect-only, fix — виключно через `fix-doc-files` (поточний стан)
* Opportunistic LLM-fix у `lint()`: omlx up → генерувати scoped, omlx down → warn + exit 1 (skip ≠ зелено)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Opportunistic LLM-fix tier — реалізувати, але через окрему спеку та з тріажем безпеки", because пряме додавання генерації в `lint()` без спеки зламало б герметичність юніт-тестів детектора (виклики `lint(files, root)` без `readOnly` почали б робити реальний omlx health-check) та порушило б інваріант «lint — детермінований/дешевий». Спека `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` фіксує дизайн, тріаж і порядок розгортання.

### Consequences
* Good, because transcript фіксує очікувану користь: уніфікована модель «detect → детермінований fix → LLM-fix (якщо omlx up) → skip» для всіх придатних правил; doc-files стає референсною реалізацією.
* Bad, because потребує: (1) рефакторингу юніт-тестів детектора на `{readOnly:true}` + мок генерації; (2) per-rule прапора `llm-fixable` у `meta.json` для тріажу безпеки (не всі linter-помилки безпечно правити LLM — eslint `no-unused-vars`/`complexity` змінює поведінку коду); (3) витягнення `runGenerationBatch` в окремий експорт із `docgen-files-batch.mjs`.

## More Information
- Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`
- Реюзабельні цеглини: `preflightProblem()` і loop з abort-streak у `npm/rules/doc-files/js/docgen-files-batch.mjs:66+`.
- Наявний прецедент LLM-fix tier: conformance-фаза `runConformance` (Tier0 → omlx) у `npm/rules/lint/js/orchestrate.mjs` — але лише для `--full`, а не per-file сканерів.
- Changeset для цієї фічі: окремий (не включено у `260615-0638.md`).
