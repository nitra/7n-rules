---
session: 439110c7-f2a6-484a-bfa2-b1b10d6b8703
captured: 2026-05-21T16:28:18+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/439110c7-f2a6-484a-bfa2-b1b10d6b8703/439110c7-f2a6-484a-bfa2-b1b10d6b8703.jsonl
---

## ADR Фільтрація `node_modules` при зборі workspace-коренів

## Context and Problem Statement
`getMonorepoPackageRootDirs` у `npm/scripts/utils/workspaces.mjs` збирав `package.json`-файли без виключення шляхів усередині `node_modules/`. Через це `check changelog` (і будь-яка інша перевірка, що спирається на `getMonorepoProjectRootDirs`) трактував транзитивні залежності, наприклад `node_modules/node-gyp/gyp`, як повноцінні workspace-корені та вимагав для них `CHANGELOG.md`.

## Considered Options
* Додати `node_modules/`, `.git`, `.venv`, `venv` до `ignore`-списку glob-пошуку workspace-коренів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `node_modules/`, `.git`, `.venv`, `venv` до `ignore`-списку glob-пошуку workspace-коренів", because це усуває false-positive на транзитивні залежності без зміни семантики для реальних workspace-пакетів.

### Consequences
* Good, because `check changelog` і споріднені перевірки більше не помилково вимагають `CHANGELOG.md` у пакетах всередині `node_modules/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/scripts/utils/workspaces.mjs`, `npm/scripts/utils/package-manifest.mjs`, `npm/scripts/utils/workspaces.test.mjs`, `npm/CHANGELOG.md`, `npm/package.json`.

Конкретні зміни:
- `workspaces.mjs`: додано константу `WORKSPACE_GLOB_IGNORE` (`['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**']`), що передається як `ignore` до `glob()`; та експортовано `isIgnoredWorkspaceRoot(ws)` — фільтр за сегментами шляху для явно заданих workspace-записів.
- `package-manifest.mjs`: імпортовано `isIgnoredWorkspaceRoot`, застосовано до коренів із `pyproject.toml` і до фінального списку `getMonorepoProjectRootDirs`.
- Тест: glob-патерн `**` не підхоплює `node_modules/dep/nested/package.json`.
- Версія пакета підвищена до `1.13.73`; запис у `CHANGELOG.md` під секцією `### Fixed`.
