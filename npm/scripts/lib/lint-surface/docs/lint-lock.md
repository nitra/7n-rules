---
type: JS Module
title: lint-lock.mjs
resource: npm/scripts/lib/lint-surface/lint-lock.mjs
docgen:
  crc: 076dc0bf
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 80
---

## Огляд

Глобальна черга запусків `n-rules lint --full`: у кожен момент на машині
виконується щонайбільше один **full**-прогін, наступні чекають у черзі й
стартують після звільнення лока. Рішення spec-дискусії 2026-07-03 (ревізія):
лок береться **лише** на `--full` — дельта/scoped/`--no-fix` запуски короткі
й ідуть без черги; довгі whole-tree прогони серіалізуються та отримують
видимість: процес у черзі показує свою позицію, решту черги і живий
прогрес-бар активного прогону (читає його зі стан-файлу).
`hook --post-tool-use` лок не бере: read-only, per-file, відповідає миттєво.

Механіка — наявний {@link withLock} (mkdir-лок, перехоплення лока мертвого PID,
poll-черга, TTL-дедуплікація за fingerprint) з відмінностями від per-rule
використання (`run-standard-lint.mjs`):
  - `cacheDir` у `os.tmpdir()` замість `<git-common-dir>` → скоуп machine-wide
    (на macOS tmpdir per-user), а не per-repo;
  - fingerprint дедуплікації домішує варіант виклику (rules/`--no-fix`/cwd) до
    знімка дерева — інакше scoped-успіх хибно пропускав би ширший прогін;
  - `staleThreshold` піднято до 6 год: дефолтні 30 хв «перехоплювали» б живий
    лок довгого прогону; краші покриває PID-перевірка;
  - `waitTimeout` 45 хв (full-прогони довгі), далі fail-closed (Error, exit 1),
    а не дефолтний `run-unlocked` — мовчазний паралельний запуск це саме те,
    що черга має унеможливити.

Спільний стан у `GLOBAL_CACHE_DIR`:
  - `lock/owner.json` — власник лока (пише withLock; pid/cwd/startedAt);
  - `queue/<enqueuedAt>-<pid>.json` — реєстрація процесів у черзі (для списку);
  - `progress.json` — знімок прогресу активного прогону (пише publisher
    через `createProgressReporter({ onUpdate })`, читають процеси в черзі).

## Публічний API

- GLOBAL_CACHE_DIR — Machine-wide директорія стану лока/черги — спільна для всіх репо й worktree.
- lintLockFingerprint — Fingerprint для TTL-дедуплікації: стан робочого дерева + варіант виклику lint.
null (→ дедуплікація вимкнена, черга працює) коли:
  - не в git-репо (worktreeFingerprint дасть null);
  - `--cwd` вказує не на процесний cwd — git-команди fingerprint-а виконуються
    у `process.cwd()`, тож знімок відповідав би не тому дереву, що лінтиться.
- createProgressPublisher — Publisher прогресу активного прогону: приймає знімки від
`createProgressReporter({ onUpdate })` і (throttled) пише їх у стан-файл,
звідки процеси в черзі читають прогрес-бар активного прогону.
- readOwnerProgress — Читає знімок прогресу активного прогону; null, якщо файла нема, він
застарілий або належить не поточному власнику лока.
- renderWaitLine — Рядок стану черги для процесу, що стоїть у черзі: позиція, хто працює (pid + тека),
прогрес-бар власника і перелік решти черги.
- withGlobalLintLock — Виконує `runFn` під глобальним локом full-прогонів. Не-full варіанти
(дельта/scoped/`--no-fix`) виконуються одразу, без лока й черги.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/lint-lock.test.mjs` (lintLockFingerprint — дедуп-ключ: дерево + варіант виклику (spec 2026-07-03); withGlobalLintLock — лок лише для --full (spec 2026-07-03, ревізія)) — null при --cwd не на процесний cwd: знімок дерева відповідав би не тому дереву; null поза git-репо (tree-fingerprint null); той самий варіант на тому самому дереві → стабільний fingerprint; порядок rules не впливає: lint js text ≡ lint text js; інший варіант (--no-fix, rules) → інший fingerprint: scoped-успіх не маскує ширший прогін; ще 12

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
