# Виключення tooling-шляхів та виправлення non-ASCII у `changelog/consistency/check`

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

Правило `changelog/consistency` вимагало version-bump та запису в `CHANGELOG.md` за будь-які зміни у workspace. Синхронізація канонічних правил (`.cursor/rules/`), хуків (`.claude/hooks/`), скілів, `AGENTS.md`, `CLAUDE.md` — які не впливають на логіку проєкту — хибно тригерила цю перевірку. Додатково: `git ls-files` і `git diff` повертали шляхи з кирилицею в octal-escape форматі (`"docs/adr/...\320\262..."`), що ламало порівняння з path-префіксами. Корінь монорепо (`'.'`) також перевірявся, хоча є glue-конфігом без власної release-логіки.

## Considered Options

- **A — Path-based інверсія**: розширити `CHANGELOG_IGNORE_PATH_PREFIXES` та `CHANGELOG_IGNORE_PATH_EXACT` у `check.mjs`
- **B — Content-aware перевірка `package.json`**: парсити JSON-diff і ігнорувати bump, якщо торкнуто лише `devDependencies`
- **C — Оновлення тексту `.mdc`**: явно задокументувати виключення tooling-змін у правилі для агента

## Decision Outcome

Chosen option: "A — Path-based інверсія + прапор `-z` у git-викликах + пропуск workspace `'.'`", because користувач обрав лише частину A; `-z` усуває octal-escape без зміни глобального git-конфігу; корінь монорепо є glue-конфігом і не є self-contained пакетом. Частини B і C відкладено.

### Consequences

- Good, because зміни в `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` більше не тригерять обов'язковий version-bump — 32 тести проходять.
- Good, because файли з кириличними назвами в `docs/adr/` коректно ідентифікуються як non-release завдяки прапору `-z`.
- Good, because `check changelog` більше не падає на `<root>` через tooling-зміни або untracked файли в корені.
- Bad, because bump `@nitra/cursor` у `devDependencies` кореневого `package.json` досі тригерить перевірку — частина B не реалізована.
- Neutral, because якщо в корені монорепо колись з'явиться справжня release-логіка, потрібно явно прибрати виключення `ws === '.'`.

## More Information

- `npm/rules/changelog/fix/consistency/check.mjs`: `CHANGELOG_IGNORE_PATH_PREFIXES` поповнено `.cursor/`, `.claude/`; `CHANGELOG_IGNORE_PATH_EXACT` поповнено `AGENTS.md`, `CLAUDE.md`; функція `listChangedPathsAgainstBase` отримала прапор `-z` у git-викликах; умова `if (ws === '.') { pass(...); continue; }` у головному циклі.
- `npm/rules/changelog/fix/consistency/check.test.mjs`: тест «tooling-sync без bump → pass»; усього 32 тести.
- Повідомлення при пропуску кореня: `<root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено`.
- Версія `npm/package.json`: `1.13.66` → `1.13.67`; запис у `npm/CHANGELOG.md`.
- Команда перевірки: `bun ./npm/bin/n-cursor.js check changelog`.

## Update 2026-05-21

Політика: до `CHANGELOG.md` мають потрапляти лише зміни, що впливають на логіку роботи проєкту. Оновлення tooling-пакетів у `devDependencies` (приклад: `@nitra/cursor ^1.13.57 → ^1.13.66`) є нерелізними змінами — їх не треба фіксувати. Реалізація через path-based інверсію (частина A) описана в основному записі цього файлу. Частини B (JSON-diff `devDependencies`) і C (оновлення `.mdc`) відкладено.

## Update 2026-05-21

### Пропуск кореня монорепо (`isMonorepoRoot`)

Функція `check()` пропускає workspace `.` за умови наявності підпакетів: корінь монорепо є glue/конфіг/tooling і не веде власного продуктового `CHANGELOG.md`. Одно-пакетні репозиторії (корінь = єдиний workspace) перевіряються як раніше. Вивід: `✅ <root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; логіка живе в підпакетах`.

### Фікс quotePath-багу: прапор `-z` і хелпер `splitNulPaths`

`git diff` і `git ls-files` за замовчуванням повертають не-ASCII шляхи у C-quoted форматі (`"docs/adr/\320..."`) коли `core.quotePath` активний. Функція `isChangelogIgnoredPath` отримувала рядок у лапках, що не збігався з інверсійними префіксами, і файл хибно вважався релізною зміною. Рішення: передавати прапор `-z` і розбивати вивід хелпером `splitNulPaths` по `\0`. NUL-байт гарантовано відсутній у валідному шляху файлової системи, тому split безпечний. Файли з кириличними іменами (наприклад `docs/adr/...`) тепер коректно матчаться з префіксом `docs/`.

### Видалення `CHANGELOG_IGNORE_PATH_EXACT`

Оскільки корінь монорепо пропускається цілком, окремий `CHANGELOG_IGNORE_PATH_EXACT` для `AGENTS.md`/`CLAUDE.md` став зайвим і видалений із коду та тестів. `changelog.mdc` синхронізовано з кодом (версія `2.5 → 2.6`).

Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `check.test.mjs`, `changelog.mdc`, `npm/CHANGELOG.md`. Bump `@nitra/cursor` `1.13.66 → 1.13.67`; 32/32 тести; `bun run lint` — Issues found: 0. Частина B (content-aware `package.json` diff) поза scope сесії.
