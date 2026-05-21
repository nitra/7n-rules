---
session: a7aaf3f9-4bd7-4990-b47f-f8212d971f58
captured: 2026-05-21T13:35:25+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/a7aaf3f9-4bd7-4990-b47f-f8212d971f58/a7aaf3f9-4bd7-4990-b47f-f8212d971f58.jsonl
---

## ADR Додавання skills CLI до пакета `@nitra/cursor`

## Context and Problem Statement
Потрібно запускати скіли з `@nitra/cursor` у зовнішніх проєктах без встановлення пакета як `devDependency`. Sync-команда (`n-cursor` без аргументів) копіює правила у проєкт, що є надлишковим для одноразового запуску скілу.

## Considered Options
* Окремий пакет `@nitra/skills` за аналогією із прикладом у запиті
* Додати CLI скілів безпосередньо до `@nitra/cursor` — новий bin `n-skills` і підкоманда `skill` у `n-cursor`

## Decision Outcome
Chosen option: "Додати CLI скілів безпосередньо до `@nitra/cursor`", because скіли вже лежать у `npm/skills/<id>/SKILL.md` цього пакета, а дублювати їх в окремий пакет — зайва синхронізація.

### Consequences
* Good, because `npx @nitra/cursor skill …` та `npx -p @nitra/cursor n-skills …` працюють без додаткового пакета та без sync правил у проєкт.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/bin/n-skills.js`, `npm/scripts/skills-cli.mjs`, `npm/scripts/skills-cli.test.mjs`. Запис у `npm/bin/n-cursor.js` (`case 'skill'`). `npm/package.json` — додано `"n-skills": "./bin/n-skills.js"` до `bin`. Версія пакета підвищена до `1.13.70`.

---

## ADR CLI UX скілів: підкоманди та скорочений синтаксис

## Context and Problem Statement
Потрібно визначити набір команд і синтаксис CLI, щоб охопити сценарії: перелік скілів, генерація промпту в stdout, передача у `claude -p`, передача у Cursor CLI.

## Considered Options
* Тільки канонічний `prompt <id> "task"` без скорочень
* Набір підкоманд `list | prompt | claude | cursor` плюс скорочення — `skill <id> "task"` як еквівалент `skill prompt <id> "task"`

## Decision Outcome
Chosen option: "Набір підкоманд `list | prompt | claude | cursor` плюс скорочення", because під час реалізації скорочення `skill lint "task"` (без `prompt`) визнане зручнішим і покрите тестом.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor skill claude taze` (без тексту завдання) є валідною командою — завдання замінюється заглушкою `Execute the skill instructions for this project.`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Розбір argv: `[command, skillName, ...taskParts]`; `task = taskParts.join(' ')`. Нормалізація id: `n-lint` → `lint` (префікс `n-` відкидається). Fallback-підказка: якщо `claude` не знайдено в `PATH`, виводиться порада спробувати `skill cursor <id>`. Реалізовано у `npm/scripts/skills-cli.mjs`; тести у `npm/scripts/skills-cli.test.mjs`.

---

## ADR Склад промпту для скілу

## Context and Problem Statement
Агент, якому передається промпт скілу, не має прямого доступу до проєкту; потрібно вирішити, який контекст CWD включати у промпт автоматично.

## Considered Options
* Тільки `SKILL.md` + текст завдання
* `SKILL.md` + завдання + контекст CWD: `package.json`, `tsconfig.json`, `.n-cursor.json`

## Decision Outcome
Chosen option: "`SKILL.md` + завдання + контекст CWD: `package.json`, `tsconfig.json`, `.n-cursor.json`", because ці файли дають агенту мінімальний контекст проєкту (менеджер залежностей, TypeScript-конфіг, налаштування курсора) без необхідності читати весь репозиторій.

### Consequences
* Good, because transcript фіксує очікувану користь: агент орієнтується на інструкції скілу та структуру проєкту без ручного копіювання контексту.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо розміру промпту при великих `package.json`.

## More Information
Файли читаються через `readIfExists` з `cwd` (директорія, з якої запущено `npx`). Секції у промпті: `# Task`, `# Skill`, `# Current project` → `## package.json`, `## tsconfig.json`, `## .n-cursor.json`. Реалізовано у функції `buildSkillPrompt` в `npm/scripts/skills-cli.mjs`.
