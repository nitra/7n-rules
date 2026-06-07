---
session: a934d2a8-ef58-4ed7-871f-be4386ea2c81
captured: 2026-06-07T06:46:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/a934d2a8-ef58-4ed7-871f-be4386ea2c81.jsonl
---

## ADR Додати `lib/` до поля `files` у `npm/package.json`

## Context and Problem Statement
Пакет `@nitra/cursor` при публікації (`npm publish`) не включав директорію `lib/`, хоча `skills/fix/js/llm-worker.mjs`, `scripts/coverage-fix.mjs` та `scripts/coverage-classify/index.mjs` імпортували `../lib/models.mjs`. Поле `files` у `npm/package.json` містило лише `"scripts"` та `"skills"`, але не `"lib"`.

## Considered Options
* Додати `"lib"` до масиву `files` у `npm/package.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `"lib"` до масиву `files` у `npm/package.json`", because єдиний споживач (`lib/models.mjs`) вже існував у source-репо (`npm/lib/models.mjs`), а пропуск поля `files` — єдина причина відсутності файлу в опублікованому пакеті.

### Consequences
* Good, because `npm pack --dry-run` підтвердив появу `lib/models.mjs` (3.7kB) у пакеті після правки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/package.json`, масив `files` — додано рядок `"lib"` перед `"scripts"`
- Перевірка: `cd npm && npm pack --dry-run 2>&1 | grep 'lib/'` → рядок `lib/models.mjs` присутній
- Change-файл: `.changes/260607-0645.md`, згенеровано командою `npx @nitra/cursor change --bump patch --section Fixed --message "add lib/ to package files — npm publish was missing top-level lib/"`
- Після зміни: `npx @nitra/cursor fix changelog` → `✅ fix: 1 правил — все чисто`
