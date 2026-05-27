---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-27T16:30:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

## ADR Повна заміна `withTmpCwd` на `withTmpDir` (без `process.chdir`)

## Context and Problem Statement
Під час запуску Stryker mutation testing усі test-файли виконувалися inline в одному процесі. Хелпер `withTmpCwd` у `npm/scripts/utils/test-helpers.mjs` викликав `process.chdir(tmpDir)` — process-wide мутацію. У паралельному пулі потоків Vitest (`pool: 'threads'`) це спричиняло race condition: тести `rules/changelog/js/tests/consistency/tests/check.test.mjs`, які виконували `git init` + `git commit -m init` з `user.email=test@test`, перехоплювали `cwd` реального репозиторію — і `init`-коміт потрапляв у справжній git history, знищуючи `npm/CHANGELOG.md`, `npm/package.json` та інші файли.

## Considered Options
* Окремий `vitest.stryker.config.js`, що обмежує `include` лише для `rules/test/coverage/tests/**` — Stryker не бачив би git-тести (симптоматично)
* Встановити `pool: 'forks'` у `vitest.config.js` — ізолює процеси при прямому запуску vitest, але ігнорується Stryker inline-runner
* Видалити `withTmpCwd` повністю, замінити на `withTmpDir(async dir => …)` без виклику `process.chdir` — корінна причина

## Decision Outcome
Chosen option: "Видалити `withTmpCwd` повністю, замінити на `withTmpDir`", because `process.chdir` є process-wide операцією, несумісною з будь-яким паралельним запуском (Vitest threads, Stryker inline, майбутні воркер-пули). Симптоматичні фікси (config split, `pool: 'forks'`) не захищали б від нових race-умов при розширенні `mutate`-цілей Stryker. Рефакторинг усунув root cause назавжди: 43 тестових файли переписані явними `join(dir, …)` і `cwd: dir` параметрами; 24 production-функції (`check`/`fix` у `rules/*/js/*.mjs`) отримали `cwd` параметр зі значенням за замовчуванням `process.cwd()`.

### Consequences
* Good, because transcript фіксує очікувану користь: повний `bun run test` (1200 passed) і Stryker run завершились без жодного rogue-коміту у git history.
* Bad, because `withTmpCwd` — breaking API change: версія bumped до `1.28.0`; усі зовнішні споживачі `test-helpers.mjs` мають оновити виклики.

## More Information
- Файл хелпера: `npm/scripts/utils/test-helpers.mjs` — `withTmpCwd` видалено, додано `withTmpDir`
- Файл конфігу Vitest: `npm/vitest.config.js` — `pool: 'forks'` залишено як defense-in-depth
- Зачеплені production-файли: `rules/abie/js/applies.mjs`, `rules/abie/js/hc_pairing.mjs`, `rules/abie/js/firebase_hosting.mjs` та ще ~21 файл
- Додатково виправлено баг: `npm/rules/test/coverage/coverage.mjs:192` — неправильний відносний шлях `../../scripts/coverage-fix.mjs` (вів у `rules/scripts/`, де файл відсутній) виправлено на `../../../scripts/coverage-fix.mjs`
- Версія: `npm/package.json` bumped `1.27.9` → `1.28.0`; секція `## [1.28.0] - 2026-05-27` додана до `npm/CHANGELOG.md`

---

## ADR Нові lint-правила проти `process.chdir` і відсутності `pool: 'forks'` у vitest-конфігу

## Context and Problem Statement
Після повного рефакторингу `withTmpCwd → withTmpDir` необхідно гарантувати, що майбутні зміни не реінтродукують `process.chdir` у тестах і не видалять `pool: 'forks'` з `vitest.config.js`. Без автоматичної перевірки правило існуватиме лише у документації, і перша ж помилкова зміна відновить race condition.

## Considered Options
* Лише оновити документацію `test.mdc` (без автоматизованої перевірки)
* Додати JS concerns + оновити `test.mdc`

## Decision Outcome
Chosen option: "Додати JS concerns + оновити `test.mdc`", because ручна документація не запобігає регресіям; автоматичні concerns, які падають з `❌` при `npx @nitra/cursor fix test`, є єдиним надійним захистом.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run test` (103 test files passed) підтвердив що нові concerns `no-process-chdir.test.mjs` (8 tests) і `vitest-config-pool-forks.test.mjs` (6 tests) зелені.
* Bad, because `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` оновлено — проєкти, що використовують baseline без `pool: 'forks'`, отримають нове порушення при наступному `fix test`.

## More Information
- `npm/rules/test/js/no-process-chdir.mjs` — сканує `**/*.test.{js,mjs}` на присутність `process.chdir(`; падає з `❌` при знахідці
- `npm/rules/test/js/tests/no-process-chdir.test.mjs` — 8 тестів (happy path, multi-match, `*.test.js`, порожній проєкт тощо)
- `npm/rules/test/js/vitest-config-pool-forks.mjs` — перевіряє що `vitest.config.js` містить `pool: 'forks'`; падає якщо файл відсутній або `pool` не `'forks'`
- `npm/rules/test/js/tests/vitest-config-pool-forks.test.mjs` — 6 тестів
- `npm/rules/test/js/data/vitest_config/vitest.config.baseline.js` — `pool: 'forks'` додано до canonical baseline
- `npm/rules/test/test.mdc` — додано секцію «Заборона `process.chdir` у тестах» із поясненням механізму race і посиланням на Vitest `pool: 'forks'`
