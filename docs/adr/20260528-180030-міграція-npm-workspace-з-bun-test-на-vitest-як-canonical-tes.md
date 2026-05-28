---
session: 2208c7de-d9d4-4720-b355-d3b5587de978
captured: 2026-05-28T18:00:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2208c7de-d9d4-4720-b355-d3b5587de978.jsonl
---

## ADR Міграція npm workspace з bun:test на vitest як canonical test runner

## Context and Problem Statement
Команда `n-cursor coverage` шукає провайдерів через `npm/rules/<ruleId>/coverage/coverage.mjs`. Єдиний провайдер (у `js-lint`) перевіряв присутність `vitest` у `package.json` JS-root, але `cursor/npm/package.json` не мав цього залежності — coverage виходив з помилкою "Жодного провайдера покриття не знайдено". Причина: комміт `328b89c` переключив canonical Stryker baseline для споживачів на `vitest-runner`, але сам cursor зберігав 100 тестів на `bun:test` і `bun test --parallel` як runner.

## Considered Options
* Повна міграція cursor на vitest (замінити `bun:test` у 100 тест-файлах, додати devDeps, оновити `stryker.config.mjs` і `package.json#scripts.test`)
* Мінімальний dodatok devDeps без міграції тестів (симптомний фікс, `vitest run --coverage` впав би)
* Розширити `detect()` у coverage-провайдері для підтримки `bun test` як альтернативного runner-а
* Тимчасово прибрати `js-lint` з `.n-cursor.json#rules`

## Decision Outcome
Chosen option: "Повна міграція cursor на vitest", because cursor повинен дотримуватися власного канону (canon `test.mdc` v2.4 + `stryker.config.baseline.mjs` з `328b89c`); вибір (A) підтвердив власник репозиторію.

### Consequences
* Good, because `n-cursor coverage` успішно запускається і генерує `COVERAGE.md` з mutation score 93.62% (132/141).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено файли (вибірка): `npm/package.json` (`scripts.test`: `bun test --parallel` → `vitest run`; додано devDeps `vitest ^4.1.7`, `@vitest/coverage-v8 ^4.1.7`, `@stryker-mutator/vitest-runner ^9.6.1`), `npm/stryker.config.mjs` (`testRunner: 'command'` → `testRunner: 'vitest'` + `coverageAnalysis: 'perTest'` + `incremental: true`), `npm/vitest.config.js` (новий файл з canonical baseline).
- 100 тест-файлів: `import … from 'bun:test'` → `import … from 'vitest'`; 5 файлів: `mock(fn)` → `vi.fn(fn)`.
- Bun-специфічні API замінено: `Bun.file().text()` → `readFile()`, `Bun.spawn` → `spawnSync`, `import.meta.dir` → `dirname(fileURLToPath(import.meta.url))`.
- `eslint.config.js`: додано `n/no-extraneous-import: { allowModules: ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner'] }` для `npm/**/*.{js,mjs,cjs}`.

---

## ADR Exclude Stryker sandbox у vitest config

## Context and Problem Statement
Після міграції на vitest coverage-прогін падав: vitest підбирав тест-файли з `npm/reports/stryker/.tmp/sandbox-*/`, тобто Stryker-копії реального коду. `integration-repo-checks.test.mjs` у sandbox не мав `bun.lock`/`bunfig.toml`/`package.json` і падав з AssertionError.

## Considered Options
* Додати `exclude: ['**/reports/stryker/**']` у `vitest.config.js`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати exclude у vitest.config.js", because без нього кожен coverage-прогін, що лишає sandbox, ламав наступний через помилкову ізоляцію тестів.

### Consequences
* Good, because `n-cursor coverage` виходить з кодом 0; sandbox-тести більше не підбираються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/vitest.config.js` і canonical baseline `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` — обидва отримали `exclude: ['**/reports/stryker/**', '**/node_modules/**', '**/.git/**']`.
- Зміна підштовхнула version bump `1.29.0 → 1.29.1` з CHANGELOG-entry (нова версія canonical baseline для споживачів).

---

## ADR Зміна detect() у js-lint coverage-провайдері: workspace-fallback до кореневого package.json

## Context and Problem Statement
`npm/rules/js-lint/coverage/coverage.mjs#detect()` перевіряв наявність `vitest` лише у `package.json` JS-root (першого workspace). Але правило `npm-module.mdc` забороняє `devDependencies` у опублікованому workspace; vitest тому декларується у кореневому `package.json` монорепо. Результат: `detect()` повертав `false` у cursor і видавав hint про відсутній `vitest`.

## Considered Options
* Додати fallback: якщо `vitest` відсутній у workspace-`package.json` — перевірити кореневий `package.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Fallback до кореневого package.json", because cursor слідує власному `npm-module.mdc` (devDeps у root, не у workspace), і `detect()` мав це враховувати.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor coverage` знаходить провайдера і запускається без помилок у bun monorepo.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/rules/js-lint/coverage/coverage.mjs` — функція `detect(cwd)` отримала додаткову перевірку `package.json` у `path.resolve(cwd, '..')` якщо перша перевірка повернула `false`.
- Тест-файл `npm/rules/js-lint/coverage/tests/coverage.test.mjs`: додано кейс `workspace-fallback у root package.json`.

---

## ADR Оновлення vue.mdc: заміна Bun Test Runner на vitest як рекомендований фреймворк для Vue-проєктів

## Context and Problem Statement
`npm/rules/vue/vue.mdc` (секція «Тестування», рядок 107) явно рекомендував `bun test` і забороняв vitest. Після переходу `test.mdc` v2.4 на canonical vitest+Stryker baseline (комміт `328b89c`) vue.mdc залишав суперечливу настанову для споживачів cursor-правил.

## Considered Options
* Оновити vue.mdc: vitest + happy-dom як preferred для Vue/Vite-проєктів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити vue.mdc на vitest", because `test.mdc` v2.4 є canonical для всіх JS-проєктів, включаючи Vue; суперечність між правилами шкодить споживачам.

### Consequences
* Good, because transcript фіксує очікувану користь: правила vue.mdc і test.mdc стали узгодженими; vue.mdc бампнуто до версії `2.0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/rules/vue/vue.mdc` — секція «Тестування» переписана; `version: '1.9'` → `version: '2.0'`.
