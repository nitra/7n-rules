---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-30T21:01:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Крос-worktree серіалізація `withLock` через git-common-dir

## Context and Problem Statement

`withLock` зберігав стан локу (lock-директорія + dedup-кеш) у `node_modules/.cache/n-cursor/<key>/` поточної CWD. Оскільки кожен git-worktree має власний `node_modules`, важкі CLI-команди (`lint-*`, `fix-*`, Stryker), запущені паралельно у різних worktree, не бачили локів одне одного — паралельний eslint/Stryker міг запускатись одночасно всупереч явній забороні.

## Considered Options

* Мітка (sentinel) у назві git-worktree: перевірка через `git worktree list | grep <label>` перед запуском
* Перенести `cacheDir` до git-common-dir: спільного каталогу `.git/` для головного checkout і всіх linked-worktree (`git rev-parse --git-common-dir`), зберігши PID-liveness + dedup-fingerprint незмінними

## Decision Outcome

Chosen option: "Перенести `cacheDir` до git-common-dir", because підхід «мітка в назві worktree» має структурні вади: stale-мітка після краш/нормального завершення, TOCTOU-гонка між двома агентами, яка не гарантує атомарності, і неможливість зловити `bun run lint`, запущений напряму поза worktree. Наявний `mkdirSync`-атомарний lock та PID-liveness у `withLock` уже вирішують ці проблеми — потрібно лише перемістити `cacheDir` у спільний `<git-common-dir>/n-cursor/<key>/` замість per-worktree `node_modules/.cache/`.

### Consequences

* Good, because `mkdirSync`-mutex у `.git/` головного репо є спільним для всіх linked-worktree — важкі команди серіалізуються на рівні машини, а не лише в межах одного checkout.
* Good, because `opts.cacheDir` зберігає пріоритет, тому тести й виклики, які явно передають `cacheDir`, не зачіпаються.
* Good, because fingerprint лишився per-tree (sha256 від `HEAD + git diff + untracked`): worktree на різних гілках не дедуплять прогони одне одного помилково.
* Good, because fallback на `node_modules/.cache/...` активується автоматично поза git-репо (наприклад, у CI-пісочниці без `.git/`).
* Bad, because transcript не містить підтверджених негативних наслідків. Потенційний: якщо `.git/` змонтований read-only (окремі CI-конфігурації), `resolveLockCacheDir` впаде — але такий сценарій у transcript не обговорювався.

## More Information

Змінені/створені файли:
- `npm/scripts/utils/lock-cache-dir.mjs` — новий хелпер `resolveLockCacheDir(key)`, використовує `git rev-parse --git-common-dir` (inject-able через параметр `spawn` для тестів); fallback на `node_modules/.cache/n-cursor/<key>` поза git.
- `npm/scripts/utils/tests/lock-cache-dir.test.mjs` — 5 тестів: відносний/абсолютний git-common-dir, крос-worktree однаковість шляху, fallback-и.
- `npm/scripts/utils/with-lock.mjs` — рядок `cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)` (замість inline `process.cwd()/node_modules/.cache`).
- `.cursor/rules/scripts.mdc` — нова секція «Стан локу — спільний для всіх git-worktree».
- `npm/.changes/1780162853358-7a418d.md` — change-файл `bump: minor`, `section: Changed`.

Тести після зміни: `scripts/utils/` — 56/56 ✓; `fix changelog` → exit 0 ✓. ADR-попередники: `docs/adr/20260522-*-guard-блокування.md`, `docs/adr/20260523-*-withlock-серіалізація.md`.
