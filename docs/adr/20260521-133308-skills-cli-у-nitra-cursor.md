# Skills CLI у пакеті `@nitra/cursor`

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

Скіли з `@nitra/cursor` можна було запускати лише через slash-команди всередині Cursor IDE після синхронізації правил у проєкт. Потрібен спосіб запускати ті самі скіли з будь-якого репозиторію через `npx` без встановлення пакета як `devDependency` і без синку правил у цільовий проєкт.

## Considered Options

* Окремий пакет `@nitra/skills` з власним репозиторієм, bin та структурою `skills/<id>/SKILL.md`
* Додати skills CLI безпосередньо до існуючого пакета `@nitra/cursor` — новий bin `n-skills` і підкоманда `skill` у `n-cursor`

## Decision Outcome

Chosen option: "Додати skills CLI до `@nitra/cursor`", because скіли вже зберігаються в `npm/skills/<id>/SKILL.md` цього пакета; окремий пакет потребував би дублювання файлів і окремого release-cycle.

### Consequences

* Good, because `npx @nitra/cursor skill list`, `skill prompt <id>`, `skill claude <id>`, `skill cursor <id>` доступні без нових залежностей.
* Good, because подвійна точка входу: `npx -p @nitra/cursor n-skills …` (коротка форма) і `n-cursor skill …` (монорепо); `n-skills` — аліас, `n-cursor skill` — канонічна форма.
* Good, because скорочений синтаксис `skill <id> "task"` є alias до `prompt`: будь-який аргумент, що не збігається з `list | prompt | claude | cursor`, трактується як `skillId`.
* Good, because нормалізація `n-` префікса: `n-lint` → `lint` через `normalizeSkillId`; `list` виводить канонічні імена без префікса — відповідає slash-командам Cursor (`/n-lint`).
* Good, because промпт містить `SKILL.md` + завдання + контекст CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`), що дає агенту мінімальний контекст проєкту без ручного копіювання.
* Neutral, because transcript не містить підтвердження наслідку щодо розміру промпту при великих `package.json`.
* Bad, because transcript не містить підтверджених інших негативних наслідків.

## More Information

Нові файли: `npm/scripts/skills-cli.mjs` (логіка `list`/`prompt`/`claude`/`cursor`, `normalizeSkillId`, `buildSkillPrompt`), `npm/bin/n-skills.js`, `npm/scripts/skills-cli.test.mjs`.
Зміни: `npm/bin/n-cursor.js` — `case 'skill'`; `npm/package.json` — `"n-skills": "./bin/n-skills.js"` у `bin`, версія `1.13.70`.
Промпт: секції `# Task`, `# Skill`, `# Current project` (з `package.json`, `tsconfig.json`, `.n-cursor.json` — лише якщо існують через `existsSync`). Якщо завдання порожнє — заглушка `"Execute the skill instructions for this project."`.

## Update 2026-05-21

Деталі CLI поведінки: якщо `claude` не знайдено у `PATH`, CLI виводить підказку спробувати `skill cursor <id>` як альтернативу. Якщо завдання не вказано при виклику `skill claude <id>` (без тексту завдання), команда вважається валідною — завдання замінюється заглушкою `"Execute the skill instructions for this project."`.

## Update 2026-05-21

UX підкоманди `skill` спрощено до чотирьох канонічних форм:

- `skill list` — перелік доступних скілів
- `skill <id> [task]` — вивести промпт (замінює `skill prompt`)
- `skill cursor <id> [task]` — запустити через Cursor
- `skill claude <id> [task]` — запустити через Claude CLI

Видалено: підкоманда `skill prompt`, окремі bins `n-skills` та `n-claude`, top-level підкоманда `claude` у `n-cursor`. Bin у `npm/package.json` — лише `n-cursor`. Версія пакета: `1.13.72`.

Заборона bin з іменем `claude`: ім'я збігається з Anthropic Claude Code CLI — після `npm i -g` обидва бінарники боролися б за одну команду в `PATH`. Альтернатива для локального використання: alias у `~/.zshrc`.

Нові модулі: `npm/scripts/skills-cli.mjs` (функції `listSkillIds`, `normalizeSkillId`, `buildSkillPrompt`, `runSkillsCli`), тести: `npm/scripts/skills-cli.test.mjs`. Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета; контекст CWD: `package.json`, `tsconfig.json`, `.n-cursor.json`.

## Update 2026-05-21

Склад промпту, що генерується командою `skill <id>`:

- `# Task` — переданий текст завдання або заглушка `Execute the skill instructions for this project.`
- `# Skill` — вміст `npm/skills/<id>/SKILL.md` з установленого пакета
- `# Current project` — CWD, вміст `package.json`, `tsconfig.json`, `.n-cursor.json` (якщо файли існують)

Id скілу нормалізується: `n-taze` → `taze`. Реалізація: `npm/scripts/skills-cli.mjs`, функція `buildSkillPrompt`.
