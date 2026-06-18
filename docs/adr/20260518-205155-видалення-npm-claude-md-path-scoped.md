---
type: ADR
title: "Видалення `npm/CLAUDE.md` як path-scoped нагадування"
---

# Видалення `npm/CLAUDE.md` як path-scoped нагадування

**Status:** Accepted
**Date:** 2026-05-18

## Context and Problem Statement

У пакеті `@nitra/cursor` автоматично генерувався файл `npm/CLAUDE.md` через функцію `syncNpmClaudeMd()` у `npm/scripts/sync-claude-config.mjs` із шаблону `npm/.claude-template/npm-CLAUDE.md`. Він підвантажувався Claude Code як path-scoped контекст лише при роботі в каталозі `npm/` і містив нагадування для агента (bump `version`, `CHANGELOG.md`, Rego-first STOP). Той самий вміст дублював правила у `.cursor/rules/scripts.mdc` (`alwaysApply: true`), що спричиняло дублювання і зайву складність у підтримці.

## Considered Options

- Залишити `npm/CLAUDE.md` і лише синхронізувати контент із `scripts.mdc`
- Прибрати функціонал повністю: видалити `npm/CLAUDE.md`, шаблон `npm/.claude-template/npm-CLAUDE.md`, функцію `syncNpmClaudeMd()` та всі пов'язані посилання

## Decision Outcome

Chosen option: "Прибрати функціонал повністю", because користувач явно обрав цей варіант і вказав перенести «все окрім того що вже описано в changelog правилі» до `.cursor/rules/scripts.mdc`; `scripts.mdc` із `alwaysApply: true` покриває ту саму аудиторію без path-scoped обмеження.

### Consequences

- Good, because усувається дублювання між `npm/CLAUDE.md`, `n-changelog.mdc` та `scripts.mdc`; зменшується поверхня генерованих файлів у проєктах-споживачах `@nitra/cursor`.
- Bad, because `npm/CLAUDE.md` підвантажувався лише в `npm/` (path-scoped), тоді як `scripts.mdc` завантажується завжди — широке покриття потенційно додає зайвий контекст за межами `npm/`.

## More Information

Видалені файли: `npm/CLAUDE.md`, `npm/.claude-template/npm-CLAUDE.md`.
Видалені символи: `syncNpmClaudeMd()`, `NPM_CLAUDE_MD_FILE`, поле `npmClaudeMd` у return-об'єкті `syncClaudeConfig`.
Змінені файли: `npm/scripts/sync-claude-config.mjs`, `npm/scripts/sync-claude-config.test.mjs`, `npm/bin/n-cursor.js` (JSDoc + рядок результату sync), `npm/schemas/n-cursor.json` (опис поля `claude-config`), `.cursor/rules/scripts.mdc` (версія `1.7` → `1.8`).
Версія пакету: `1.13.42` → `1.13.43`; запис у `npm/CHANGELOG.md`.
Верифікація: 17/17 тестів `sync-claude-config.test.mjs` pass.
