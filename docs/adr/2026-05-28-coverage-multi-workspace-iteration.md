---
type: ADR
title: "Multi-workspace iteration у `n-cursor coverage` (per-workspace, не Vitest workspaces)"
---

# Multi-workspace iteration у `n-cursor coverage` (per-workspace, не Vitest workspaces)

**Status:** Accepted
**Date:** 2026-05-28

## Context and Problem Statement

`rules/js-lint/coverage/coverage.mjs#collect()` (до 1.28.6) брав один `jsRoot` через `resolveJsRoot(cwd)` і там запускав `vitest run --coverage` + Stryker. У реальних bun monorepo, де тести зосереджені в одному workspace (наприклад, `ai`: тести лише у `gt/`, а workspaces — `cf/*`, `run/*`, `jobs/*`, `gt`, `k8s/*`, `packages/*`, `conf-gen`), `resolveJsRoot` обирав перший workspace із `package.json` (як правило, `cf/check-ipv6`). vitest у workspace без тестів повертав `No test files found, exit 1`, провайдер кидав `JS coverage exit 1`, `bun run coverage` обривався — і так блокувався весь спосіб запуску coverage із кореня.

## Considered Options

- **A. Per-workspace iteration**: ітерувати `resolveAllJsRoots(cwd)`, запускати vitest+Stryker у кожному workspace, тихо скіпати порожні, агрегувати lcov + mutation у єдиний `JS`-рядок `COVERAGE.md`.
- **B. Native Vitest workspaces**: згенерувати `vitest.workspace.js` у корені, запускати один `vitest run --coverage` із кореня. Stryker все одно ітерувати per-workspace (`@stryker-mutator/core` про vitest workspaces не знає).
- **C. Залишити як є** із вимогою користувачу запускати coverage лише з робочого workspace.

## Decision Outcome

Chosen option: **A. Per-workspace iteration**, because (1) infra для per-workspace тулчейну вже існує — концерн `stryker_config` копіює `stryker.config.mjs` + `vitest.config.js` у кожен JS-root через той самий `resolveAllJsRoots()`; (2) Option B усе одно потребує per-workspace Stryker-проходу і додає міграційні граблі для проєктів із вручну налаштованими per-root `vitest.config.js`; (3) Option C ламає UX `bun run coverage` із кореня й суперечить контракту канонічної команди.

### Implementation

- `resolveJsRoot` стає тонким wrapper над `resolveAllJsRoots()[0] ?? null`; `resolveAllJsRoots` розгортає glob-патерни (`cf/*`, `packages/*`) через `node:fs/promises#glob`.
- `defaultRunner.runJsCoverage` додає `--passWithNoTests` → vitest у workspace без тестів повертає exit 0 із порожнім lcov.
- `collectOneRoot(jsRoot, cwd, runner)` повертає `null`, якщо lcov.totals == 0 (workspace без тестів) — Stryker не запускається. Реальні помилки (vitest exit ≠ 0, mutation.json відсутній при наявних тестах, compile errors) — throw.
- `collect(cwd)` агрегує через `addCoverage`/`addMutation` з `rules/test/coverage/coverage.mjs` (DRY). Якщо тестів немає у жодному workspace — повертає `[]`, оркестратор пише exit 1.
- Шляхи у `survived[].file` і `survived[].exampleTest.testFile` рібейзяться відносно `cwd` (`relative(cwd, jsRoot)` → `join(wsRel, file)`), щоб `coverage-fix.mjs#buildFixPrompt` коректно читав source через `join(projectRoot, file)`.

### Consequences

- Good, because `bun run coverage` із кореня тепер працює у будь-якому monorepo з частково розкиданими тестами; backward-compat для single-package збережена (resolveAllJsRoots → `[cwd]`).
- Good, because реальні помилки (compile error, test failure) не маскуються — `--passWithNoTests` впливає лише на "0 тестів", а не на "1 тест провалився".
- Neutral, because per-workspace витрати на запуск Stryker у monorepo сумуються (N workspaces × Stryker overhead); компенсація — попередній skip empty workspaces одразу після vitest, без зайвого Stryker-проходу.
- Bad, because агрегований `JS` рядок ховає per-workspace динаміку (наприклад, `gt` 80% і `packages/foo` 10% усереднюються); якщо це стане важливо — додати окремі рядки `JS:gt`, `JS:packages/foo` у наступному наростанні без breaking-change.

## More Information

Виправлено у `@nitra/cursor@1.28.6`. Контракт `runJsCoverage`/`runStryker` runner-ін'єкції збережено — існуючі тести `rules/js-lint/coverage/tests/coverage.test.mjs` адаптовано локально (no-tests тест тепер пише non-zero lcov, щоб тригернути перевірку `mutation.json`).

## Update 2026-05-28

Деталізований звіт про glob-розширення `resolveAllJsRoots()` та per-workspace iteration у `n-cursor coverage`.

**Glob-розширення `resolveAllJsRoots()`:**
- `npm/scripts/utils/resolve-js-root.mjs` — замість literal `existsSync(join(cwd, pattern))` використовується `node:fs/promises#glob` з `WORKSPACE_GLOB_IGNORE`; усуває fallback на `cwd` для патернів типу `"cf/*"`
- `npm/scripts/utils/tests/resolve-js-root.test.mjs` — додані тести `glob cf/*` і fallback
- `node:fs/promises#glob` доступний у Node 22+ і Bun 1.3+; зовнішні залежності не потрібні

**Per-workspace iteration у `js-lint` coverage-провайдері:**
- `npm/rules/js-lint/coverage/coverage.mjs` — приватний `collectOneRoot()` (повертає `null` для workspace без тестів) + публічний `collect()` (агрегує); `detect()` перевіряє всі JS-roots
- Helpers `addCoverage`, `addMutation` з `rules/test/coverage/coverage.mjs` — reuse, не дублювання
- `--passWithNoTests` (vitest 4.1.7) — workspace без тестів тихо скіпується, lcov пишеться з нулями; якщо жоден не має тестів — `collect()` повертає `[]` → exit 1 (коректна поведінка)
- Backward-compat: для single-package проєкту `resolveAllJsRoots` вироджується до `[cwd]`
- Виключено варіант native Vitest workspaces: потребував би генерування `vitest.workspace.js` у `stryker_config`-концерні та ламав би наявні per-root конфіги

**Документація:** `npm/rules/test/test.mdc` v2.5 — секція «Покриття + мутаційне тестування» доповнена абзацом про multi-root iteration.

**Тести:** `coverage.test.mjs` — кейси: monorepo з порожніми workspaces, all-empty → `[]`, single-package backward-compat; 135 тестів (24 + 111), усі green.

**Версія:** `@nitra/cursor@1.28.5` → `1.28.6`.
