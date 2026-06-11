# Жорсткий root-guard для деструктивних CLI-команд та `requireRoot` у `meta.json`

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement

CLI `@nitra/cursor` (бінар `npm/bin/n-cursor.js`) при виклику без підкоманди (default sync) або з деструктивними підкомандами скаффолдить `.cursor/`, `.claude/`, `CLAUDE.md`, `.n-cursor.json` і виконує `bun install` у `process.cwd()`. При прямому виклику бінаря з піддиректорії git-репо всі артефакти записуються не в корінь. Захист через LLM soft-preflight не надійний — агент може його пропустити. Для in-place скілів (`worktree: false`) не було явного машиночитаного маркера захисту.

## Considered Options

* Програмний hard-guard (`assertCwdIsProjectRoot`) у диспетчері `bin/n-cursor.js` + підсилений worktree-preflight + декларативний атрибут `requireRoot` у `meta.json`
* Обмежитись лише CLI-гардом (без meta-флага і без зміни preflight)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Три рівні захисту: CLI hard-guard + підсилений worktree-preflight + `requireRoot` у `meta.json`", because користувач явно запросив всі три рівні й декларативний атрибут для видимості захисту на рівні метаданих скіла. Guard перевіряє `git rev-parse --show-toplevel` проти `cwd()`: піддиректорія → `exit 1` до першої мутації; поза git-репо → пропускається (легітимний сценарій ініціалізації).

### Consequences

* Good, because `ROOT_GUARDED_COMMANDS = {default-sync, fix, check, lint, coverage, change, release}` перехоплює деструктивні CLI-шляхи хардом незалежно від LLM; worktree-preflight тепер ловить старт із піддиректорії ще до `cd`.
* Good, because `skillRequiresRoot(meta)` = `worktree === true || requireRoot === true` — явна машиночитана ознака захисту на рівні метаданих скіла, перевірена валідатором.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/scripts/lib/assert-project-root.mjs` — guard-модуль із `assertCwdIsProjectRoot(command?)`.
- `npm/bin/n-cursor.js` — константа `ROOT_GUARDED_COMMANDS` (Set), `describeRootGuardedAction`, виклик guard'а перед `switch`.
- `npm/scripts/lib/root-notice.mjs` — `injectRootNotice(content, requireRoot)` для in-place скілів.
- `npm/scripts/lib/worktree-notice.mjs` — підсилено: root-assert крок перед `cd .worktrees/<…>`.
- `npm/scripts/lib/skill-meta.mjs` — `skillRequiresRoot(meta)`.
- `npm/rules/npm-module/js/skill_meta.mjs` — валідація: `requireRoot` опційний boolean; `worktree:true + requireRoot:false` → fail.
- `meta.json` скілів: `start-check: {requireRoot:true}`; `llm-patch`, `publish-telegram`, `worktree`: `{requireRoot:false}`.
- Тести: 67/67 зелених у 8 файлах; 599/599 у 64 файлах (lib + npm-module).
- Change-файли: `npm/.changes/1780502307466-1f274e.md` (minor/Added) та `npm/.changes/1780503674512-af6d99.md` (minor/Added).
- Тест прямого виклику: `bun ./n-cursor.js fix` з `npm/bin/` → `exit=1` з підказкою `cd <root>`, git status чистий після тесту.
- Окремий фікс цієї сесії: directional semver у `n-changelog` consistency check — `version > опублікованої → fail`; `version < опублікованої → pass` з підказкою «локаль відстала». Файл: `npm/rules/changelog/js/consistency.mjs` (хелпери `compareSemverCore`, `versionIsAhead`). Тести: 103/103. Change-файл: `npm/.changes/1780505556620-0f7c17.md`.

## Update 2026-06-03

Аналіз деструктивності скілів при запуску поза коренем (передував реалізації guard'а):

| Скіл | Ризик | Тип захисту |
|---|---|---|
| `fix` | Критичний | CLI hard-guard (`ROOT_GUARDED_COMMANDS`) |
| `taze` | Критичний | worktree preflight |
| `docgen` | Середній | worktree preflight |
| `lint` | Низький | `bun run lint` знаходить корінь сам |
| `adr-normalize` | Критичний | worktree preflight |
| `coverage-fix` | Критичний | worktree preflight |
| `fix-tests` | Критичний | worktree preflight |
| `start-check` | Немає | — |
| `llm-patch` | Немає | — |
| `publish-telegram` | Немає | — |
| `worktree` | Мінімальний | Частково |

`bun run start` не потребує guard'а — `bun run` автоматично скидає `cwd` на корінь пакета; небезпечний лише прямий виклик бінаря.
