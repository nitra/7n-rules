---
session: 13b1f06d-3620-43eb-afdb-901ee439a314
captured: 2026-05-18T20:51:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/13b1f06d-3620-43eb-afdb-901ee439a314.jsonl
---

## ADR Видалення `npm/CLAUDE.md` як path-scoped нагадування

## Context and Problem Statement
Файл `npm/CLAUDE.md` генерувався автоматично через `syncNpmClaudeMd()` у `npm/scripts/sync-claude-config.mjs` і розгортався у всіх споживачів пакету `@nitra/cursor`, у кого є каталог `npm/`. Він дублював правила, що вже описані або могли бути описані у `.cursor/rules/scripts.mdc` (яке `alwaysApply: true`), і це призводило до дублювання контенту.

## Considered Options
* Перенести контент у `.cursor/rules/scripts.mdc` і повністю прибрати `npm/CLAUDE.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести контент у `.cursor/rules/scripts.mdc` і повністю прибрати `npm/CLAUDE.md`", because користувач явно обрав варіант "Прибрати функціонал повністю" і вказав перенести "все окрім того що вже описано в changelog правилі".

### Consequences
* Good, because transcript фіксує очікувану користь: усунення дублювання між `npm/CLAUDE.md` (path-scoped) і `scripts.mdc` (`alwaysApply: true`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені файли: `npm/CLAUDE.md`, `npm/.claude-template/npm-CLAUDE.md`.
Видалені символи: `syncNpmClaudeMd()`, `NPM_CLAUDE_MD_FILE`, поле `npmClaudeMd` у return-об'єкті `syncClaudeConfig`.
Змінені файли: `npm/scripts/sync-claude-config.mjs`, `npm/scripts/sync-claude-config.test.mjs`, `npm/bin/n-cursor.js`, `npm/schemas/n-cursor.json`, `.cursor/rules/scripts.mdc` (версія `1.7` → `1.8`).
Версія пакету: `1.13.42` → `1.13.43`.
Підтвердження: 17/17 тестів `sync-claude-config.test.mjs` pass, `bunx @nitra/cursor check changelog` exit 0.
