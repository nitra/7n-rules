---
session: a7aaf3f9-4bd7-4990-b47f-f8212d971f58
captured: 2026-05-21T13:35:34+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/a7aaf3f9-4bd7-4990-b47f-f8212d971f58/a7aaf3f9-4bd7-4990-b47f-f8212d971f58.jsonl
---

## ADR Додавання skills CLI до `@nitra/cursor` замість окремого пакета

## Context and Problem Statement
Команді потрібна запускалка скілів з репозиторію `@nitra/cursor` у зовнішніх проєктах без встановлення пакета як `devDependency`. Зразком послугував описаний патерн `@nitra/skills` із підкомандами `list`, `prompt`, `claude`.

## Considered Options
* Додати skills CLI до наявного пакета `@nitra/cursor` (новий bin `n-skills` + підкоманда `skill` в `n-cursor`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати skills CLI до наявного пакета `@nitra/cursor`", because це дозволяє використовувати `npx @nitra/cursor skill …` без окремого пакета, спираючись на вже наявну структуру `npm/skills/<id>/SKILL.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: зовнішні проєкти отримують доступ до скілів через `npx` без `devDependencies`, синку правил або окремого репозиторію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/scripts/skills-cli.mjs`, `npm/bin/n-skills.js`, `npm/scripts/skills-cli.test.mjs`. Зміни: `npm/bin/n-cursor.js` (підкоманда `skill`), `npm/package.json` (bin `n-skills`, версія `1.13.70`). Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета.

---

## ADR Подвійна точка входу: підкоманда `n-cursor skill` і окремий bin `n-skills`

## Context and Problem Statement
Skills CLI потребував CLI-поверхні, зручної як для стислого `npx`, так і для інтеграції з існуючим бінарником `n-cursor`.

## Considered Options
* Тільки підкоманда в `n-cursor` (без окремого `n-skills` bin)
* Тільки окремий `n-skills` bin (без підкоманди в `n-cursor`)
* Обидві точки входу одночасно

## Decision Outcome
Chosen option: "Обидві точки входу одночасно", because `n-skills` дає короткий `npx -p @nitra/cursor n-skills list`, а підкоманда `n-cursor skill` зберігає єдиний CLI для монорепо.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-skills` — аліас, `n-cursor skill` — канонічна форма; обидві ведуть в `skills-cli.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/bin/n-skills.js` делегує до `runSkillsCli` з `../scripts/skills-cli.mjs`; `npm/bin/n-cursor.js` додано `case 'skill'` з тим самим імпортом. `npm/package.json`:
```json
"bin": { "n-cursor": "./bin/n-cursor.js", "n-skills": "./bin/n-skills.js" }
```

---

## ADR Скорочений синтаксис `skill <id> <task>` без ключового слова `prompt`

## Context and Problem Statement
Після реалізації базових підкоманд `list`, `prompt`, `claude`, `cursor` виявилося, що `skill prompt lint "task"` — надмірно детальна форма для найчастішого випадку (генерація промпту на stdout).

## Considered Options
* Явний `skill prompt <id> <task>` як єдина форма
* Скорочення `skill <id> <task>` як аліас до `prompt`

## Decision Outcome
Chosen option: "Скорочення `skill <id> <task>` як аліас до `prompt`", because будь-який аргумент, що не збігається з `list`, `prompt`, `claude`, `cursor`, трактується як id скілу, і CLI будує промпт без явного `prompt`.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor skill taze` та `npx @nitra/cursor skill prompt taze` є рівнозначними, що скорочує набір тексту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Логіка в `npm/scripts/skills-cli.mjs`: після перевірки відомих команд (`list`, `prompt`, `claude`, `cursor`) залишок argv трактується як `[skillId, ...taskParts]`. Тест `'скорочення skill <id> без prompt'` додано в `npm/scripts/skills-cli.test.mjs`.

---

## ADR Склад промпту: `SKILL.md` + контекст CWD

## Context and Problem Statement
Для ефективної роботи агента (Claude або Cursor) потрібен не лише текст скілу, а й контекст цільового проєкту, в якому запускається `npx`.

## Considered Options
* Тільки `SKILL.md`
* `SKILL.md` + вибрані файли CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`)

## Decision Outcome
Chosen option: "`SKILL.md` + вибрані файли CWD", because агент потребує мінімального контексту проєкту для прийняття рішень (наприклад, taze для `package.json`), а завантажувати весь репозиторій в промпт нерозумно.

### Consequences
* Good, because transcript фіксує очікувану користь: промпт містить секції `# Task`, `# Skill`, `# Current project` з `package.json`, `tsconfig.json`, `.n-cursor.json` (якщо є).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція `buildSkillPrompt` в `npm/scripts/skills-cli.mjs` читає `process.cwd()`, шукає `package.json`, `tsconfig.json`, `.n-cursor.json` через `readIfExists`. Якщо завдання порожнє — використовується заглушка `"Execute the skill instructions for this project."`.
