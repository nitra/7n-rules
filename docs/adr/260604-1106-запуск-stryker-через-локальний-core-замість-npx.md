---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-04T11:06:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Готово. ADR для цієї сесії:

---

## ADR Запуск Stryker через локальний core замість npx

## Context and Problem Statement
`runStryker` у `coverage.mjs` запускав `@stryker-mutator/core` через `npx`, що тягнуло core у кеш без плагіна `vitest-runner` — виникала помилка «Cannot find TestRunner plugin "vitest"». Крім того, `require.resolve('@stryker-mutator/core/bin/stryker.js')` падав через `ERR_PACKAGE_PATH_NOT_EXPORTED`, а `process.execPath` під bun-рантаймом вказував би на bun, а не node.

## Considered Options
* Запуск через `npx`
* Запуск через `node` + `process.execPath`
* Запуск через прямий виклик bin-файлу (node-shebang)

## Decision Outcome
Chosen option: "Запуск через прямий виклик bin-файлу (node-shebang)", because `resolveLocalStrykerBin` резолвить шлях через `package.json` + поле `bin` (оминаючи обмежений `exports`), а запуск напряму через shebang (`#!/usr/bin/env node`) гарантує node-рантайм незалежно від батьківського процесу (bun чи node).

### Consequences
* Good, because `flow verify` coverage-gate проходить: Stryker завантажує `vitest-runner` із локального `node_modules`, де гарантовано є сусід `@stryker-mutator/vitest-runner`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/js-lint/coverage/coverage.mjs` (функції `resolveLocalStrykerBin`, `runStryker`). Валідація: `node ./npm/bin/n-cursor.js coverage --changed` → «Starting initial test run (vitest test runner…)», exit 0. Команда: `node_modules/@stryker-mutator/core/bin/stryker.js` (executable, `#!/usr/bin/env node`).

---

## ADR Word-boundary матч ASCII L0-дієслів у detectLevel

## Context and Problem Statement
`detectLevel` у `level.mjs` матчив L0-дієслова (`fix`, `typo`, `bump`, `rename`, `hotfix`) як підрядки — тому `add prefix validation` або `update fixture setup` хибно отримували рівень 0 замість 1.

## Considered Options
* Підрядковий матч (поточний)
* Word-boundary матч для ASCII-дієслів; кириличні — підрядком (стемінг)

## Decision Outcome
Chosen option: "Word-boundary матч для ASCII-дієслів; кириличні — підрядком (стемінг)", because `fix` всередині `prefix`/`fixture` не є L0-сигналом; кириличні (`опечат`, `перейменув`) залишаються підрядком через морфологію.

### Consequences
* Good, because `add prefix validation` → L1 замість хибного L0; `fix typo` → L0 (без регресу).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/dispatcher/lib/level.mjs` (`L0_WORD_KEYS`, `L0_SUBSTR_KEYS`, `hasWord`), `npm/scripts/dispatcher/lib/tests/level.test.mjs`. Коміт: `b8fe7df`.

---

## ADR Сигнал складності перекриває L0 у detectLevel

## Context and Problem Statement
`detectLevel` не підвищував рівень для задач типу «fix mdc checker» — fix-дієслово давало L0, попри ознаки складності (policy, rego, checker, суперечн тощо). Такі задачі пропускали spec/plan фазу.

## Considered Options
* Без complexity-guard (поточний стан на момент реалізації)
* Complexity-guard: fix + сигнал складності → L2 (варіант A, обраний)
* Complexity-guard: fix + сигнал складності → L1 (варіант B)

## Decision Outcome
Chosen option: "Complexity-guard: fix + сигнал складності → L2", because задачі на правила/checker/policy/rego реально вимагають spec+plan (L2), а under-класифікація коштує більше ніж over-класифікація.

### Consequences
* Good, because опис типу «fix mdc checker» → L2 (догфуд: той самий `flow init` дає 2); `rename feature` → L0 без регресу (лише складність перекриває, не L2-ключі).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/dispatcher/lib/level.mjs` (`COMPLEXITY_KEYS`, `isL0 && !hasComplexity`), `npm/scripts/dispatcher/lib/tests/level.test.mjs` (17 тестів). Коміт: `25e1a0c`. Review-фікси: `правило`/`правила` замість `правил` (уникнення `правильно`); `conflict` прибрано.

---

## ADR Parity-гард дзеркала `.cursor/rules`

## Context and Problem Statement
`.cursor/rules/n-<id>.mdc` дзеркало відстало від канонічних `npm/rules/<id>/<id>.mdc` — 5 файлів (changelog, flow, ga, npm-module, test) містили застарілий вміст. Дрейф не виявлявся автоматично.

## Considered Options
* CI/тест-гард parity (обраний)
* Легка targeted-resync команда
* Pre-commit hook

## Decision Outcome
Chosen option: "CI/тест-гард parity", because parity-тест ловить дрейф на кожному `verify`, а разова регенерація закриває поточний дрейф без побічного синку skills/devDeps важкого `bare-sync`.

### Consequences
* Good, because live-гард (`findMirrorDrift`) у тест-suite фіксує дрейф до merge; 5 дзеркал регенеровано.
* Bad, because гард не помічає «застряглих» orphan-дзеркал, якщо канон видалили (by-design: для цього — bare-sync).

## More Information
Файли: `npm/scripts/lib/mirror-parity.mjs` (`listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`), `npm/scripts/lib/tests/mirror-parity.test.mjs` (4 тести). Трансформ: `inlineTemplateLinks(канон, ruleDir)`. Регенеровані: `n-changelog.mdc`, `n-flow.mdc`, `n-ga.mdc`, `n-npm-module.mdc`, `n-test.mdc`. Коміт: `fe5501f`.

---

## ADR Класифікація lint-findings на introduced vs pre-existing (беклог #6/A)

## Context and Problem Statement
`js-lint` quick-lint запускав oxlint і eslint зі `stdio: 'inherit'` — findings стрімились у термінал без парсингу, і `flow verify` фейлив на **всіх** findings у змінених файлах, не розрізняючи «внесено цією зміною» від «передіснуючий борг файлу». Це змушувало чинити чужий борг у кожному PR.

## Considered Options
* Label-only: класифікувати й позначати, блокувати на будь-якому (варіант A, обраний)
* Label + relax: фейлити лише на introduced, pre-existing → warning (варіант B)

## Decision Outcome
Chosen option: "Label-only (варіант A)", because зберігає поточну строгість блокування, додаючи видимість — розробник одразу бачить, що є його, а що — старий борг. Варіант B відклали як потенційне послаблення гейту.

### Consequences
* Good, because `flow verify` ✅ на новому коді; вивід розбито на `🆕 introduced` / `🗄 pre-existing` з окремим ліком; краш oxlint/eslint (config error, parse panic) більше не дає silent pass — детектується через `null`-семантику `parseOxlint`/`parseEslint`.
* Bad, because pre-existing findings все ще блокують verify (варіант A свідомо не знімає цього обмеження).

## More Information
Файли: `npm/rules/js-lint/js/lint.mjs` (рефакторинг `lintChangedClassified`, `runJson`), `npm/rules/js-lint/js/lint-findings.mjs` (`parseOxlint`, `parseEslint`, `classifyFindings`, `renderClassifiedFindings`), `npm/scripts/lib/diff-added-lines.mjs` (`parseDiffAddedLines`, `addedLinesMap`). Тести: 18 (3 файли). Pipeline: fix-паси → json-репорт → classify → render. Коміт: `8af1ae0e`.
