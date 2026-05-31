# Повна міграція `@nitra/cursor` з `bun:test` на `vitest` (догфудінг)

**Status:** Accepted
**Date:** 2026-05-26

## Context and Problem Statement

Коміт 328b89c встановив `vitest-runner + perTest` як канонічний Stryker baseline для споживачів `@nitra/cursor`. Проте сам пакет продовжував використовувати `bun:test` (100 тестових файлів), `testRunner: 'command'` у `stryker.config.mjs` і `bun test --parallel` у `scripts.test`. Як наслідок, `n-cursor coverage` завершувався з `exit code 1` — `detect()` не знаходив жодного провайдера, бо `vitest` був відсутній у `npm/package.json`. Правило `npm-module` забороняє `devDependencies` у опублікованому workspace-пакеті `npm/`, тому `vitest` не можна додавати до `npm/package.json` напряму. `vue.mdc` v1.9 явно забороняла vitest у Vue-проєктах («Bun Test Runner — використовуй його замість Vitest»), що суперечило `test.mdc` v2.4.

## Considered Options

- (A) Повна міграція cursor на vitest — переписати 100 тестових файлів, додати devDeps у кореневий `package.json`, `vitest.config.js`, оновити `stryker.config.mjs`; розширити `detect()` для fallback-пошуку у project-root
- (B) Мінімальний додаток devDeps без міграції тестів
- (C) Розширити `detect()` для підтримки `bun:test` поряд із vitest
- (D) Тимчасово прибрати `js-lint` з `.n-cursor.json#rules`

## Decision Outcome

Chosen option: "(A) Повна міграція cursor на vitest", because 328b89c вже задекларував канонічний baseline для споживачів — пакет мусить «їсти своє власне приготоване» (dogfood); варіанти B та C давали симптомні фікси без усунення суперечності між канонічним baseline та власним тест-раннером.

### Consequences

- Good, because `n-cursor coverage` тепер успішно завершується: 1146 тестів passed, `COVERAGE.md` генерується з JS-coverage 77.23% / mutation score 65.03%.
- Good, because `vue.mdc` v2.0 узгоджено з `test.mdc` v2.4 — споживачі отримують єдину, несуперечливу рекомендацію (vitest + happy-dom для Vue).
- Good, because `bunfig.toml` (`linker = "hoisted"`) забезпечує доступність кореневих пакетів у workspace-ах; `bun install` встановив 141 пакет без конфлікту з `npm-module`-check.
- Bad, because `detect()` тепер містить дворівневу логіку пошуку (workspace-root → project-root), що ускладнює читання коду; transcript не містить підтверджень конкретних негативних наслідків.
- Neutral, because transcript фіксує потенційну нестабільність ENOTEMPTY race у `rules/changelog/.../check.test.mjs` при паралельному запуску vitest — проявляється лише в ізольованому run, у загальному suite проходить.

## More Information

- `npm/package.json` — version 1.27.2→1.27.3, `scripts.test` + devDeps оновлено
- `package.json` (root) — devDeps: `vitest@^4.1.7`, `@vitest/coverage-v8@^4.1.7`, `@stryker-mutator/vitest-runner@^9.6.1`
- `npm/stryker.config.mjs` — оновлено runner на `@stryker-mutator/vitest-runner` + `perTest`
- `npm/vitest.config.js` — скопійовано з `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js`
- 100 `*.test.mjs` — bulk `s/from 'bun:test'/from 'vitest'/g`; 5 файлів з `mock(fn)` → `vi.fn(fn)`
- `npm/rules/js-lint/coverage/coverage.mjs#hasVitestDep()` + `detect()` — workspace-fallback
- `eslint.config.js` — `allowModules` для vitest-стека у `npm/**` (правило `n/no-extraneous-import`)
- `npm/rules/vue/vue.mdc` — version 1.9 → 2.0, секція «Тестування» (суперечливий рядок `vue.mdc:107` прибрано)
- Команда верифікації: `bunx eslint --no-warn-ignored npm/`
- Коміт-тригер: 328b89c `feat(npm/1.27.0): migrate canonical Stryker baseline to vitest-runner + perTest`

## Update 2026-05-28

### Деталі міграції 100 тест-файлів cursor/npm

- `npm/package.json`: `scripts.test` → `vitest run`; devDeps: `vitest ^4.1.7`, `@vitest/coverage-v8 ^4.1.7`, `@stryker-mutator/vitest-runner ^9.6.1`.
- 100 тест-файлів: `import … from 'bun:test'` → `import … from 'vitest'`; 5 файлів: `mock(fn)` → `vi.fn(fn)`.
- Bun API: `Bun.file().text()` → `readFile()`, `Bun.spawn` → `spawnSync`, `import.meta.dir` → `dirname(fileURLToPath(import.meta.url))`.
- `npm/stryker.config.mjs`: `testRunner: 'command'` → `testRunner: 'vitest'`, `coverageAnalysis: 'perTest'`, `incremental: true`.

### Виключення Stryker sandbox з vitest config

`npm/vitest.config.js` і canonical baseline отримали `exclude: ['**/reports/stryker/**', '**/node_modules/**', '**/.git/**']` — sandbox-копії більше не підбираються vitest. Bump `1.29.0 → 1.29.1`.

### js-lint coverage: workspace-fallback до кореневого package.json

`detect()` у `coverage.mjs` перевіряє `package.json` у `path.resolve(cwd, '..')` якщо `vitest` відсутній у workspace-`package.json`. Причина: `npm-module.mdc` забороняє devDeps у опублікованому workspace.

### vue.mdc: vitest замість bun test

Секція «Тестування» переписана: `vitest + happy-dom`; `version: '1.9'` → `version: '2.0'`. Усунуто суперечність із `test.mdc` v2.4.
