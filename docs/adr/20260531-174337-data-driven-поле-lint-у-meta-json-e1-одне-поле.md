---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:43:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Data-driven поле `lint` у `meta.json` (E1 — одне поле)

## Context and Problem Statement
Наявний `bun run lint` — монолітний ланцюг шести lint-кроків, який однаково виконується і в dev (slow), і в CI. Треба розділити запуск на quick-режим (тільки змінені файли) та ci-режим (увесь репо). Питання: як правила декларують свою фазу?

## Considered Options
* **E1 — одне поле `lint: "quick" | "ci"`** у `rules/*/meta.json`; виконавець — `js/lint.mjs` правила
* **5-польова схема** (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`) з командою й параметрами безпосередньо в `meta.json` (запропонована паралельною сесією, зафіксована в `2026-05-31-lint-split-quick-ci-design.md` до ревізії)

## Decision Outcome
Chosen option: "E1 — одне поле `lint`", because користувач явно обрав простішу схему (E1) після порівняння: «мінімальна складність, виконавець — `js/lint.mjs` правила, не команда-рядок у meta». 5-польова схема зафіксована в spec-дублі, який прибрано (`26cb6ac`); spec переписано під E1 (`ac2b165`).

### Consequences
* Good, because transcript фіксує очікувану користь: правило несе єдину декларацію (`lint: "quick"` або `lint: "ci"`), а вся логіка виконання — в `js/lint.mjs`, що відповідає наявній архітектурі concern-файлів правила.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/rules/js-lint/meta.json` (`lint: "quick"`), `npm/rules/js-lint-ci/meta.json` (`lint: "ci"`). Оркестратор: `npm/scripts/lint-cli.mjs`, функції `selectLintRules` + `runLint`. CLI-кейси: `case 'lint'` → `runLint({ ci: false })`, `case 'lint-ci'` → `runLint({ ci: true })` — `npm/bin/n-cursor.js:1466`. Squash-коміт: `ebe76db`, реліз `@nitra/cursor@1.40.0`.

---

## ADR База змінених файлів — `git diff HEAD` + untracked

## Context and Problem Statement
Quick-режим lint повинен перевіряти лише «поточно змінені» файли, щоб не гоняти весь репо під час розробки. Питання: що вважати «зміненими»?

## Considered Options
* **`git diff HEAD` (modified/added/renamed) + untracked (`git ls-files --others`)** — робоче дерево відносно останнього коміту
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`git diff HEAD` + untracked", because spec E1 і план явно фіксують: «база = working-tree vs HEAD + untracked», щоб охопити незакомічені зміни й нові файли, але не повний `git diff origin`.

### Consequences
* Good, because transcript фіксує очікувану користь: перевіряється рівно те, що розробник зараз редагує, незалежно від того, закомічено чи ні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано в `npm/scripts/lib/changed-files.mjs`, функція `collectChangedFiles(cwd)`: `git diff HEAD --name-only --diff-filter=ACMR` (modified/added/renamed, виключає deleted) плюс `git ls-files --others --exclude-standard` (untracked). Результат дедуплікується. Тести: `npm/scripts/lib/tests/changed-files.test.mjs` (3 passed: modified+untracked, clean tree → empty, outside git → empty).

---

## ADR Розбиття `js-lint` на два окремих правила (D3)

## Context and Problem Statement
Правило `js-lint` виконує oxlint+eslint (per-file) і jscpd+knip (cross-file, не приймають список файлів). Quick-режим вимагає фільтрації по файлах, CI — повний прогін. Тримати обидва набори в одному правилі й декларувати лише одну фазу неможливо.

## Considered Options
* **Розбити на два правила:** `js-lint` (quick: oxlint+eslint) + `js-lint-ci` (ci: jscpd+knip)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "розбити на `js-lint` + `js-lint-ci`", because oxlint і eslint приймають список файлів (можна quick), а jscpd і knip аналізують увесь граф залежностей (вимагають ci). Одне правило не може водночас бути quick і ci.

### Consequences
* Good, because transcript фіксує очікувану користь: кожне правило несе одну `lint`-фазу, архітектура залишається data-driven без if-логіки в оркестраторі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/rules/js-lint/meta.json` → `"lint": "quick"`; `npm/rules/js-lint/js/lint.mjs` — `filterJsFiles` + `lint(files)`. `npm/rules/js-lint-ci/meta.json` → `"lint": "ci"`; `npm/rules/js-lint-ci/js/lint.mjs` — делегат до jscpd+knip (files=undefined). Squash-коміт `ebe76db`.

---

## ADR Класифікація наявних lint-правил: `ga/rego/text/security` → `ci`

## Context and Problem Statement
Наявні правила `ga`, `rego`, `text`, `security` мали бути класифіковані як `quick` або `ci`. Їхні CLI-модулі (`runLintGaCli`, `runLintRego`, `runLintTextCli`, трафлхог) можуть або не можуть приймати список файлів.

## Considered Options
* **Всі чотири → `ci`** — їх CLI не приймають список файлів; quick = «звірити при impl»
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "ga/rego/text/security → `ci`", because субагент T6 встановив фактичні сигнатури: `runLintGaCli`, `runLintRego`, `runLintTextCli` — не приймають `files[]`; trufflehog запускається з фіксованим scope. Фаза `quick` залишена для `js-lint` і `style-lint`, які отримали власні `js/lint.mjs` з `filterFiles`.

### Consequences
* Good, because transcript фіксує очікувану користь: класифікація похідна від реальної здатності CLI, а не довільна — правило «звірити при impl» виконано.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано в `npm/rules/ga/js/lint.mjs`, `npm/rules/rego/js/lint.mjs`, `npm/rules/text/js/lint.mjs`, `npm/rules/security/js/lint.mjs` — делегати до відповідних CLI без фільтрації файлів. Відповідні `meta.json` не отримали поле `lint` (відсутнє поле = ci-лише). Перевірено субагентом T6, коміт `2174f33`.
