---
session: b0662984-b598-44eb-a8ed-5cb126e87153
captured: 2026-05-21T13:16:53+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/b0662984-b598-44eb-a8ed-5cb126e87153/b0662984-b598-44eb-a8ed-5cb126e87153.jsonl
---

## ADR Генерація AGENTS.md та CLAUDE.md читає .cursor/ без фільтрації за префіксом

## Context and Problem Statement
Постало питання, чи враховуються вручну додані правила та скіли (без префікса `n-`) при автоматичній генерації `AGENTS.md` і `CLAUDE.md` у проєкті `@nitra/cursor`. Потрібно було з'ясувати, яка саме частина конфігурації є джерелом списку правил і скілів для цих файлів.

## Considered Options
* Генерувати індекс на основі масивів `rules`/`skills` із `.n-cursor.json`
* Генерувати індекс на основі фактичного вмісту `.cursor/rules/` і `.cursor/skills/` на диску
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Генерувати індекс на основі фактичного вмісту `.cursor/rules/` і `.cursor/skills/`", because функції `listProjectRulesMdcFiles()` і `listProjectSkillDirNames()` сканують весь каталог без фільтрації за префіксом `n-` — до індексу потрапляють і ручні (`conftest.mdc`, `dev-dep.mdc`, `mdc-check/`), і керовані (`n-text.mdc`, `n-fix/`) елементи.

### Consequences
* Good, because ручні правила та скіли автоматично з'являються в `AGENTS.md` і `CLAUDE.md` після наступного `npx @nitra/cursor` без додаткової конфігурації.
* Bad, because ручні зміни всередині `AGENTS.md` і `CLAUDE.md` зникають при кожному запуску, оскільки файли повністю перезаписуються.

## More Information
Ключова функція: `listProjectRulesMdcFiles()` у `npm/bin/n-cursor.js` (рядки 489–496) — `readdir(RULES_DIR)` + `.filter(n => n.endsWith('.mdc'))`, без перевірки префікса. Аналогічно для скілів. Статичний текст для `AGENTS.md` береться з `npm/AGENTS.template.md`.

---

## ADR Уніфікація джерела правил і скілів до disk-first для check, hooks та slash-команд

## Context and Problem Statement
Після з'ясування, що генерація індексу вже disk-first, виявилося, що інші підсистеми `@nitra/cursor` — `check` без аргументів, активація ADR-hooks та генерація `.claude/commands/*.md` — досі прив'язані до масивів `rules`/`skills` у `.n-cursor.json`, а не до вмісту `.cursor/` на диску. Це створює дві моделі для однотипних артефактів.

## Considered Options
* **Варіант A — М'який синк:** не перезаписувати існуючі `n-*` без `--force`; orphan-видалення — окрема команда `npx @nitra/cursor prune`; `check`, hooks і slash-команди — з диска.
* **Варіант B — Жорсткий disk-only:** синк взагалі не змінює `.cursor/`; пакет лише надає `npm/rules/` для ручного копіювання; `.n-cursor.json` без масивів `rules`/`skills`.

## Decision Outcome
Chosen option: "Практична рекомендація до варіанта A", because transcript фіксує мінімальний крок до уніфікації без повного відмови від автоматичного оновлення з пакета: (1) `check` сканує `.cursor/rules/*.mdc` замість парсингу `AGENTS.md`; (2) ADR і slash-команди активуються за наявністю файлів у `.cursor/`; (3) синк не перезаписує наявні `n-*` без `--force`.

### Consequences
* Good, because transcript фіксує очікувану користь: ручні та `n-*` правила стають рівнозначними для `check` і Claude/Cursor; локальні правки в `n-text.mdc` не зникають після синку (за варіанта A).
* Bad, because без автоматичного orphan-delete версії правил із пакета не підтягуються самі; потрібно документувати `sync --force` або окрему команду `update-rules`; старий `n-adr.mdc` на диску тримає ADR увімкненим навіть після видалення з конфігу.

## More Information
Кроки з transcript: `check` → `readdir(.cursor/rules)` → id = basename без `.mdc` → перетин із `discoverCheckableRules()` у пакеті. ADR hooks → `existsSync('.cursor/rules/n-adr.mdc')` замість `rules.includes('adr')`. `.claude/commands/*.md` → для кожного каталогу в `.cursor/skills/`, не лише з `skills` у `.n-cursor.json`. Реалізація не виконувалася в рамках цієї сесії.
