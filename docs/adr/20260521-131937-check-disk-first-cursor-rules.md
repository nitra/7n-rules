# `check` без аргументів читає `.cursor/rules/`, не `AGENTS.md`

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

`npx @nitra/cursor check` без явних аргументів визначав список правил для прогону, парсячи посилання з файлу `AGENTS.md`. Це створювало непряму залежність: `check` і індекс агентів використовували різні шляхи до одного джерела правди, а ручні правила без префікса `n-` могли потрапляти в `AGENTS.md`, але не в `check`, якщо порядок синку ще не завершився.

## Considered Options

- Default `check` із `*.mdc`-файлів у `.cursor/rules/` (disk-first)
- Default `check` із парсингу посилань у `AGENTS.md` (попередня поведінка)

## Decision Outcome

Chosen option: "Default `check` із `*.mdc`-файлів у `.cursor/rules/`", because це єдине джерело правди — усі `*.mdc` (і керовані `n-*`, і ручні) присутні там, а `AGENTS.md` є лише похідним артефактом, що вже генерується з того самого каталогу.

### Consequences

- Good, because `check` і індекс агентів читають один і той самий диск без проміжного файлу; ручні правила автоматично враховуються в `check` без додаткових кроків.
- Bad, because якщо `.cursor/rules/` порожній (синк ще не запускався), `check` без аргументів завершується з помилкою та підказкою замість мовчазного пропуску правил.

## More Information

- Нова утиліта: `npm/scripts/utils/discover-check-rules-from-cursor.mjs` — `discoverCheckRulesFromCursorRules()`, `mdcBasenameToCheckId()`
- Тести: `npm/scripts/utils/discover-check-rules-from-cursor.test.mjs`
- `npm/bin/n-cursor.js` — замінено виклик `discoverCheckRulesFromAgentsMd` на `discoverCheckRulesFromCursorRules`
- Логіка id: `n-bun.mdc` → `bun`, `conftest.mdc` → `conftest`; перетин із `discoverCheckableRules()` у пакеті лишається незмінним
- Явний виклик `npx @nitra/cursor check bun ga …` поведінки не змінює
- Документація оновлена в: `npm/skills/fix/SKILL.md`, `docs/programmatic-checks-for-llm.md`, `.cursor/rules/scripts.mdc`
- Версія пакета `@nitra/cursor`: `1.13.68` → `1.13.69`; запис додано до `npm/CHANGELOG.md`

## Update 2026-05-21

Реалізація: нова утиліта `npm/scripts/utils/discover-check-rules-from-cursor.mjs` — функції `discoverCheckRulesFromCursorRules()` та `mdcBasenameToCheckId()` (перетворення `n-bun.mdc` → `bun`, `conftest.mdc` → `conftest`). Тести: `npm/scripts/utils/discover-check-rules-from-cursor.test.mjs` (bun:test).

Алгоритм: `readdir(.cursor/rules)` → `*.mdc` → id → перетин із `discoverCheckableRules()` пакета → алфавітний порядок.

Edge case: якщо `.cursor/rules/` порожній (синк ще не запускався), `check` без аргументів падає з помилкою та підказкою запустити синк або передати правила явно.

Змінені файли: `npm/bin/n-cursor.js` (заміна `discoverCheckRulesFromAgentsMd` на `discoverCheckRulesFromCursorRules`), `npm/skills/fix/SKILL.md`, `docs/programmatic-checks-for-llm.md`, `.cursor/rules/scripts.mdc`. Версія пакета `1.13.69`.

## Update 2026-05-21

Уточнення: генерація `agents.md` і `claude.md` читає `.cursor/rules/` без фільтрації — включає всі правила. Це підтверджує, що `check` і генератор працюють з одним набором правил і розбіжностей через фільтрацію не виникає.

Edge case: якщо правило додано тільки до `agents.md` і не синхронізовано у `.cursor/rules/`, `check` його не знайде, що може дезорієнтувати розробника.
