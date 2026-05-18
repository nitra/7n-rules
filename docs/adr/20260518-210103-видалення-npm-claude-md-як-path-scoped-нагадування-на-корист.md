---
session: 13b1f06d-3620-43eb-afdb-901ee439a314
captured: 2026-05-18T21:01:03+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/13b1f06d-3620-43eb-afdb-901ee439a314.jsonl
---

Based on the transcript, the session covers one clear architectural decision: removing `npm/CLAUDE.md` as a path-scoped reminder mechanism and consolidating its content into `.cursor/rules/scripts.mdc`. Here is the ADR:

## ADR Видалення `npm/CLAUDE.md` як path-scoped нагадування на користь `scripts.mdc`

## Context and Problem Statement

У проєкті існував файл `npm/CLAUDE.md`, що автогенерувався через `syncNpmClaudeMd()` у `npm/scripts/sync-claude-config.mjs` із шаблону `npm/.claude-template/npm-CLAUDE.md`. Він містив path-scoped нагадування для агента (bump `version`, `CHANGELOG.md`, Rego-first STOP) і підвантажувався автоматично лише при редагуванні файлів під `npm/`. Водночас більшість цього вмісту або дублювала вже існуючі правила (`n-changelog.mdc`, `scripts.mdc`), або мала потрапити до `scripts.mdc`.

## Considered Options

* Перенести унікальний вміст `npm/CLAUDE.md` у `.cursor/rules/scripts.mdc` і повністю видалити файл та інфраструктуру його генерації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести унікальний вміст у `scripts.mdc` і видалити файл повністю", because користувач явно підтвердив scope "Прибрати функціонал повністю" і вказав перенести "все окрім того що вже описано в changelog правилі".

### Consequences

* Good, because transcript фіксує очікувану користь: усунення дублювання між `npm/CLAUDE.md`, `n-changelog.mdc` та `scripts.mdc`; зменшення поверхні генерованих файлів у проєктах-споживачах `@nitra/cursor`.
* Bad, because після видалення path-scoped підвантаження агент більше не отримує нагадування автоматично лише при роботі в `npm/` — натомість секція у `scripts.mdc` (`alwaysApply: true`) завантажується завжди, що збільшує постійний контекст для всіх сесій.

## More Information

Змінені файли:
- `npm/.claude-template/npm-CLAUDE.md` — видалено
- `npm/CLAUDE.md` — видалено
- `npm/scripts/sync-claude-config.mjs` — видалено функцію `syncNpmClaudeMd()`, константу `NPM_CLAUDE_MD_FILE`, ключ `npmClaudeMd` у return-об'єкті
- `npm/scripts/sync-claude-config.test.mjs` — видалено тести, що перевіряли копіювання `npm/CLAUDE.md`
- `npm/bin/n-cursor.js` — прибрано згадку `npm/CLAUDE.md` у JSDoc і рядку результату sync
- `npm/schemas/n-cursor.json` — оновлено опис поля `claude-config`
- `.cursor/rules/scripts.mdc` — додано розділ "Перш ніж писати / розширювати `check.mjs`" з Rego-first STOP і self-check; версія `1.7` → `1.8`
- `npm/package.json` — bump `1.13.42` → `1.13.43`
- `npm/CHANGELOG.md` — запис `[1.13.43]`
