---
session: 439110c7-f2a6-484a-bfa2-b1b10d6b8703
captured: 2026-05-21T16:28:17+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/439110c7-f2a6-484a-bfa2-b1b10d6b8703/439110c7-f2a6-484a-bfa2-b1b10d6b8703.jsonl
---

## ADR Фільтрація `node_modules` при зборі workspace-коренів

## Context and Problem Statement
`check changelog` (та інші правила `@nitra/cursor`) збирали список workspace-коренів через glob `**/package.json`, не виключаючи `node_modules/`. Через це транзитивні пакети (наприклад `node_modules/node-gyp/gyp`) потрапляли до списку і генерували хибне спрацювання: «відсутній `node_modules/node-gyp/gyp/CHANGELOG.md`».

## Considered Options
* Додати фільтр `node_modules/` у `workspaces.mjs` і `package-manifest.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати фільтр `node_modules/` у `workspaces.mjs` і `package-manifest.mjs`", because це усуває false positive без змін у споживацьких проєктах — фільтр знаходиться в утилітному шарі, який використовують усі правила.

### Consequences
* Good, because `getMonorepoPackageRootDirs` і `getMonorepoProjectRootDirs` більше не трактують `package.json` у `node_modules/**` як workspace-корені, що прибирає хибні помилки `check changelog`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/scripts/utils/workspaces.mjs` — додано константу `WORKSPACE_GLOB_IGNORE` (`['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**']`) для glob-запитів та функцію `isIgnoredWorkspaceRoot(ws)` для фільтрації за сегментами шляху; фінальний список у `getMonorepoPackageRootDirs` проходить через цей фільтр.
- `npm/scripts/utils/package-manifest.mjs` — імпортовано `isIgnoredWorkspaceRoot`; фільтр застосовано до коренів з `pyproject.toml` і до результату `getMonorepoProjectRootDirs`.
- `npm/scripts/utils/workspaces.test.mjs` — додано тест для `isIgnoredWorkspaceRoot` і тест що glob `**` не підхоплює `node_modules/dep/nested/package.json`.
- `npm/CHANGELOG.md` та `npm/package.json` — реліз `1.13.73`.
