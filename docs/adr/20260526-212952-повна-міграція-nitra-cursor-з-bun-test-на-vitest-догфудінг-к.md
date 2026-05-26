---
session: 2208c7de-d9d4-4720-b355-d3b5587de978
captured: 2026-05-26T21:29:52+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2208c7de-d9d4-4720-b355-d3b5587de978.jsonl
---

## ADR Повна міграція `@nitra/cursor` з `bun:test` на `vitest` (догфудінг канонічного baseline)

## Context and Problem Statement
Коміт 328b89c переключив канонічний Stryker baseline для споживачів `@nitra/cursor` на `vitest-runner + perTest`, але сам пакет продовжував використовувати `bun:test` (100 тестових файлів), `testRunner: 'command'` у `stryker.config.mjs` і `bun test --parallel` у `scripts.test`. Як наслідок, `n-cursor coverage` завершувався з `exit code 1` — `detect()` не знаходив жодного провайдера, бо `vitest` був відсутній у `npm/package.json`.

## Considered Options
* (A) Повна міграція cursor на vitest — переписати 100 тестових файлів, додати devDeps, `vitest.config.js`, оновити `stryker.config.mjs`
* (B) Мінімальний додаток devDeps без міграції тестів
* (C) Розширити `detect()` для підтримки `bun:test` поряд із vitest
* (D) Тимчасово прибрати `js-lint` з `.n-cursor.json#rules`

## Decision Outcome
Chosen option: "(A) Повна міграція cursor на vitest", because 328b89c вже задекларував канонічний baseline для споживачів — пакет мусить «їсти своє власне приготоване» (dogfood); варіанти B та C давали симптомні фікси без усунення суперечності між канонічним baseline та власним тест-раннером.

### Consequences
* Good, because `n-cursor coverage` тепер успішно завершується: 1146 тестів passed, `COVERAGE.md` генерується з JS-coverage 77.23% / mutation score 65.03%.
* Bad, because transcript фіксує потенційну нестабільність ENOTEMPTY race у `rules/changelog/.../check.test.mjs` при паралельному запуску vitest — проявляється лише в ізольованому run, в загальному suite проходить.

## More Information
Файли: `npm/package.json` (version 1.27.2→1.27.3, `scripts.test` + devDeps), `npm/stryker.config.mjs`, `npm/vitest.config.js` (скопійовано з `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js`), 100 `*.test.mjs` (bulk `s/from 'bun:test'/from 'vitest'/g`), 5 файлів з `mock(fn)` → `vi.fn(fn)`. Коміт-тригер: 328b89c `feat(npm/1.27.0): migrate canonical Stryker baseline to vitest-runner + perTest`.

---

## ADR Розміщення vitest devDeps у кореневому `package.json` замість `npm/package.json`

## Context and Problem Statement
Правило `npm-module` забороняє `devDependencies` у опублікованому workspace-пакеті `npm/`. При цьому `detect()` в `js-lint/coverage/coverage.mjs` перевіряв наявність `vitest` лише у `package.json` JS-root (першого workspace), що унеможливлювало активацію coverage-провайдера у монорепо з hoisted linker.

## Considered Options
* Додати vitest до `devDependencies` в `npm/package.json` (порушення правила npm-module)
* Додати vitest до `devDependencies` у кореневому `package.json` + розширити `detect()` для fallback-пошуку

## Decision Outcome
Chosen option: "Додати vitest до кореневого `package.json` + fallback у `detect()`", because `npm-module` rule явно забороняє devDeps у published workspace; `bunfig.toml` (`linker = "hoisted"`) забезпечує доступність кореневих пакетів у workspace-ах без дублювання.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun install` встановив 141 пакет без конфлікту з `npm-module`-check; `eslint.config.js` отримав `allowModules` для vitest-стека у `npm/**` (правило `n/no-extraneous-import`).
* Bad, because `detect()` тепер містить дворівневу логіку пошуку (workspace-root → project-root), що ускладнює читання коду; transcript не містить підтверджених негативних наслідків цього ускладнення.

## More Information
Файли: `package.json` (root devDeps: `vitest@^4.1.7`, `@vitest/coverage-v8@^4.1.7`, `@stryker-mutator/vitest-runner@^9.6.1`), `npm/rules/js-lint/coverage/coverage.mjs#hasVitestDep()` + `detect()` (workspace-fallback), `eslint.config.js` (`allowModules` для vitest-стека). Команда верифікації: `bunx eslint --no-warn-ignored npm/`.

---

## ADR Оновлення `vue.mdc` — перехід рекомендації з `bun:test` на `vitest`

## Context and Problem Statement
`npm/rules/vue/vue.mdc` v1.9 секція «Тестування» явно забороняла додавати `vitest` у Vue-проєкти («Bun Test Runner — використовуй його замість Vitest»). Після комміту 328b89c це суперечило `test.mdc` v2.4, який вже встановив vitest як канонічний тест-раннер.

## Considered Options
* Оновити `vue.mdc` в рамках поточної міграційної PR
* Залишити `vue.mdc` незміненим (окрема задача)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити `vue.mdc` в рамках поточної міграційної PR", because суперечність між `test.mdc` (vitest-canon) і `vue.mdc` (bun:test-canon) зачіпає споживачів пакету; виправлення в одному PR забезпечує цілісність канону.

### Consequences
* Good, because transcript фіксує очікувану користь: `vue.mdc` v2.0 узгоджено з `test.mdc` v2.4 — споживачі отримують єдину, несуперечливу рекомендацію (vitest + happy-dom для Vue).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/vue/vue.mdc` (version 1.9 → 2.0, секція «Тестування»). Суперечливий рядок до зміни: `vue.mdc:107` — «Bun Test Runner — використовуй його замість Vitest». Пов'язаний файл: `npm/rules/test/test.mdc` v2.4, `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js`.
