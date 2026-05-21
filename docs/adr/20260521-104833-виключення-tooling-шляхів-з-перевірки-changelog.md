---
session: 9b7a20d9-33b8-411f-a1fe-e89fe833bd53
captured: 2026-05-21T10:48:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9b7a20d9-33b8-411f-a1fe-e89fe833bd53.jsonl
---

## ADR Виключення tooling-шляхів з перевірки changelog

## Context and Problem Statement
Правило `changelog/consistency` вимагало version-bump та запису в `CHANGELOG.md` за будь-які зміни у workspace. Синхронізація канонічних правил `.cursor/rules/`, `.claude/hooks/`, скілів, `AGENTS.md`/`CLAUDE.md` — які не впливають на логіку проєкту — хибно тригерила цю перевірку.

## Considered Options
* Розширити `CHANGELOG_IGNORE_PATH_PREFIXES` / `CHANGELOG_IGNORE_PATH_EXACT` у `check.mjs` (path-based інверсія)
* Content-aware перевірка `package.json` (парсинг JSON-diff, лише `devDependencies`)
* Оновити текст `.mdc`

## Decision Outcome
Chosen option: "Розширити path-based інверсію в `check.mjs`", because користувач явно обрав «Лише A» — path-based підхід достатній для `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, і не потребує парсингу JSON.

### Consequences
* Good, because зміни синхронізованого tooling (`.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`) більше не вимагають version-bump і запису в `CHANGELOG.md`.
* Bad, because bump `@nitra/cursor` у `devDependencies` (`package.json`) досі тригерить перевірку — path-based інверсія не виловлює зміни всередині файлу (частини B і C не реалізовано).

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: розширено `CHANGELOG_IGNORE_PATH_PREFIXES` (додано `.cursor/`, `.claude/`) та `CHANGELOG_IGNORE_PATH_EXACT` (додано `AGENTS.md`, `CLAUDE.md`).
- `npm/rules/changelog/fix/consistency/check.test.mjs`: додано тест «tooling-sync без bump → pass».
- Bump `@nitra/cursor` `1.13.66 → 1.13.67`, запис у `npm/CHANGELOG.md`.

---

## ADR Виправлення git `core.quotePath` для non-ASCII шляхів

## Context and Problem Statement
`git ls-files --others` та `git diff --name-only` повертають шляхи з не-ASCII символами (кирилиця) у форматі octal-escape з лапками (`"docs/adr/...\320\262..."`). Функція `isChangelogIgnoredPath` порівнювала такий рядок із префіксами (`docs/`, `.cursor/` тощо) і не знаходила збіг — тому кириличні ADR-файли в `docs/adr/` хибно вважалися релізними змінами.

## Considered Options
* Передавати `-z` (null-terminated) у git-виклики замість покладання на `core.quotePath`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Передавати `-z` у git-виклики", because `-z` змушує git повертати шляхи як сирий UTF-8 без лапок і escape-послідовностей, що усуває проблему без зміни глобального git-конфігу.

### Consequences
* Good, because файли з кириличними назвами в `docs/adr/` тепер коректно ідентифікуються як non-release (path-based інверсія `docs/` спрацьовує).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: функція `listChangedPathsAgainstBase` оновлена — додано прапор `-z` до відповідних `git`-викликів.
- Симптом: `bun ./npm/bin/n-cursor.js check changelog` повертав `❌ <root>` через untracked файл `docs/adr/20260521-101122-виключення-оновлень-лінтингових-залежностей-із-changelog.md`.

---

## ADR Пропуск кореня монорепо в перевірці changelog

## Context and Problem Statement
`check.mjs` перевіряв усі workspaces, включно з коренем монорепо (`.`). Корінь містить glue-конфіг, `package.json` із списком workspaces та tooling-файли — він не є самостійним пакетом і не публікується. Вимога version-bump у корені не мала сенсу.

## Considered Options
* Явно пропускати workspace `'.'` із перевірки changelog
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явно пропускати workspace `'.'`", because корінь монорепо виконує роль glue/конфігу, а вся release-логіка зосереджена в підпакетах (`npm/`, `demo/` тощо).

### Consequences
* Good, because `check changelog` більше не падає на `<root>` через tooling-зміни або untracked файли в корені.
* Bad, because якщо в корені колись з'явиться справжня release-логіка, перевірка її не виявить — потрібно буде явно прибрати виключення.

## More Information
- `npm/rules/changelog/fix/consistency/check.mjs`: додано умову `if (ws === '.') { pass(...); continue; }` у головному циклі.
- Повідомлення при пропуску: `<root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; логіка живе в підпакетах`.
- `npm/rules/changelog/fix/consistency/check.test.mjs`: 32 тести, усі проходять після змін.
