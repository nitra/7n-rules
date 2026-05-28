---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T21:32:20+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

---

## ADR Усунення race-умови Stryker/Vitest через `process.chdir` та міграція `withTmpCwd` → `withTmpDir`

## Context and Problem Statement

Під час запуску `bun run coverage` (Stryker + `@stryker-mutator/vitest-runner`) тести `changelog/consistency` виконували `git init`/`git checkout -b feat/x` через `withTmpCwd`, що мутував `process.cwd()` глобально у спільному threads-pool. Stryker запускає vitest inline у своєму процесі, ігноруючи `pool: 'forks'` у `vitest.config.js`, тому паралельні worker'и перехоплювали мутований cwd і виконували git-команди у реальному репозиторії. Результат — rogue branches (`feat/x`, `feat/docs`, `feat/sync`) та rogue commits у `main`.

## Considered Options

* **Варіант А**: Створити окремий `vitest.stryker.config.js` з `include` обмеженим тільки на `rules/test/coverage/tests/**` — Stryker не бачить git-тести, race не спрацьовує.
* **Варіант Б**: Повний refactor `withTmpCwd` → `withTmpDir` без `process.chdir`; усі 43 тестових файли та 24 production-функції приймають явний `cwd` параметр. Доповнений трьома policy-concern'ами для попередження майбутніх регресій.

## Decision Outcome

Chosen option: "Варіант Б", because користувач вирішив усунути корінь проблеми, а не маскувати симптом, і розширити правило `test` policy-concern'ами щоб подібне не повторилось в жодному проєкті.

### Consequences

* Good, because `process.cwd()` більше не мутується у тестах — `bun run coverage` завершується без rogue commits або rogue branches незалежно від конфігурації Stryker/vitest pool.
* Good, because три нові policy-concern'и (`no-process-chdir`, `vitest-config-pool-forks`, `no-relative-fs-path`) перехоплюють майбутні регресії при `npx @nitra/cursor fix test` у будь-якому проєкті-споживачі.
* Good, because виявлено та виправлено pre-existing bug у `rules/test/coverage/coverage.mjs:192` — dynamic import шлях `../../scripts/coverage-fix.mjs` замінено на `../../../scripts/coverage-fix.mjs` (реальне розташування файлу).
* Bad, because mutation score (covered) знизився з 98.58% до 97.06%: тіло `if (opts.fix)` у `coverage.mjs:189–192` стало NoCoverage після видалення stub-стратегії, що записувала тимчасовий `rules/scripts/coverage-fix.mjs` у production-дерево.

## More Information

**Змінені файли (ключові):**
- `npm/scripts/utils/test-helpers.mjs` — `withTmpCwd` видалено, додано `withTmpDir(fn)` + валідація `isAbsolute` у `writeJson`/`ensureDir`
- `npm/rules/test/coverage/coverage.mjs:192` — виправлено шлях dynamic import
- `npm/rules/nginx-default-tpl/js/template.mjs` — `checkVscodeNginx(passFn, failFn, cwd)` тепер приймає `cwd`; внутрішні `existsSync`/`runConftestBatch` використовують `join(cwd, …)`
- `npm/tests/check-rule-fixtures.test.mjs:188-189` — `copyFile(…, 'relative')` замінено на `copyFile(…, join(dir, 'relative'))`
- 43 тестових файли — `withTmpCwd(async () => …)` → `withTmpDir(async dir => …)` з явними `join(dir, …)` і `cwd: dir`
- 24 production JS-concern'и — `check(cwd = process.cwd())`/`fix(cwd = process.cwd())`

**Нові файли:**
- `npm/rules/test/js/no-process-chdir.mjs` + `tests/no-process-chdir.test.mjs` (8 тестів) — regex-scan `process.chdir(` у `*.test.{js,mjs}`
- `npm/rules/test/js/vitest-config-pool-forks.mjs` + `tests/vitest-config-pool-forks.test.mjs` (6 тестів) — substring-перевірка `pool: 'forks'` у `vitest.config.js`
- `npm/rules/test/js/no-relative-fs-path.mjs` + `tests/no-relative-fs-path.test.mjs` (17 тестів) — AST-scan (`oxc-parser`) FS-функцій із string literal relative-path аргументами
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` — оновлено `pool: 'forks'`

**Команди верифікації:** `bun run test` (1200 passed / 2 skipped), `bunx @stryker-mutator/core run` (93.62% mutation score, без rogue commits), `bun start` (15/15 правил завантажено без помилок).

**Версія:** `@nitra/cursor` 1.27.9 → **1.28.0** (BREAKING: `withTmpCwd` видалено).
