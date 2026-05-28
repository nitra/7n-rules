---
session: 1f490831-7c54-4b01-ba0e-38ef9fbc5d0c
captured: 2026-05-28T15:40:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f490831-7c54-4b01-ba0e-38ef9fbc5d0c.jsonl
---

## ADR Glob-розширення в `resolveAllJsRoots()` для workspace-патернів

## Context and Problem Statement

`resolveAllJsRoots()` у `npm/scripts/utils/resolve-js-root.mjs` обходила `workspaces` як literal-шляхи. Якщо `package.json` містив glob-патерн (`"cf/*"`) — `existsSync(join(cwd, "cf/*"))` повертав `false`, функція падала на fallback і повертала корінь `cwd`. `bun run coverage` запускав vitest у корені монорепо, де нема `vitest.config.js` → `gt/tests/setup.mjs` не підвантажувався → `ref is not defined`.

## Considered Options

* Розгортати glob-патерни через `node:fs/promises#glob` усередині `resolveAllJsRoots()` перед перевіркою `existsSync`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Розгортання glob-патернів через `node:fs/promises#glob`", because це усуває fallback на `cwd` без зовнішніх залежностей (`fast-glob`, `tinyglobby`): `node:fs/promises#glob` присутній у Node 22+ і Bun 1.3+, що використовується в репо-споживачі.

### Consequences

* Good, because `resolveAllJsRoots()` тепер правильно повертає `["/path/cf/a", "/path/cf/b", ...]` для `"cf/*"` і подібних патернів без будь-яких зовнішніх залежностей.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файл: `npm/scripts/utils/resolve-js-root.mjs` (glob-ітерація з `WORKSPACE_GLOB_IGNORE`)
- Тести: `npm/scripts/utils/tests/resolve-js-root.test.mjs` — додані тести `glob cf/*` і fallback
- Версія: `@nitra/cursor@1.28.5`

---

## ADR Per-workspace iteration у `n-cursor coverage` замість Vitest workspaces

## Context and Problem Statement

`rules/js-lint/coverage/coverage.mjs:collect()` використовував єдиний `jsRoot` (перший результат `resolveJsRoot()`). У реальному монорепо `ai` (7+ workspaces, тести лише у `gt/`) `resolveJsRoot()` повертав `cf/check-ipv6` — перший literal-матч `cf/*`. Там тестів нема: vitest виходив з кодом 1 (`No test files found`), провайдер кидав `Error: JS coverage exit 1` і `bun run coverage` обривався.

## Considered Options

* **Per-workspace iteration** — `collect()` ітерує `resolveAllJsRoots(cwd)`, запускає vitest + Stryker у кожному root, агрегує через `addCoverage`/`addMutation`; workspace без тестів скіпується завдяки `--passWithNoTests` (exit 0, lcov із нулями)
* **Native Vitest workspaces** — генерувати `vitest.workspace.js` у корені через концерн `stryker_config`, запускати один `vitest run --coverage`

## Decision Outcome

Chosen option: "Per-workspace iteration", because варіант з Vitest workspaces потребував: (a) генерування `vitest.workspace.js` у `stryker_config`-концерні замість per-root `vitest.config.js`; (b) Stryker все одно ітерував би per-workspace (`@stryker-mutator/core` не знає про vitest workspaces); (c) breaking-changes для проєктів з per-root `vitest.config.js`, налаштованих вручну. Per-workspace iteration є мінімальною зміною і backward-compatible для single-package проєктів (`resolveAllJsRoots` вироджується до `[cwd]`).

### Consequences

* Good, because workspace без тестів тихо скіпується: `--passWithNoTests` робить vitest non-failing, lcov пишеться з нулями, `addCoverage` агрегує без помилки; реальні помилки компіляції/тестів не маскуються.
* Good, because transcript фіксує очікувану користь: backward-compat для single-package проєктів (dog-food `@nitra/cursor` сам) підтверджений збереженням існуючих 17/17 тестів у `coverage.test.mjs`.
* Bad, because якщо жоден workspace не має тестів — `collect()` повертає `[]` і оркестратор завершується exit 1; transcript розглядає це як коректну поведінку, а не дефект.

## More Information

- Файл: `npm/rules/js-lint/coverage/coverage.mjs` — `collectOneRoot()` (приватний, повертає `null` для no-tests) + `collect()` (публічний, агрегує)
- Helpers: `addCoverage`, `addMutation` з `rules/test/coverage/coverage.mjs` (reuse, не копія)
- Flag: `--passWithNoTests` (vitest 4.1.7, підтверджений `bunx vitest --help`)
- Тести: `rules/js-lint/coverage/tests/coverage.test.mjs` — кейси: monorepo з порожніми ws, all-empty → `[]`, single-package backward-compat
- Документація: `npm/rules/test/test.mdc` v2.5 — секція "Покриття + мутаційне тестування" доповнена абзацом про multi-root iteration
- Версія: `@nitra/cursor@1.28.6`
