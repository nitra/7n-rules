---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T09:09:38+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Opportunistic LLM-fix tier у lint-правилах (`doc-files` як референс)

## Context and Problem Statement
Правило `doc-files` у `n-cursor lint` виявляло застарілі документи, але не могло їх виправити в межах lint-кроку — генерація потребує локальної LLM (omlx), тоді як усі інші lint-кроки є детермінованими й дешевими. Це створювало асиметрію: `lint` у fix-by-default режимі реально виправляв порушення (oxlint `--fix`, конформність-конвергенція), але для doc-files лише детектував і делегував у `fix-doc-files`. У процесі сесії було визнано, що `doc-files` — це прообраз ширшого підходу: opportunistic LLM-fix для всіх правил, де фікс недетермінований (cspell, doc-files), але безпечний (не змінює логіку програми).

## Considered Options
* **Ніяких змін** — лишити `lint` детермінованим/дешевим, `fix-doc-files` як єдиний генератор (статус-кво).
* **Умовний LLM-fix у lint-кроці**: `readOnly` → detect-only; omlx up → генерація stale-файлів; omlx down → skip + повідомлення + exit 1.
* **Флаг `--doc-files` до `lint`** — спеціалізований прапор для одного правила.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Умовний LLM-fix у lint-кроці з `readOnly`-гейтом і opportunistic skip", because це усуває асиметрію між правилами без зламу CI-контракту (у `--read-only` детект залишається детермінованим), а omlx-down → exit 1 не дає false-green на машинах без моделі.

Реалізовано у `npm/rules/doc-files/js/lint.mjs`: нова async-функція `lint(files, cwd, {readOnly})` зі шляхами:
1. нема stale → `return 0`
2. `readOnly` → `reportStale` + `return 1`
3. omlx up → `runGenerationBatch(stale, cwd)` → re-detect → `return exitCode`
4. omlx down → print «фікс пропущено + причина» → `return 1`

Спільне ядро `runGenerationBatch` і `preflightProblem` витягнуто в `export` у `docgen-files-batch.mjs`. Прапор `llmFix: true` додано до `npm/rules/doc-files/meta.json` і схеми `npm/schemas/rule-meta.json`.

### Consequences
* Good, because transcript фіксує очікувану користь: lint у fix-by-default тепер авто-генерує застарілі доки, якщо omlx доступний — єдиний виклик `lint` замість окремого `fix-doc-files`.
* Good, because CI-контракт не зламано: `lint --read-only --full` лишається детермінованим — omlx-виклику немає, лише detect + exit 1.
* Good, because машина без omlx не отримує false-green: omlx down → exit 1 + повідомлення «фікс пропущено».
* Good, because абстракція задокументована як opt-in (`llmFix: true` у `meta.json`) із тріажем безпеки: контент-лінтери ✅, логічні лінтери (oxlint/eslint) ❌, бо LLM-правка коду може змінити поведінку.
* Bad, because `lint` перестав бути повністю side-effect-free у fix-by-default — тепер він може мутувати файли через omlx, що ускладнює reasoning про чистоту scan-фази.
* Bad, because тести детектора втратили герметичність при `N_LOCAL_MIN_MODEL` у середовищі — вирішено переписом тестів на `{readOnly:true}` + `vi.mock` генерації (зафіксовано quirk `vi.fn` + `mockReset` при dynamic-import mock, вирішено стабільним wrapper-підходом).

## More Information
* Реалізація: `npm/rules/doc-files/js/lint.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs` (export `preflightProblem`, `runGenerationBatch`), `npm/rules/doc-files/meta.json`, `npm/schemas/rule-meta.json`.
* Тести: `npm/rules/doc-files/js/tests/lint.test.mjs` — 8 тестів, 131/131 пройшло.
* Changeset для B: `npm/.changes/260615-0907.md` (`bump: minor`, `section: Changed`).
* Дизайн-спека (тріаж правил, контракт кроку, план розширення на cspell тощо): `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
* Паралельно в цій же сесії: видалено `lint-ci` і `doc-files <sub>` як зайву поверхню — changeset `npm/.changes/260615-0638.md` (`bump: major`, `section: Removed`); виправлено enum `rule-meta.json` `quick|ci` → `per-file|full`.

---

## ADR Мінімізація CLI-поверхні: видалення `lint-ci` і `doc-files <sub>`

## Context and Problem Statement
`n-cursor` накопичив дві команди з нульовими живими callerами: `lint-ci` — чистий аліас `lint --read-only --full` без власної логіки; `doc-files <sub>` (`scan|check|gen|stamp`) — deprecated-аліас, доданий як міграційне вікно (~3 дні тому), але вже ніким не званий після переходу на `lint-doc-files`/`fix-doc-files`. Мета сесії — мінімальна поверхня CLI.

## Considered Options
* Видалити обидва (`lint-ci` + `doc-files <sub>`).
* Лишити `lint-ci` для зручності CI-скриптів.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити обидва", because обидва — нуль живих callerів (перевірено `grep` по `.github`, root `package.json`, тестах); `lint-ci` дублює `lint --read-only --full` без додаткової логіки; `doc-files <sub>` не має реальних callerів з дня появи. Видалення = breaking → changeset `bump: major`.

### Consequences
* Good, because transcript фіксує очікувану користь: менша поверхня CLI зменшує когнітивне навантаження і ризик зловживання deprecated-входами.
* Bad, because transcript не містить підтверджених негативних наслідків (усі callers перевірено — їх немає).

## More Information
* Видалено `case 'lint-ci'` і `case 'doc-files'` з `switch (command)` у `npm/bin/n-cursor.js`.
* Оновлено шапку `bin/n-cursor.js`: прибрано рядки `fix`/`fix bun`, `lint-ci`, `doc-files <sub>`; переписано опис `lint` на data-driven (`rules/<id>/meta.json: lint: per-file|full`).
* Виправлено `npm/schemas/rule-meta.json` enum `["quick","ci"]` → `["per-file","full"]` (відповідає `parseRuleLintSpec` у `npm/scripts/lib/rule-meta.mjs`).
* Оновлено `npm/rules/js-lint-ci/js-lint-ci.mdc`: `lint-ci` → `lint --full` / CI `lint --read-only --full`.
* Changeset: `npm/.changes/260615-0638.md` (`bump: major`, `section: Removed`).
* Перевірено: `node --check npm/bin/n-cursor.js` OK; `vitest` оркестратора lint 6/6 passed; `grep` на `lint-ci` як команду в коді/тестах — порожньо.
