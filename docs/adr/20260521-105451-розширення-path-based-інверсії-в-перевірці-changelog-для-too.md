---
session: 9b7a20d9-33b8-411f-a1fe-e89fe833bd53
captured: 2026-05-21T10:54:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9b7a20d9-33b8-411f-a1fe-e89fe833bd53.jsonl
---

## ADR Розширення path-based інверсії в перевірці changelog для tooling-шляхів

## Context and Problem Statement
Синхронізовані копії правил і скілів (`.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), оновлені через `npx @nitra/cursor`, потрапляли до `CHANGELOG.md` як релізні зміни, хоча вони не впливають на логіку роботи проєкту.

## Considered Options
* Розширити `CHANGELOG_IGNORE_PATH_PREFIXES` і `CHANGELOG_IGNORE_PATH_EXACT` у `check.mjs` для tooling-шляхів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розширити path-based інверсію в `check.mjs`", because зміни під `.cursor/` і `.claude/` є синхронізованим tooling-інструментарієм, що не змінює продуктову логіку; джерело правил у `npm/` навмисно не зачеплено — реальні зміни правил і далі вимагають bump.

### Consequences
* Good, because transcript фіксує очікувану користь: синкхронізація канонічних правил і скілів більше не генерує хибні вимоги до `CHANGELOG.md` і `version`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: `CHANGELOG_IGNORE_PATH_PREFIXES` розширено додаванням `.cursor/`, `.claude/`; `CHANGELOG_IGNORE_PATH_EXACT` — `AGENTS.md`, `CLAUDE.md`.
- `npm/rules/changelog/fix/consistency/check.test.mjs`: додано тест синку tooling без bump. 32/32 тестів проходять.
- `npm/rules/changelog/changelog.mdc`: секцію «Інверсія» оновлено — перелік `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, кореня монорепо синхронізовано з поведінкою коду.

---

## ADR Пропуск кореня монорепо в перевірці changelog

## Context and Problem Statement
Перевірка `check changelog` завжди перевіряла workspace `.` (корінь репозиторію), навіть якщо він є лише glue/конфіг-рівнем без власного продуктового пакету — що призводило до хибного `fail` за будь-які зміни в корені монорепо.

## Considered Options
* Пропускати workspace `.` цілком, якщо є підпакети (`isMonorepoRoot`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Пропускати корінь монорепо через `isMonorepoRoot`", because корінь монорепо є glue/конфіг/tooling і не веде власного продуктового `CHANGELOG.md`; логіка версіонування живе в підпакетах. Одно-пакетні репозиторії (корінь = єдиний воркспейс) перевіряються як раніше.

### Consequences
* Good, because transcript фіксує очікувану користь: `<root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; логіка живе в підпакетах` — перевірка більше не падає на кореневих змінах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: функція `check()` пропускає workspace `.` за умови наявності підпакетів.
- `npm/rules/changelog/fix/consistency/check.test.mjs`: доданий тест пропуску кореня монорепо.
- `npm/rules/changelog/changelog.mdc`: секція «Інверсія» оновлена — корінь монорепо внесено до переліку явних винятків.

---

## ADR Використання `-z` (NUL-розділення) для git-виклику в `check.mjs`

## Context and Problem Statement
`git diff` і `git ls-files` за замовчуванням повертають не-ASCII шляхи (кирилиця) у C-quoted форматі з octal-escape (`"docs/adr/\320\262..."`), коли `core.quotePath` активний. Функція `isChangelogIgnoredPath` отримувала рядок у лапках, що не збігався з інверсійними префіксами, наприклад `docs/`, і файл помилково вважався релізною зміною — перевірка падала.

## Considered Options
* Читати git-вивід через прапор `-z` (NUL-розділення) і розбивати хелпером `splitNulPaths`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прапор `-z` і хелпер `splitNulPaths`", because `-z` змушує git повертати шляхи як є (без quote/escape), незалежно від `core.quotePath`; NUL-байт є єдиним символом, гарантовано відсутнім у валідному шляху файлової системи, тому split по `\0` безпечний.

### Consequences
* Good, because transcript фіксує очікувану користь: untracked ADR-чернетки з кириличними назвами під `docs/` більше не провалюють перевірку — вони коректно матчаться з префіксом `docs/` і пропускаються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: функція `listChangedPathsAgainstBase` переписана — `git diff` і `git ls-files` викликаються з `-z`; додано хелпер `splitNulPaths`.
- `npm/rules/changelog/fix/consistency/check.test.mjs`: доданий регресійний тест для quotePath-сценарію.
- Баг був передіснуючим і не пов'язаним з розширенням інверсії (частина A); виявлений під час перевірки після реалізації A.
