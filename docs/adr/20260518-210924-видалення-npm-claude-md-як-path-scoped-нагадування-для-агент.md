---
session: 13b1f06d-3620-43eb-afdb-901ee439a314
captured: 2026-05-18T21:09:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/13b1f06d-3620-43eb-afdb-901ee439a314.jsonl
---

The transcript describes several design decisions. I'll document the most significant one.

```markdown
## ADR Видалення `npm/CLAUDE.md` як path-scoped нагадування для агента

## Context and Problem Statement
У репозиторії `@nitra/cursor` існував автоматично генерований файл `npm/CLAUDE.md`, що підвантажувався Claude Code як path-scoped контекст у каталозі `npm/`. Його вміст дублював правила, що вже описані або можуть бути описані в `.cursor/rules/scripts.mdc`, яке завжди завантажується (`alwaysApply: true`). Це спричиняло дублювання та зайву складність в підтримці пакету.

## Considered Options
* Залишити `npm/CLAUDE.md` і лише синхронізувати контент із `scripts.mdc`
* Прибрати функціонал повністю: видалити `npm/CLAUDE.md`, шаблон `npm/.claude-template/npm-CLAUDE.md`, функцію `syncNpmClaudeMd()` та всі пов'язані посилання

## Decision Outcome
Chosen option: "Прибрати функціонал повністю", because користувач обрав цей варіант явно, а `scripts.mdc` із `alwaysApply: true` покриває ту саму аудиторію без path-scoped обмеження.

### Consequences
* Good, because усувається дублювання: PR-bump + CHANGELOG + Rego-first STOP тепер живуть в одному місці — `scripts.mdc`.
* Bad, because `npm/CLAUDE.md` підвантажувався лише в `npm/` (path-scoped), тоді як `scripts.mdc` завантажується завжди — широке покриття потенційно додає зайвий контекст за межами `npm/`.

## More Information
- Видалені файли: `npm/CLAUDE.md`, `npm/.claude-template/npm-CLAUDE.md`
- Видалена функція: `syncNpmClaudeMd()` у `npm/scripts/sync-claude-config.mjs`
- Оновлені файли: `npm/bin/n-cursor.js` (JSDoc + рядок результату sync), `npm/schemas/n-cursor.json` (опис поля `claude-config`), `npm/scripts/sync-claude-config.test.mjs` (видалено npm/CLAUDE.md-специфічні тести)
- Bump: `npm/package.json` `1.13.42` → `1.13.43`, запис у `npm/CHANGELOG.md`
- Тест: `bun test scripts/sync-claude-config.test.mjs` — 17/17 pass після видалення
```
