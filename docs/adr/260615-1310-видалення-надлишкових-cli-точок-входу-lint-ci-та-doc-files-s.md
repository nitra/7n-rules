---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T13:10:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

72/72 тестів проходять, changeset `npm/.changes/260615-1308.md` створено. Спеку оновити не вдалося (permission blocked) — вона залишиться у Draft-стані.

**Підсумок незакомічених змін:**
- `npm/rules/text/lint/cspell-fix.mjs` — нова схема classify→`.cspell.json`
- `npm/rules/text/lint/tests/cspell-fix.test.mjs` — оновлені тести
- `npm/.changes/260615-1308.md` — changeset `minor/Changed`

---

На основі транскрипту цієї сесії — фінальна ADR-документація:

## ADR Видалення надлишкових CLI-точок входу `lint-ci` та `doc-files <sub>`

## Context and Problem Statement
В `bin/n-cursor.js` існували дві CLI-команди без реальних callerів: `lint-ci` (чистий аліас `lint --read-only --full`) і `doc-files <sub>` (deprecated-аліас `scan|check|gen|stamp`). Ціль — мінімальна CLI-поверхня як архітектурна дисципліна.

## Considered Options
* Видалити обидва аліаси (breaking → major bump)
* Лишити `lint-ci` як convenience-аліас для CI-споживачів
* Лишити `doc-files <sub>` ще до наступного major (він сам мав мітку «знести — наступний major»)

## Decision Outcome
Chosen option: "Видалити обидва аліаси негайно", because аналіз показав 0 живих callerів у коді/workflow/скілах; лишати deprecated-шар без callera суперечить цілі мінімальної поверхні; CI вживає `lint --read-only --full` напряму.

### Consequences
* Good, because transcript фіксує очікувану користь: `default`-помилка стала коротшою, schema enum синхронізовано з реальністю (`per-file|full` замість мертвого `quick|ci`), `js-lint-ci.mdc` описує коректну команду.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/bin/n-cursor.js` (case-блоки та шапка), `npm/schemas/rule-meta.json` (enum), `npm/rules/js-lint-ci/js-lint-ci.mdc`. Changeset: `npm/.changes/260615-0638.md` (bump: major, section: Removed).

---

## ADR doc-files lint-крок: opportunistic LLM-fix tier (detect-or-generate)

## Context and Problem Statement
`rules/doc-files/js/lint.mjs` виконував **тільки detect** застарілих файлових доків і виводив «→ перегенеруй: fix-doc-files». Інші правила у fix-by-default реально виправляють (oxlint `--fix`, конформність-конвергенція). doc-files — виняток через залежність від локальної LLM (omlx). Мета: забрати асиметрію.

## Considered Options
* Додати opportunistic-fix у `lint()`: якщо omlx піднято — генерувати; якщо ні — skip + exit 1
* Лишити detect-only (поточний стан)
* Перенести генерацію в `fix-doc-files --auto` без зміни `lint()`

## Decision Outcome
Chosen option: "Opportunistic-fix у `lint()`", because це зберігає семантику fix-by-default (порушення → fix → pass; skip ≠ false-green), а guard-rails (`readOnly`→detect, health-check лише при stale, skip→exit 1) усувають раніше виявлені ризики.

### Consequences
* Good, because transcript фіксує очікувану користь: `readOnly` (CI/hook) — детермінований; omlx down — гейт тримається (exit 1); omlx up — файли регенеруються й гейт зеленіє.
* Bad, because lint-крок стає side-effecting і тягне генераційну машинерію (omlx preflight, circuit-breaker, abort-streak). Юніт-тести детектора втратили герметичність (переведені на `readOnly:true` + mock).

## More Information
Файли: `npm/rules/doc-files/js/lint.mjs` (новий контракт), `npm/rules/doc-files/js/docgen-files-batch.mjs` (експортовані `runGenerationBatch`, `preflightProblem`), `npm/rules/doc-files/meta.json` (`llmFix:true`), `npm/schemas/rule-meta.json` (нова властивість `llmFix`). Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Changeset: `npm/.changes/260615-0907.md` (bump: minor).

---

## ADR cspell-fix: заміна whole-file rewrite на classify→словник

## Context and Problem Statement
`npm/rules/text/lint/cspell-fix.mjs` використовував `llmLintFix` (whole-file rewrite через LLM): модель отримувала весь файл і мала повернути його назад виправленим. На реальних файлах репо це давало таймаут 120с (curl exit 28) і parse-fail відповіді. Причина — output розміром із input (6k+ токенів).

## Considered Options
* Classify → авто-дописати валідні слова у `.cspell.json`, typo → список на рев'ю (bounded output)
* Whole-file rewrite (поточний стан)
* Не чіпати cspell (лишити detect-only, як є без omlx)

## Decision Outcome
Chosen option: "classify → `.cspell.json` append", because живий експеримент на репо (1406 знахідок, 292 файли) показав ~90% знахідок — валідні укр/тех-слова, відсутні в словнику; реальний ремедіейшн = додати їх у словник, а не «виправляти» в коді. Bounded output (~80 слів → малий JSON) не має таймауту.

### Consequences
* Good, because transcript фіксує: 73 слова у `.cspell.json` за ≈5с (vs 120с timeout/0 виправлень раніше); re-detect після додавання = 0 на scope; ймовірні одруки (7 шт.) виведені на рев'ю без авто-застосування — знайдено 1 шкідливу класифікацію (`аутейдж`→`аудит`), яка не потрапила у словник.
* Bad, because гейт після класифікації зеленіє лише якщо omlx піднятий; при omlx down знахідки лишаються і треба додавати слова вручну.

## More Information
Файли: `npm/rules/text/lint/cspell-fix.mjs` (нові функції `unknownWords`, `classifyPrompt`, `appendWordsToDict`, `runCspellText`), `npm/rules/text/lint/tests/cspell-fix.test.mjs`. Принцип: bounded output — обов'язковий для всіх LLM-стратегій (whole-file rewrite заборонений). Changeset: `npm/.changes/260615-1308.md` (bump: minor). Цільовий словник: `.cspell.json` → поле `words[]` (sorted, dedup).
