---
session: b0662984-b598-44eb-a8ed-5cb126e87153
captured: 2026-05-21T13:19:37+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/b0662984-b598-44eb-a8ed-5cb126e87153/b0662984-b598-44eb-a8ed-5cb126e87153.jsonl
---

## ADR `check` без аргументів читає `.cursor/rules/`, не `AGENTS.md`

## Context and Problem Statement

`npx @nitra/cursor check` без явних аргументів визначав список правил для прогону, парсячи посилання з файлу `AGENTS.md`. Це створювало непряму залежність: `check` і індекс агентів використовували різні шляхи до одного джерела правди, а ручні правила без префікса `n-` могли потрапляти в `AGENTS.md`, але не в `check`, якщо порядок синку ще не завершився.

## Considered Options

* Default `check` із `*.mdc`-файлів у `.cursor/rules/` (disk-first)
* Default `check` із парсингу посилань у `AGENTS.md` (попередня поведінка)

## Decision Outcome

Chosen option: "Default `check` із `*.mdc`-файлів у `.cursor/rules/`", because це єдине джерело правди — усі `*.mdc` (і керовані `n-*`, і ручні) присутні там, а `AGENTS.md` є лише похідним артефактом, що вже генерується з того самого каталогу.

### Consequences

* Good, because `check` і індекс агентів читають один і той самий диск без проміжного файлу; ручні правила автоматично враховуються в `check` без додаткових кроків.
* Bad, because якщо `.cursor/rules/` порожній (синк ще не запускався), `check` без аргументів завершується з помилкою та підказкою, а не мовчки пропускає правила.

## More Information

- Нова утиліта: `npm/scripts/utils/discover-check-rules-from-cursor.mjs` — `discoverCheckRulesFromCursorRules()`, `mdcBasenameToCheckId()`
- Тести: `npm/scripts/utils/discover-check-rules-from-cursor.test.mjs`
- `npm/bin/n-cursor.js` — замінено виклик `discoverCheckRulesFromAgentsMd` на `discoverCheckRulesFromCursorRules`
- Документація оновлена в: `npm/skills/fix/SKILL.md`, `docs/programmatic-checks-for-llm.md`, `.cursor/rules/scripts.mdc`
- Версія пакета `@nitra/cursor`: `1.13.68` → `1.13.69`; запис додано до `npm/CHANGELOG.md`
- Логіка id: `n-bun.mdc` → `bun`, `conftest.mdc` → `conftest`; перетин із `discoverCheckableRules()` у пакеті лишається незмінним
- Явний виклик `npx @nitra/cursor check bun ga …` поведінки не змінює
