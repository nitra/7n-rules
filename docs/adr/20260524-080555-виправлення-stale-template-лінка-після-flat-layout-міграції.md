---
session: 0bdb26d7-a893-4fa6-b1c5-b51dd0d4b627
captured: 2026-05-24T08:05:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/0bdb26d7-a893-4fa6-b1c5-b51dd0d4b627.jsonl
---

## ADR Виправлення stale template-лінка після flat-layout міграції `adr`

## Context and Problem Statement
`bun start` (команда `bun ./npm/bin/n-cursor.js`) падав з помилкою `inlineTemplateLinks: file not found: .../rules/adr/js/hooks/template/.gitignore.snippet`. Комміт `6ecd84c` ("refactor(rules): flat layout js/<concern>.mjs") перевів директорію `adr/js/` на flat-layout (`js/hooks.mjs` як файл + `js/templates/hooks/` як директорія з template-файлами), але посилання в `adr.mdc:98` лишилося старим: `./js/hooks/template/.gitignore.snippet`.

## Considered Options
* Виправити лінк у `adr.mdc` до актуального шляху `./js/templates/hooks/.gitignore.snippet`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити лінк у `adr.mdc` до актуального шляху `./js/templates/hooks/.gitignore.snippet`", because реальний файл існує за шляхом `npm/rules/adr/js/templates/hooks/.gitignore.snippet` — що підтверджено `find` та `ls`, а `bun start` після правки пройшов без помилок (`adr → .cursor/rules/n-adr.mdc ... ✅`).

### Consequences
* Good, because `bun start` завантажує всі 15 правил успішно без помилок `inlineTemplateLinks`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/adr/adr.mdc` (рядок 98), `npm/CHANGELOG.md`, `npm/package.json`
- Версія bumped: `1.15.0` → `1.15.1`
- Регресія внесена комітом `6ecd84c refactor(rules): flat layout js/<concern>.mjs (міграційний move)`
- Канонічна структура після міграції: `rules/<id>/js/<concern>.mjs` (файл) + `rules/<id>/js/templates/<concern>/` (директорія з snippets)
