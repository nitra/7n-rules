---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-30T07:49:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

✅ Завершено. Три коміти:

- `d1066aa` — тести (auto-committed раніше)
- `5c77b23` — перехід на change-file workflow: version 1.33.1 → 1.33.0, CHANGELOG-секцію прибрано, замінено на `npm/.changes/1780116534790-9f47f9.md` (bump: patch, section: Added)

`fix changelog` ✅ — перевірка пройшла.
---

## ADR Перехід на change-file workflow для версіювання npm-пакета

## Context and Problem Statement
У сесії після серії нових test-файлів (commit `d1066aa`) версія `npm/package.json` та секція `CHANGELOG.md` були оновлені вручну (legacy-формат). Однак правило `n-changelog.mdc v3.0` ввело новий канон: зміни у workspace документуються через change-файли (`npm/.changes/<timestamp>.md`), а version-bump і агрегація CHANGELOG відбуваються автоматично при `release` на main.

## Considered Options
* Залишити legacy-формат (ручний bump `package.json` + секція в `CHANGELOG.md`)
* Перейти на change-file workflow (`npx @nitra/cursor change …` → `npm/.changes/`)

## Decision Outcome
Chosen option: "Перейти на change-file workflow", because `n-changelog.mdc v3.0` встановлює change-файли як канонічний механізм; legacy-формат допускається лише як hotfix-виняток.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix changelog` проходить ✅, version у `package.json` повертається до `1.33.0` до моменту офіційного релізу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `npx @nitra/cursor change --bump patch --section Added --message "…" --ws npm`
- Файл: `npm/.changes/1780116534790-9f47f9.md` (bump: patch, section: Added)
- Правило: `.cursor/rules/n-changelog.mdc v3.0`
- Commit: `5c77b23 refactor(npm): перенесення на change-file workflow`
