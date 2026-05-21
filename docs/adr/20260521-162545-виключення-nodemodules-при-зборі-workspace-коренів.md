---
session: 439110c7-f2a6-484a-bfa2-b1b10d6b8703
captured: 2026-05-21T16:25:45+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/439110c7-f2a6-484a-bfa2-b1b10d6b8703/439110c7-f2a6-484a-bfa2-b1b10d6b8703.jsonl
---

## ADR Виключення `node_modules` при зборі workspace-коренів

## Context and Problem Statement
При запуску `/n-fix` (через `npx @nitra/cursor check`) правило `changelog` отримувало шляхи на кшталт `node_modules/node-gyp/gyp` у списку workspace-коренів і виводило false-positive помилку «відсутній `node_modules/node-gyp/gyp/CHANGELOG.md`». Причина: функція `getMonorepoPackageRootDirs` у `npm/scripts/utils/workspaces.mjs` не фільтрує `node_modules/`, хоча аналогічний glob для `pyproject.toml` такий `ignore` має.

## Considered Options
* Додати фільтр `node_modules/`, `.git/`, `.venv/` у `getMonorepoPackageRootDirs` / `workspaces.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати фільтр `node_modules/`, `.git/`, `.venv/` у `getMonorepoPackageRootDirs`", because transcript підтверджує: для `pyproject.toml`-гілки цей ignore вже є, а для npm `workspaces` — відсутній; без фільтра транзитивні пакети в `node_modules` потрапляють у список і породжують false positives.

### Consequences
* Good, because `check changelog` (і будь-яке інше правило, що ітерує workspace-корені) перестане чіпати транзитивні пакети в `node_modules`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Файл з прогалиною: `npm/scripts/utils/workspaces.mjs` — функція `getMonorepoPackageRootDirs`
* Для порівняння: `pyproject.toml`-glob у тому ж пакеті вже містить `ignore: ['**/node_modules/**', ...]`
* Файл правила changelog: `npm/rules/changelog/fix/consistency/check.mjs`
* Діагностична команда зі transcript:
```bash
node -e "
import { getMonorepoProjectRootDirs } from './node_modules/@nitra/cursor/scripts/utils/package-manifest.mjs';
const ws = await getMonorepoProjectRootDirs(process.cwd());
console.log(ws.filter(w => w.includes('node_modules')).slice(0, 20));
"
```
* Конкретний приклад false positive: `node_modules/node-gyp/gyp/package.json` потрапляв у список, бо `workspaces`-патерн у `package.json` цільового проєкту достатньо широкий.
