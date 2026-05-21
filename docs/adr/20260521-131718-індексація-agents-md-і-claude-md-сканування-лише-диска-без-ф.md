---
session: b0662984-b598-44eb-a8ed-5cb126e87153
captured: 2026-05-21T13:17:18+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/b0662984-b598-44eb-a8ed-5cb126e87153/b0662984-b598-44eb-a8ed-5cb126e87153.jsonl
---

## ADR Індексація AGENTS.md і CLAUDE.md — сканування лише диска без фільтра за префіксом

## Context and Problem Statement
`npx @nitra/cursor` генерує `AGENTS.md` і `CLAUDE.md`, що містять посилання на всі правила та скіли проєкту. Виникло питання: чи враховуються ручно додані `.mdc`-файли й директорії skills поряд із керованими `n-*` елементами, або лише останні.

## Considered Options
* Фільтрувати в індексі лише `n-*` керовані елементи
* Сканувати весь вміст `.cursor/rules/` і `.cursor/skills/` без фільтрації за префіксом

## Decision Outcome
Chosen option: "Сканувати весь вміст `.cursor/rules/` і `.cursor/skills/` без фільтрації за префіксом", because `listProjectRulesMdcFiles()` читає `readdir(rulesDir)` і фільтрує лише за `.endsWith('.mdc')`, ігноруючи префікс; аналогічно `listProjectSkillDirNames()` повертає всі підкаталоги.

### Consequences
* Good, because ручні правила (`conftest.mdc`, `dev-dep.mdc`, `scripts.mdc`) і ручні скіли (`mdc-check/`) автоматично потрапляють в індекс агентів нарівні з `n-*`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція `listProjectRulesMdcFiles()` у `npm/bin/n-cursor.js` (рядки 489–496):
```js
const names = await readdir(rulesDir)
return names.filter(n => n.endsWith('.mdc')).toSorted((a, b) => a.localeCompare(b))
```
Ручні правки безпосередньо в `AGENTS.md` чи `CLAUDE.md` — не зберігаються: файли повністю перезаписуються при кожному `npx @nitra/cursor`.

---

## ADR Перехід до disk-only моделі для check, hooks і slash-команд у @nitra/cursor

## Context and Problem Statement
Поточна архітектура `@nitra/cursor` має дві паралельні моделі: індекс агентів формується з диска, але `check`, ADR hooks, orphan-cleanup і slash-команди для `n-*` елементів залежать від масивів `rules`/`skills` у `.n-cursor.json`. Користувач поставив вимогу, щоб і ручні, і `n-*` правила/скіли однаково аналізувалися лише за вмістом `.cursor/rules/` і `.cursor/skills/`.

## Considered Options
* Залишити поточну дуальну модель (диск для індексу, `.n-cursor.json` для решти операцій)
* М'який синк (варіант A): не перезаписувати наявні `n-*` без `--force`; orphan-prune як окрема команда `npx @nitra/cursor prune`
* Жорсткий disk-only (варіант B): синк взагалі не чіпає `.cursor/`; пакет лише надає `npm/rules/` для ручного копіювання; `.n-cursor.json` без масивів `rules`/`skills`

## Decision Outcome
Chosen option: "М'який синк (варіант A) як мінімальний практичний крок", because асистент рекомендував найменший крок до уніфікованої моделі: `check` — з `.cursor/rules/`; ADR й slash-команди — за наявністю файлів на диску; синк не перезаписує наявні `n-*` без `--force`; prune — окремою командою.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина модель «що на диску — те в проєкті»; ручні правки в `n-text.mdc` не зникають після синку; ручні й `n-*` елементи рівні для `check` і Claude/Cursor.
* Bad, because без автоматичного перезапису версії `n-*` правил з пакета не підтягуються самі; потрібно документувати `sync --force` або `npx @nitra/cursor update-rules`; ADR hook може лишитися активним, якщо старий `n-adr.mdc` лежить на диску після вимкнення в конфігу.

## More Information
Запропоновані конкретні зміни в `npm/bin/n-cursor.js`:
1. `check` без аргументів — сканувати `.cursor/rules/*.mdc` замість парсингу `AGENTS.md`; id: `n-bun.mdc` → `bun`, `my-rule.mdc` → `my-rule`.
2. ADR hooks — `existsSync('.cursor/rules/n-adr.mdc')` замість `config.rules.includes('adr')`.
3. `.claude/commands/*.md` — генерувати для кожного каталогу в `.cursor/skills/`, а не лише за масивом `skills` у `.n-cursor.json`.
4. Нове призначення `.n-cursor.json`: опційний `sync-rules: [...]` — що оновлювати з npm; масиви `rules`/`skills` як джерело списку для агентів — прибираються.
