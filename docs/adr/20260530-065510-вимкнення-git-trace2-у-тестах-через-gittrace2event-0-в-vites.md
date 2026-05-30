---
session: ccb64475-231f-4295-9ef5-5d869887751c
captured: 2026-05-30T06:55:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ccb64475-231f-4295-9ef5-5d869887751c.jsonl
---

## ADR Вимкнення git Trace2 у тестах через `GIT_TRACE2_EVENT: '0'` в `vitest.config.js`

## Context and Problem Statement
git-залежні vitest-тести у `npm/rules/changelog/` та `npm/rules/ga/` таймаутять виключно локально (23 failed, 187с; CI завжди зелена). Кожна git-команда в tmp-репо, створеному в `withTmpDir`, успадковує глобальний `~/.gitconfig` з `trace2.eventtarget=af_unix:stream:/Users/vitaliytv/.git-ai/internal/daemon/trace2.sock`. Коли даемон `git-ai` деградує, кожен `connect()`/`write()` у сокет блокується (~1с wall при user 0.06 + sys 0.09), а під `pool: 'forks'` десятки паралельних git-операцій (`check.test.mjs` виконує 5–7 git-ops/тест) перевищують `testTimeout: 5000ms`.

## Considered Options
* `env: { GIT_TRACE2_EVENT: '0' }` у `vitest.config.js` — вимикає trace2-stream для всіх git-дочірніх процесів у тестах
* `--no-file-parallelism` або `poolOptions.forks.singleFork` — усуває паралелізм форків, але не усуває залежність від стану даемона
* Підвищити `testTimeout` глобально без усунення trace2-залежності — маскує, але не виправляє недетерміновану зовнішню залежність
* Спільний bare-repo fixture замість `git init` у кожному тесті — зменшує кількість git-операцій, але залежність від trace2-сокета залишається

## Decision Outcome
Chosen option: `env: { GIT_TRACE2_EVENT: '0' }` у `vitest.config.js`, because env-змінна має пріоритет над config-таргетом і повністю прибирає недетерміновану зовнішню залежність (стан `git-ai`-даемона) з гарячого шляху: синтетичні tmp-репо git-операції не повинні потрапляти в AI-інструментацію, і фікс коректний незалежно від стану даемона. Контрольний прогін із явним `GIT_TRACE2_EVENT=0` до офіційного фіксу дав 36 passed / ~8с — пряме підтвердження причинності.

### Consequences
* Good, because `bun run vitest run rules/changelog/` після фіксу: 36 passed, ~7с (було 23 failed, 187с); відтворювано двічі поспіль.
* Good, because централізований фікс у `vitest.config.js` покриває обидва git-залежні suite (`rules/changelog/`, `rules/ga/`) без змін у тест-коді.
* Good, because transcript фіксує очікувану користь: повний `bun run test` — 1248 passed | 2 skipped, 0 failures, 20.9с.
* Bad, because деградований стан даемона не вдалось відтворити штучно (сьогодні даемон здоровий) — механізм патології доведений непрямо; виключити інші причини (APFS/Spotlight) не можна на 100%.

## More Information
- Змінений файл: `npm/vitest.config.js` — секція `test.env: { GIT_TRACE2_EVENT: '0' }`
- Глобальна причина: `git config --global trace2.eventtarget` → `af_unix:stream:/Users/vitaliytv/.git-ai/internal/daemon/trace2.sock`
- CI не вражена: `trace2.eventtarget` у CI-середовищі не задано
- git-залежні тести: `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs`, `npm/rules/ga/js/tests/workflows.test.mjs`

---

## ADR `testTimeout: 20000ms` як defence-in-depth для git-залежних тестів

## Context and Problem Statement
Після усунення trace2-залежності git-команди в тестах виконуються на APFS-томі під можливим навантаженням Spotlight-індексування; замірювана локальна латентність без trace2 — ~1с/commit (user 0.06 + sys 0.09). Дефолтний `testTimeout: 5000ms` залишає нульовий запас: штатна тривалість suite ~7–8с при паралельних форках.

## Considered Options
* Залишити дефолтний `testTimeout: 5000ms`
* Підвищити `testTimeout: 20000ms`

## Decision Outcome
Chosen option: `testTimeout: 20000`, because після усунення root-cause (trace2) штатна тривалість одного git-важкого тест-файлу ~7с, тож 20с дає достатній запас без маскування реальних зависань; значення явно вказане в постановці задачі як допустимий фікс для сценарію «реальна git-латентність».

### Consequences
* Good, because transcript фіксує очікувану користь: страховка від залишкової APFS/Spotlight/AV-латентності, незалежно від стану `git-ai`-даемона.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/vitest.config.js` — секція `test.testTimeout: 20000`
- Штатна тривалість `rules/changelog/` suite після фіксу: ~7–8с (36 тестів)
- Записано у `npm/CHANGELOG.md` під `### Fixed` в релізі `1.31.0`
