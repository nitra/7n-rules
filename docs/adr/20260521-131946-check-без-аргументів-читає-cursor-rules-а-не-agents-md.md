---
session: b0662984-b598-44eb-a8ed-5cb126e87153
captured: 2026-05-21T13:19:46+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/b0662984-b598-44eb-a8ed-5cb126e87153/b0662984-b598-44eb-a8ed-5cb126e87153.jsonl
---

## ADR `check` без аргументів читає `.cursor/rules/`, а не `AGENTS.md`

## Context and Problem Statement
`npx @nitra/cursor check` без аргументів визначав перелік правил для прогону через парсинг згенерованого файлу `AGENTS.md`. Це створювало дві різні моделі: індекс агентів (`AGENTS.md`, `CLAUDE.md`) будувався напряму з диска (`.cursor/rules/*.mdc`), а `check` залежав від проміжного файлу, що читався вторинно.

## Considered Options
* Парсинг `AGENTS.md` для виявлення правил (попередня поведінка)
* Пряме сканування `.cursor/rules/*.mdc` без проміжного файлу

## Decision Outcome
Chosen option: "Пряме сканування `.cursor/rules/*.mdc`", because `AGENTS.md` і `CLAUDE.md` вже будуються disk-first; `check` мав читати те саме джерело, щоб ручні правила (без префікса `n-`) і керовані `n-*` оброблялися однаково.

### Consequences
* Good, because `check` і індекс агентів тепер читають одне й те саме джерело — `.cursor/rules/`; проміжний файл `AGENTS.md` більше не потрібен для discovery.
* Good, because ручні `.mdc` без префікса `n-` (наприклад `conftest.mdc`) тепер автоматично потрапляють у `check`, якщо для них є programmatic check у пакеті.
* Bad, because якщо `.cursor/rules/` порожній (синк ще не запускався), `check` без аргументів тепер падає з помилкою й підказкою запустити синк або передати правила явно.

## More Information
Нова утиліта `npm/scripts/utils/discover-check-rules-from-cursor.mjs` реалізує `discoverCheckRulesFromCursorRules()` і `mdcBasenameToCheckId()` (перетворення `n-bun.mdc` → `bun`, `conftest.mdc` → `conftest`). Тести — `npm/scripts/utils/discover-check-rules-from-cursor.test.mjs` (bun:test). Алгоритм: `readdir(.cursor/rules)` → `*.mdc` → id → перетин із `discoverCheckableRules()` пакета → алфавітний порядок. Змінені файли: `npm/bin/n-cursor.js` (заміна `discoverCheckRulesFromAgentsMd` на `discoverCheckRulesFromCursorRules`), `npm/skills/fix/SKILL.md`, `docs/programmatic-checks-for-llm.md`, `.cursor/rules/scripts.mdc`. Версія пакета підвищена до `1.13.69`.
