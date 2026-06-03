---
session: f210f394-3b4a-4cae-a1e4-6ac768a3a7d5
captured: 2026-06-02T21:56:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/f210f394-3b4a-4cae-a1e4-6ac768a3a7d5.jsonl
---

Зараз я проаналізую цей transcript і виведу ADR-документацію.

На підставі сесії можна виділити **два** чітких архітектурних рішення:
1. Де живе код скіла (детермінований scanner): `npm/scripts/` vs `npm/skills/<id>/js/`.
2. Що `syncSkills` копіює в проєкт-споживач: тільки top-level vs усе в каталозі.

---

## ADR Скіл-специфічні скрипти живуть у `npm/skills/<id>/js/`, не в `npm/scripts/`

## Context and Problem Statement
У монорепо `@nitra/cursor` скіл `docgen` потребував детермінованого CLI-scanner (`docgen-scan.mjs`), специфічного лише для цього скіла. Постало питання, де розмістити цей скрипт: у `npm/scripts/` (загальний крос-правильний каталог) чи в `npm/skills/docgen/js/` (поруч із самим скілом).

## Considered Options
* Розмістити `docgen-scan.mjs` у `npm/scripts/` (загальний каталог скриптів)
* Розмістити `docgen-scan.mjs` у `npm/skills/docgen/js/` (каталог скіла)

## Decision Outcome
Chosen option: "Розмістити `docgen-scan.mjs` у `npm/skills/docgen/js/`", because `npm/scripts/` — це лише крос-правильна інфраструктура (CLI-оркестратори, спільні утиліти); код, що обслуговує лише один скіл, має жити поряд із ним — по аналогії з `npm/rules/<id>/js/`. Цей контракт вже був закладений у `.cursor/rules/scripts.mdc` (рядок 57, рядок 120), але спочатку порушений у першому варіанті реалізації.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка відповідальності — код скіла і його `SKILL.md` знаходяться в одному каталозі `npm/skills/docgen/`; `npm/scripts/` залишається чистою крос-правильною інфраструктурою.
* Good, because `js/docgen-scan.mjs` публікується з пакетом (через `files: ["skills"]` у `npm/package.json`) і виконується через `npx @nitra/cursor` — один екземпляр коду, одна точка оновлення, `js/` у проєкт-споживач не копіюється.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/skills/docgen/js/docgen-scan.mjs`, `npm/skills/docgen/js/tests/docgen-scan.test.mjs`, `.cursor/rules/scripts.mdc` (версія `1.12`). Контракт зафіксований у `.cursor/rules/scripts.mdc` як правило: «код, що обслуговує лише один скіл — `npm/skills/{skill}/js/<concern>.mjs`; `npm/scripts/` — лише крос-правильна інфраструктура». Виконання через `npx @nitra/cursor docgen scan|modules`.

---

## ADR `syncSkills` копіює в проєкт-споживач тільки top-level файли каталогу скіла

## Context and Problem Statement
Функція `syncSkills` у `npm/bin/n-cursor.js` синхронізує каталог `npm/skills/<id>/` у проєкт-споживач (`.cursor/skills/`, `.pi/skills/`). Після появи підкаталогу `js/` у структурі скіла `syncSkills` починала б передавати `readFile` на підкаталог, що кидало `EISDIR`. Потрібно було явно обмежити синк.

## Considered Options
* Копіювати всі записи каталогу (включно з підкаталогами)
* Копіювати лише top-level файли, пропускаючи підкаталоги

## Decision Outcome
Chosen option: "Копіювати лише top-level файли, пропускаючи підкаталоги", because скіл-специфічний код (`js/`) виконується з установленого пакета через `npx` — передавати його в проєкт-споживач не потрібно, точно як `npm/rules/<id>/js/` не копіюється при синку правил. Реалізовано через `readdir(..., {withFileTypes:true})` і фільтр `e.isFile()`.

### Consequences
* Good, because transcript фіксує очікувану користь: перевірено, що для скіла `docgen` у споживача копіюється лише `SKILL.md`; `js/` і `meta.json` пропускаються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/bin/n-cursor.js`, функція `syncSkills`. До виправлення: `readdir` повертав плоский список, `readFile` кидав `EISDIR` на підкаталог. Після: `withFileTypes: true` + `entry.isFile()` фільтр.
