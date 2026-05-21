---
session: a7aaf3f9-4bd7-4990-b47f-f8212d971f58
captured: 2026-05-21T13:33:08+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/a7aaf3f9-4bd7-4990-b47f-f8212d971f58/a7aaf3f9-4bd7-4990-b47f-f8212d971f58.jsonl
---

## ADR Додавання skills CLI до пакета `@nitra/cursor` замість окремого пакета

## Context and Problem Statement
Потрібно дозволити запускати скіли з `@nitra/cursor` у зовнішніх проєктах через `npx`, без встановлення пакета як `devDependency` і без синку правил у проєкт. Питання — де розміщувати цей CLI: в окремому пакеті (`@nitra/skills`) чи в наявному `@nitra/cursor`.

## Considered Options
* Окремий пакет `@nitra/skills` (структура, описана в brief)
* Додати skills CLI безпосередньо до `@nitra/cursor`

## Decision Outcome
Chosen option: "Додати skills CLI безпосередньо до `@nitra/cursor`", because скіли вже лежать у `npm/skills/<id>/SKILL.md` цього пакета, і додавання окремого бінарника `n-skills` та підкоманди `skill` до наявного `n-cursor` не потребує нового пакета або дублювання файлів.

### Consequences
* Good, because `npx @nitra/cursor skill list` та `npx -p @nitra/cursor n-skills list` працюють одразу після публікації наявного пакета без додаткової реєстрації npm-пакета.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/scripts/skills-cli.mjs` (логіка), `npm/bin/n-skills.js` (окремий bin), зміни в `npm/bin/n-cursor.js` (підкоманда `skill`), `npm/package.json` (`"n-skills": "./bin/n-skills.js"` у `bin`). Версія пакета підвищена до `1.13.70`.

---

## ADR Скорочений синтаксис `skill <id> "task"` як псевдонім до `skill prompt`

## Context and Problem Statement
Початковий CLI вимагав явного `prompt` перед id скілу: `skill prompt lint "task"`. Це зайвий токен у найпоширенішому сценарії — генерація промпту для вставки в агента.

## Considered Options
* Обов'язковий `skill prompt <id> "task"`
* Скорочення: `skill <id> "task"` як alias до `prompt`, якщо `command` не є зарезервованим словом

## Decision Outcome
Chosen option: "Скорочення: `skill <id> "task"`", because команда без `prompt` читається природніше, і всі зарезервовані слова (`list`, `prompt`, `claude`, `cursor`) не конфліктують з реальними іменами скілів.

### Consequences
* Good, because transcript фіксує очікувану користь: коротші команди (`npx @nitra/cursor skill lint "task"` замість `npx @nitra/cursor skill prompt lint "task"`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна реалізована в `npm/scripts/skills-cli.mjs`: якщо `command` не збігається з `list | prompt | claude | cursor`, він трактується як `skillId`, а `skillName` і `taskParts` зміщуються відповідно. Покрито тестом `'скорочення skill <id> без prompt'` у `npm/scripts/skills-cli.test.mjs`.

---

## ADR Склад контексту CWD у промпті скілу

## Context and Problem Statement
Промпт скілу має надавати агентові достатній контекст про цільовий проєкт, де запускається `npx @nitra/cursor skill …`, щоб агент міг адаптувати інструкції без ручного копіювання файлів.

## Considered Options
* Тільки вміст `SKILL.md` і завдання користувача
* `SKILL.md` + завдання + контекстні файли з CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`)

## Decision Outcome
Chosen option: "`SKILL.md` + завдання + контекстні файли з CWD", because ці три файли покривають стек, типізацію і конфігурацію пакета і дозволяють агентові одразу орієнтуватись у проєкті без додаткових запитів.

### Consequences
* Good, because transcript фіксує очікувану користь: агент отримує `package.json`, `tsconfig.json`, `.n-cursor.json` (якщо існують) у єдиному промпті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Логіка збирання промпту — функція `buildSkillPrompt` у `npm/scripts/skills-cli.mjs`. Файли підключаються лише якщо існують у `process.cwd()` на момент виклику. Ідентифікатор скілу може мати префікс `n-` (`n-lint` → `lint`) — нормалізація виконується там само.
