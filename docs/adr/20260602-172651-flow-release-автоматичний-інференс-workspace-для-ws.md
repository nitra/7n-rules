---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T17:26:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR flow release: автоматичний інференс workspace для --ws

## Context and Problem Statement
`flow release` без `--ws` записував change-файл у корінь монорепо (`./.changes/`), хоча всі зміни лежали в підпакеті `npm/`. Кореневий воркспейс не релізиться, тому `npm/` лишався без change-файлу й порушував changelog-consistency.

## Considered Options
* Автоматичний інференс workspace зі змін від `base_commit` (авто-`--ws`, fail-soft)
* Вимагати явний `--ws` обов'язково (fail-hard без нього)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автоматичний інференс workspace зі змін від `base_commit`", because так `flow release` у звичайному single-workspace-випадку не потребує ручного `--ws`, а при кількох змінених voркспейсах (або при явно вказаному `--ws` / `--ws=value`) поведінка передбачувана: fail із повідомленням або перехід до явного аргументу.

### Consequences
* Good, because transcript фіксує очікувану користь: change-файл автоматично потрапляє до `npm/.changes/` без ручного `--ws`.
* Bad, because логіка `matchChangedWorkspaces` покриває лише прямі піддиректорії worktree; глибша вкладеність відносить файли до найглибшого workspace через сортування за довжиною.

## More Information
Реалізація: `npm/scripts/dispatcher/lib/commands.mjs` — функції `matchChangedWorkspaces`, `resolveChangeWsArgs`. Тести: `commands.test.mjs`. Коміт: `282332c` на гілці `flow-release-infer-ws`.

---

## ADR flow review: верифікація cross-file тверджень через Read

## Context and Problem Statement
Під час `flow review` рецензент (LLM subagent) видавав findings типу «з diff не видно» по referenced-файлах і spec. Більшість таких findings виявлялись нефальсифіковними або хибними після читання реальних файлів — severity витрачалась даремно.

## Considered Options
* Дозволити й зобов'язати рецензента читати referenced-файли/spec через Read (scope: лише файли, що згадані в diff або spec-ланцюжку)
* Залишити рецензента тільки в межах diff
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дозволити й зобов'язати рецензента читати referenced-файли", because cross-file твердження без верифікації читанням є нефальсифіковними; scope обмежено diff + spec, щоб не породжувати findings про pre-existing баги сусідніх файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: findings «з diff не видно» → «verified Read» або позначаються як «needs cross-file check».
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни: `npm/scripts/dispatcher/lib/review.mjs` — `reviewerPrompt`. Тест: `review.test.mjs`. Коміт `b0308d4` на `flow-review-read-access`.

---

## ADR coverage gate: Stryker з локального core замість npx

## Context and Problem Statement
`flow verify` coverage-gate падав з «Cannot find TestRunner plugin vitest» — `npx @stryker-mutator/core` завантажував core у власний npx-кеш без плагіна `vitest-runner`, тоді як локальний `node_modules/@stryker-mutator/vitest-runner` ігнорувався.

## Considered Options
* Резолвити локально встановлений `core/bin/stryker.js` через `package.json#bin` і запускати його напряму (node-shebang → завжди Node, незалежно від bun/npx-рантайму)
* Залишити `npx @stryker-mutator/core`
* Використати `bunx` замість `npx`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Резолвити локальний core через `package.json#bin` і запускати напряму", because `exports` пакета не відкриває `./bin/stryker.js` (ERR_PACKAGE_PATH_NOT_EXPORTED), тому резолв іде через `package.json` → поле `bin`; запуск через shebang гарантує Node-рантайм і видимість сусіднього `vitest-runner`.

### Consequences
* Good, because transcript фіксує e2e-валідацію: «Starting initial test run (vitest test runner…)», exit 0.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни: `npm/rules/js-lint/coverage/coverage.mjs` — `resolveLocalStrykerBin`, `runStryker`. Коміт `373ce42` на `flow-coverage-stryker-local`. e2e-валідація: `/tmp/cov-fix3.log`.

---

## ADR flow #5: WIP change-file stubs і WAL-логування хук-дій

## Context and Problem Statement
`flow run --autonomous` виконував `defaultCommit` (git add -A + git commit) після кожного кроку без change-файлу → наступний `verify` падав на changelog-consistency. PostToolUse-форматер (`fix js-lint`) змінював файли під час автономного flow без жодного запису у WAL — агент не міг відрізнити свої зміни від хук-індукованих.

## Considered Options
* `defaultCommit` створює WIP change-file stubs у змінених workspace-ах перед комітом + логує `hook_commit` у flow WAL; `runPostToolUseFixCli` логує `hook_fix` при активному flow
* Залишати staged-not-committed до `flow release` (без проміжних комітів)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "WIP stubs + WAL-логування", because staged-without-commit підхід зламав би `flow resume` (він скидає до HEAD через `git reset --hard`); WIP-stubs задовольняють changelog-consistency і замінюються при `flow release`.

### Consequences
* Good, because transcript фіксує очікувану користь: changelog-consistency не падає після step-коміту; hook-дії видимі у `.events.jsonl`.
* Bad, because `ensureWipChangeFiles` покриває лише workspace-и на глибині 1 (flat-монорепо) — вкладені воркспейси не покриваються.

## More Information
Зміни: `npm/scripts/dispatcher/lib/active.mjs` — `ensureWipChangeFiles` (export), `defaultCommit`; `npm/scripts/post-tool-use-fix.mjs` — `findActiveFlowEventsPath`, `runPostToolUseFixCli`. Коміт на `flow-hook-coordination`. Тести: `active.test.mjs`, `post-tool-use-fix.test.mjs` (219 тестів зелені).
