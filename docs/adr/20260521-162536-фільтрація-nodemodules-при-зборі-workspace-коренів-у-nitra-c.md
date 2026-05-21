---
session: 439110c7-f2a6-484a-bfa2-b1b10d6b8703
captured: 2026-05-21T16:25:36+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/439110c7-f2a6-484a-bfa2-b1b10d6b8703/439110c7-f2a6-484a-bfa2-b1b10d6b8703.jsonl
---

## ADR Фільтрація `node_modules` при зборі workspace-коренів у `@nitra/cursor`

## Context and Problem Statement

При запуску `/n-fix` (або `npx @nitra/cursor check`) правило `changelog` збирає список workspace-каталогів із `package.json` і перевіряє наявність `CHANGELOG.md` для кожного. Якщо в кореневому `package.json` вказаний широкий glob у полі `"workspaces"`, до списку потрапляють каталоги з `node_modules`, зокрема вкладені пакети на кшталт `node_modules/node-gyp/gyp` — і правило видає false-positive: `відсутній node_modules/node-gyp/gyp/CHANGELOG.md`.

## Considered Options

* Додати фільтр `node_modules/` у `getMonorepoPackageRootDirs` / `workspaces.mjs`
* Залишити поточну поведінку без фільтра (покладатися на те, що `"workspaces"` у користувача завжди звужений)

## Decision Outcome

Chosen option: "Додати фільтр `node_modules/` у `workspaces.mjs`", because transcript підтверджує: glob для `pyproject.toml` вже має `ignore: ['**/node_modules/**', ...]`, а аналогічний захист для npm-workspaces відсутній — це непослідовність, яку асистент ідентифікував як корінь проблеми.

### Consequences

* Good, because правило `changelog` перестане видавати false-positive для транзитивних залежностей із власним `package.json` (наприклад, `node-gyp/gyp`), незалежно від того, наскільки широкий glob у `"workspaces"` проєкту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файл з gap-ом: `npm/scripts/utils/workspaces.mjs` — відсутній `ignore: ['**/node_modules/**']` при зборі workspace-коренів через npm `workspaces`.
- Файл з коректним прикладом: `npm/scripts/utils/package-manifest.mjs` — glob для `pyproject.toml` вже фільтрує `node_modules/`.
- Запропонований діагностичний скрипт із transcript:
```bash
node -e "
import { getMonorepoProjectRootDirs } from './node_modules/@nitra/cursor/scripts/utils/package-manifest.mjs';
const ws = await getMonorepoProjectRootDirs(process.cwd());
console.log(ws.filter(w => w.includes('node_modules')).slice(0, 20));
"
```
- Аналогічно рекомендовано виключати `.git/` та `.venv/` у тому ж місці.
- Пакет: `@nitra/cursor`; правило: `changelog`; утиліта: `workspaces.mjs` / `getMonorepoPackageRootDirs`.
