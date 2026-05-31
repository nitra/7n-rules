## ADR withLock: крос-worktree серіалізація важких команд

## Context and Problem Statement
Проєкт запускає кількох AI-агентів паралельно, кожен з яких може самостійно тригерити важкі CLI-команди (`lint-*`, `fix-*`, `coverage`). Наявний `withLock` зберігав стан локу в `node_modules/.cache/n-cursor/<key>/`, а `node_modules` у кожного git-worktree — свій. Унаслідок цього два агенти в різних worktree не бачили локів одне одного й могли запускати, наприклад, паралельні прогони eslint/Stryker, що перевантажувало CPU/диск.

## Considered Options
* Перенести `cacheDir` локу під `git-common-dir` (спільний для головного checkout і всіх linked-worktree)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести `cacheDir` локу під `git-common-dir`", because `git rev-parse --git-common-dir` повертає єдиний шлях, спільний для головного checkout і всіх linked-worktree; `mkdirSync`-lock за цим шляхом стає атомарним крос-worktree мьютексом.

### Consequences
* Good, because transcript фіксує очікувану користь: `withLock`-серіалізація тепер діє між усіма git-worktree — паралельний eslint/Stryker неможливий навіть при кількох linked-worktree.
* Good, because `opts.cacheDir` зберігає пріоритет — існуючі тести й прямі виклики з явним `cacheDir` не зачеплені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Новий хелпер: `npm/scripts/utils/lock-cache-dir.mjs` — `resolveLockCacheDir(key)`: `<git-common-dir>/n-cursor/<key>`, fallback на `node_modules/.cache/...` поза git-репо.
* Тести: `npm/scripts/utils/tests/lock-cache-dir.test.mjs` — 5 тест-кейсів (відносний/абсолютний common-dir, крос-worktree однаковість, обидва fallback-и).
* Зміна в `npm/scripts/utils/with-lock.mjs`: `cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)`.
* Оновлено `.cursor/rules/scripts.mdc`: додана секція «Стан локу — спільний для всіх git-worktree».
* Change-файл: `npm/.changes/1780162853358-7a418d.md` (`bump: minor`, `section: Changed`).
* Відповідний ADR про базовий `withLock` guard: `docs/adr/20260522-212907-guard-блокування-паралельних-команд.md`.
