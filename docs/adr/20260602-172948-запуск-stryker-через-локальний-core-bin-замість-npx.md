---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T17:29:48+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR Запуск Stryker через локальний core-bin замість `npx`

## Context and Problem Statement
`runStryker` у `npm/rules/js-lint/coverage/coverage.mjs` запускав `@stryker-mutator/core` через `npx`, що тягнуло core у власний кеш без сусіднього плагіна `@stryker-mutator/vitest-runner`. Це призводило до помилки «Cannot find TestRunner plugin "vitest"» і робило `flow verify` coverage-gate декоративним упродовж усієї сесії.

## Considered Options
* Запускати Stryker через `npx @stryker-mutator/core` (старий підхід)
* Резолвити локально встановлений core через `require.resolve('@stryker-mutator/core/bin/stryker.js')` і запускати через `process.execPath`
* Резолвити core через `package.json` → поле `bin`, запускати bin-файл напряму (через його `#!/usr/bin/env node` shebang)

## Decision Outcome
Chosen option: "Резолвити через `package.json` → `bin`, запускати bin напряму", because `exports` у `@stryker-mutator/core` не відкриває subpath `./bin/stryker.js`, тому `require.resolve` із subpath кидає `ERR_PACKAGE_PATH_NOT_EXPORTED` і тихо падав у npx-fallback. Резолв через `package.json` (`createRequire` → `.resolve('@stryker-mutator/core/package.json')` → `dirname` + поле `bin.stryker`) знаходить локальний bin поряд із `vitest-runner`. Прямий запуск bin (node-shebang) гарантує виконання через node незалежно від bun/node батьківського процесу.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow verify` coverage-gate отримав ✅ (перший зелений за всю сесію), рекурентний блокер знято.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/js-lint/coverage/coverage.mjs`, функція `resolveLocalStrykerBin`. Валідація: два прямих e2e-запуски через `node ./npm/bin/n-cursor.js coverage --changed` показали «Starting initial test run (vitest test runner with "perTest" coverage analysis)» і exit 0.

---

## ADR Parity-гард дзеркала `.cursor/rules` через тест, а не CI-чек

## Context and Problem Statement
`.cursor/rules/n-<id>.mdc` (дзеркала) і `npm/rules/<id>/<id>.mdc` (канони) розійшлись після кількох задач: 5 файлів (changelog, flow, ga, npm-module, test) мали застарілий вміст. Потрібний механізм, що детектує дрейф рано.

## Considered Options
* CI/`fix`-чек parity — тест у repo-self-suite детектує розбіжність, блокує PR
* Легка targeted-resync команда (синкає лише змінені правила)
* Pre-commit hook (тримає дзеркало актуальним автоматично)

## Decision Outcome
Chosen option: "CI/parity-тест у repo-self-suite + разова регенерація", because це найменший tooling і ловить дрейф до merge. Разова регенерація через той самий трансформ (`inlineTemplateLinks`) усунула наявний дрейф.

### Consequences
* Good, because transcript фіксує очікувану користь: live-гард (`findMirrorDrift` на реальному репо) пройшов, 5 розійшлених дзеркал регенеровано коректно.
* Bad, because orphan-дзеркала (якщо канон видалено) гард мовчки пропускає — `listManagedMirrors` фільтрує їх. transcript фіксує це як by-design: видалення orphan — відповідальність bare-sync.

## More Information
Файли: `npm/scripts/lib/mirror-parity.mjs` (хелпер `listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`), `npm/scripts/lib/tests/mirror-parity.test.mjs` (юніт + live-гард). Трансформ дзеркала: `inlineTemplateLinks(canonical, ruleDir)` — той самий, що використовує `npx @nitra/cursor fix`.

---

## ADR Сигнал складності перекриває L0-класифікацію у `detectLevel`

## Context and Problem Statement
`detectLevel` повертав L0 («тривіальне») для описів на кшталт «fix mdc checker» або «detectLevel не має знижувати рівень до L0 через fix-дієслова, коли є суперечність/mdc/policy/rego», попри сигнали складності. Це пропускало рекомендований spec-крок і виділяло лише одного рецензента на фактично середні задачі.

## Considered Options
* Сигнал складності (COMPLEXITY_KEYS) разом із L0-дієсловом → L2 (пріоритет: L3 > L2∪складність > L0 > L1)
* Сигнал складності → лише L1 (не L0; м'якший підхід)
* Прибрати `fix` із L0_KEYS взагалі

## Decision Outcome
Chosen option: "Сигнал складності → L2", because обраний варіант A: складність (mdc/policy/rego/checker/правило/rules/суперечн/інваріант/violation) разом із fix-дієсловом → L2. Безпечніше over- ніж under-класифікувати, адже шкода — пропущений spec-крок. Додатково: реордер виправлений так, щоб лише COMPLEXITY_KEYS (не всі L2_KEYS) перекривали L0 — щоб `rename feature` залишався L0.

### Consequences
* Good, because transcript фіксує очікувану користь: dogfood-тест опису задачі (fix+mdc+rego+checker+суперечн) → 2; 17 тестів включно з регрес-кейсами (`fix merge conflict` → 0, `правильно` → не L2) пройшли.
* Bad, because COMPLEXITY_KEYS — короткі підрядки (`mdc`, `rego`), що можуть давати хибний L2 у коротких описах. Transcript фіксує це як ⚪-finding; залишено без змін.

## More Information
Файли: `npm/scripts/dispatcher/lib/level.mjs` (константи `COMPLEXITY_KEYS`, `L0_WORD_KEYS`, `L0_SUBSTR_KEYS`; функція `detectLevel`), `npm/scripts/dispatcher/lib/tests/level.test.mjs`. Пріоритет у коді: `L3 > (L2_KEYS ∪ COMPLEXITY_KEYS, якщо isL0) > L0 > L1`.

---

## ADR Рецензент flow review отримує Read-доступ для верифікації cross-file тверджень

## Context and Problem Statement
Рецензентський subagent (`flow review`) мав інструкцію «ЛИШЕ цей diff» у промпті, що призводило до нефальсифіковних findings («з diff не видно») — рецензент не перевіряв referenced-файли/spec, хоча технічно мав доступ до `Read`.

## Considered Options
* Зберегти поточний промпт «лише diff»
* Дозволити й зобов'язати рецензента дочитувати referenced-файли через `Read` перед репортом

## Decision Outcome
Chosen option: "Дозволити й зобов'язати Read-доступ", because рецензент вже мав `allowedTools: ['Read', 'Edit', 'Bash']` і `cwd = worktree` — фікс виключно у промпті. Нова інструкція: перед звітом про cross-file твердження перевірити referenced-файл через `Read`; не репортити нефальсифіковні findings.

### Consequences
* Good, because transcript фіксує очікувану користь: 14 тестів (включно з новим «інструктує дочитувати referenced-файли») пройшли; промпт тепер скоупує findings лише до рядків, доданих у diff.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/dispatcher/lib/review.mjs` (функція `reviewerPrompt`), `npm/scripts/dispatcher/lib/tests/review.test.mjs`. Кейс-регрес: рецензент не має репортити pre-existing баги сусідніх файлів, які не торкнуті diff-ом.
