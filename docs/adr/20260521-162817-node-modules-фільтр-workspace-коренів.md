---
type: ADR
title: "Фільтрація `node_modules` при зборі workspace-коренів у `@nitra/cursor`"
---

# Фільтрація `node_modules` при зборі workspace-коренів у `@nitra/cursor`

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

`getMonorepoPackageRootDirs` у `npm/scripts/utils/workspaces.mjs` збирав `package.json`-файли без виключення шляхів всередині `node_modules/`. Через це `check changelog` (і будь-яка інша перевірка, що спирається на `getMonorepoProjectRootDirs`) трактував транзитивні залежності — наприклад `node_modules/node-gyp/gyp` — як повноцінні workspace-корені та вимагав для них `CHANGELOG.md`. Аналогічний glob для `pyproject.toml` вже мав `ignore: ['**/node_modules/**', ...]`, а для npm `workspaces` — ні.

## Considered Options

- Додати фільтр `node_modules/`, `.git`, `.venv`, `venv` до `ignore`-списку glob-пошуку workspace-коренів у `workspaces.mjs` і `package-manifest.mjs`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати константу `WORKSPACE_GLOB_IGNORE` та функцію `isIgnoredWorkspaceRoot` у `workspaces.mjs`", because це усуває false-positive на транзитивні залежності без змін у споживацьких проєктах — фільтр знаходиться в утилітному шарі, який використовують усі правила.

### Consequences

- Good, because `check changelog` і споріднені перевірки більше не помилково вимагають `CHANGELOG.md` у пакетах всередині `node_modules/`.
- Good, because рішення усуває непослідовність між `pyproject.toml`-гілкою (вже мала `ignore`) і npm `workspaces`-гілкою.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:
- `npm/scripts/utils/workspaces.mjs` — константа `WORKSPACE_GLOB_IGNORE` (`['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**']`) передається як `ignore` до `glob()`; `isIgnoredWorkspaceRoot(ws)` фільтрує явно задані workspace-записи за сегментами шляху.
- `npm/scripts/utils/package-manifest.mjs` — імпортовано `isIgnoredWorkspaceRoot`; застосовано до коренів із `pyproject.toml` і до фінального результату `getMonorepoProjectRootDirs`.
- `npm/scripts/utils/workspaces.test.mjs` — тест: glob `**` не підхоплює `node_modules/dep/nested/package.json`; тест для `isIgnoredWorkspaceRoot`.
- `npm/CHANGELOG.md` та `npm/package.json` — реліз `1.13.73`.

Діагностична команда з transcript:
```bash
node -e "
import { getMonorepoProjectRootDirs } from './node_modules/@nitra/cursor/scripts/utils/package-manifest.mjs';
const ws = await getMonorepoProjectRootDirs(process.cwd());
console.log(ws.filter(w => w.includes('node_modules')).slice(0, 20));
"
```
