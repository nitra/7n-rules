---
session: 748f86db-97db-4b20-81dd-f9fe88d716b5
captured: 2026-05-20T10:45:34+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/748f86db-97db-4b20-81dd-f9fe88d716b5/748f86db-97db-4b20-81dd-f9fe88d716b5.jsonl
---

## ADR Автоматичне дописування `.gitignore` для артефактів ADR stop-hook

## Context and Problem Statement
ADR stop-hook генерує локальні артефакти (`.claude/hooks/*.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`), які з'являлись у `git status` як незакомічені зміни в проєктах-споживачах пакета `@nitra/cursor`. Потрібен механізм, щоб ці файли автоматично потрапляли до `.gitignore` без ручного редагування.

## Considered Options
* Канонічний фрагмент `.gitignore.snippet` + автоматичне злиття під час `npx @nitra/cursor`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Канонічний фрагмент `.gitignore.snippet` + автоматичне злиття", because user сформулював вимогу додати записи в шаблон глобального `.gitignore`, і реалізація пішла через новий файл `npm/rules/adr/fix/hooks/template/.gitignore.snippet` та оновлення `sync-claude-config.mjs`, яке дописує відсутні рядки у кореневий `.gitignore` проєкту-споживача, коли правило `adr` увімкнено.

### Consequences
* Good, because transcript фіксує очікувану користь: після `npx @nitra/cursor` файли `capture-decisions.log`, `normalize-decisions.log`, `.normalize-state`, `.normalize.lock` більше не відображаються у `git status`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий файл: `npm/rules/adr/fix/hooks/template/.gitignore.snippet`
- Змінені файли: `npm/scripts/sync-claude-config.mjs`, `npm/scripts/sync-claude-config.test.mjs`, `npm/bin/n-cursor.js`, `npm/rules/adr/adr.mdc`, `npm/CHANGELOG.md`, `npm/package.json`
- Версія пакета: bumped до `1.13.64`
- Злиття є ідемпотентним: існуючі рядки не дублюються; функція `mergeGitignoreSnippet` додає лише відсутні рядки
- Тест: `'з правилом "adr": дописує канонічний фрагмент у .gitignore'` у `sync-claude-config.test.mjs`

---

## ADR Включення базових записів у `.gitignore.snippet` для правила `adr`

## Context and Problem Statement
Після створення канонічного фрагмента `.gitignore.snippet` user уточнив, що snippet повинен також містити базові рядки з кореневого `.gitignore` репозиторію (`node_modules/`, `dist/`, `*.secret`), посилаючись на рядки 1–5 файлу `.gitignore`. Без цих рядків нові проєкти, які не мали власного `.gitignore`, отримували б лише ADR-специфічні записи.

## Considered Options
* Включити базові рядки (`node_modules/`, `dist/`, `*.secret`) у `.gitignore.snippet` разом з ADR-специфічними записами
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Включити базові рядки у `.gitignore.snippet`", because user явно вказав файл `.gitignore` (рядки 1–5) як джерело для розширення snippet; реалізація оновила `npm/rules/adr/fix/hooks/template/.gitignore.snippet` — базові рядки розміщено на початку, перед ADR-блоком із коментарем.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor` з правилом `adr` дописує і базові (`node_modules/`, `dist/`, `*.secret`), і ADR-специфічні рядки — тобто `.gitignore` проєкту-споживача стає повноцінним з першого запуску.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Оновлений файл: `npm/rules/adr/fix/hooks/template/.gitignore.snippet`
- Оновлений дефолтний фрагмент у тестах: `sync-claude-config.test.mjs`
- Оновлено документацію: `npm/rules/adr/adr.mdc`
- Оновлено `npm/CHANGELOG.md` (запис у версії `1.13.64`)
