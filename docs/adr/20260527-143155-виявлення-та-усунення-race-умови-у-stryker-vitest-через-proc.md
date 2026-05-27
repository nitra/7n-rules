---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T14:31:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

## ADR Виявлення та усунення race-умови у Stryker/vitest через `process.chdir`

## Context and Problem Statement
Під час виконання `bunx @stryker-mutator/core run` паралельні vitest-workers ділять один процес; тести у `changelog/consistency` викликали `git init`/`git commit` у `withTmpCwd`-тимчасовій директорії, проте іншій worker-thread зміщував `process.cwd()` назад у реальний репо, що призводило до появи rogue-commit'ів від `Author: test <test@test>` у production git-history.

## Considered Options
* Виставити `pool: 'forks'` у `npm/vitest.config.js` (ізоляція через окремі процеси)
* Додати окремий `vitest.stryker.config.js` зі звуженим `include`, щоб Stryker не підхоплював небезпечні git-тести
* Рефакторинг `withTmpCwd` → `withTmpDir` без `process.chdir` (корінне виправлення)

## Decision Outcome
Chosen option: "Виставити `pool: 'forks'` у `npm/vitest.config.js`", because це single-line фікс, що ізолює `process.chdir` між test-файлами при звичайних `bun run test` прогонах. Але Stryker vitest-runner ігнорує `pool` зі свого inline-режиму, тому race залишається при `bunx @stryker-mutator/core run`.

### Consequences
* Good, because transcript фіксує очікувану користь: після додавання `pool: 'forks'` `bun run test` (1169 тестів) більше не створює rogue-commits, HEAD залишається незмінним під час повних test-прогонів.
* Bad, because `bunx @stryker-mutator/core run` продовжує викликати race — Stryker запускає vitest inline та перевизначає `pool`, тому rogue-commits (`Author: test <test@test>`, message `init`) продовжують з'являтися під час кожного mutation-testing прогону.

## More Information
- Файл: `npm/vitest.config.js` — додано `pool: 'forks'`
- Файл: `npm/scripts/utils/test-helpers.mjs` — оновлено docstring `withTmpCwd` з попередженням про небезпеку у Stryker-контексті
- Версія: `npm/package.json` bumped `1.27.6` → `1.27.7`; `npm/CHANGELOG.md` — запис `1.27.7` із описом race-fix
- Команда прояву: `bunx @stryker-mutator/core run` у `/Users/vitaliytv/www/nitra/cursor/npm`
- Нерозв'язаний шлях: `changelog/consistency/tests/check.test.mjs` — `git init` / `git commit` через `git(['-c','user.name=test','-c','user.email=test@test',...])` у `withTmpCwd`; race спрацьовує коли Stryker з'єднує ці тести з тестами у `rules/test/coverage/tests/`
- Два запропонованих повних рішення (обговорені з user у transcript): (А) `vitest.stryker.config.js` з вузьким `include` для Stryker, (Б) рефакторинг `withTmpCwd` → `withTmpDir` без `process.chdir` у 43+ файлах

---

## ADR Суворі програмні перевірки артефактів Prettier у правилі `text`

## Context and Problem Statement
Правило `text.mdc` забороняло Prettier лише декларативно у `.mdc`-описі. Rego-полісі покривала лише `top-level` поля та `dependencies`/`devDependencies` у `package.json`, але не `scripts`. Конфіг-файли Prettier (`.prettierignore`, `.prettierrc*`, `prettier.config.*`) перевірялися у `formatting.mjs` із хардкодованим неповним списком (5 файлів замість 12+).

## Considered Options
* Додати Rego `deny` для `package.json#scripts` і новий JS concern `forbidden-prettier.mjs` для FS-перевірки конфіг-файлів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати Rego `deny` для `package.json#scripts` і новий JS concern `forbidden-prettier.mjs`", because це відповідає наявній архітектурі runner'а (JS concerns — `rules/<id>/js/*.mjs`, Rego policy — `rules/<id>/policy/`), уникає дублювання логіки і надає програмну, тестовану перевірку замість prose-only заборони.

### Consequences
* Good, because `conftest verify` (13 Rego-тестів) і vitest (59 JS-тестів для text rule) — зелені; E2E smoke: `bun ./bin/n-cursor.js fix text` у tempdir із `.prettierignore` та `"fix": "bunx prettier --write ."` — exit 1 із двома `❌` повідомленнями.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/text/policy/package_json/package_json.rego` — новий `deny` із `script_invokes_prettier(cmd)` helper (regex `(^|[\s/"'])prettier($|[\s'"@])`)
- `npm/rules/text/policy/package_json/package_json_test.rego` — 5 нових тестів (bunx/npx/bare/path-based deny; oxfmt і `not-prettier`-substring pass)
- `npm/rules/text/js/forbidden-prettier.mjs` — новий JS concern, повний список 18 файлів (`.prettierignore`, `.prettierrc`, `.prettierrc.{json,jsonc,json5,yaml,yml,toml,js,cjs,mjs,ts,cts,mts}`, `prettier.config.{js,cjs,mjs,ts,cts,mts}`)
- `npm/rules/text/js/tests/forbidden-prettier.test.mjs` — 5 vitest-кейсів
- `npm/rules/text/js/formatting.mjs` — прибрано дублюючий inline-цикл з 5 файлів; оновлено docstring
- `npm/rules/text/text.mdc` — секція `## Перевірка` явно описує що падає на `.prettierignore`/`.prettierrc*`/`prettier.config.*` і scripts із `prettier`
- `npm/package.json` — bump `1.27.4` → `1.27.5`; `npm/CHANGELOG.md` — запис `1.27.5`
