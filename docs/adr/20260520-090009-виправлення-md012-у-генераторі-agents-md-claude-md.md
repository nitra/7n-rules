---
session: 4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9
captured: 2026-05-20T09:00:10+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9.jsonl
---

## ADR Виправлення MD012 у генераторі AGENTS.md / CLAUDE.md

## Context and Problem Statement
`npx @nitra/cursor` генерував `AGENTS.md` і `CLAUDE.md` з подвійними порожніми рядками (порушення MD012): у `AGENTS.md` — через inner-шаблон `\n{{name}}\n` і `join('')` у `expandMustacheSection`, у `CLAUDE.md` — через збіг завершального `''` у `buildClaudeLintParallelismSectionLines()` і початкового `''` у `buildClaudeSkillsSectionLines()`. Проєкт покладався на наступний lint-прохід для зачистки, що змушувало робити надлишкові diff-зміни вручну.

## Considered Options
* Виправити генератор на етапі рендерингу (нормалізація markdown до запису файлу)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити генератор на етапі рендерингу", because user прямо зазначив, що diff має лишатися мінімальним і lint-чистим без додаткового проходу; рішення підтверджено запуском тестів і smoke-перевіркою результату генерації.

### Consequences
* Good, because `AGENTS.md` і `CLAUDE.md` більше не містять подвійних порожніх рядків після генерації — lint-прохід не потрібен лише для зачистки цих двох файлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий модуль: `npm/scripts/utils/generated-markdown.mjs` — функції `collapseMultipleBlankLines()` (collapse `\n{3,}` → `\n\n`), `expandMustacheSection()` (trim inner-шаблон + `join('\n')`), `formatGeneratedMarkdownLines()`, `renderAgentsTemplate()`.
- Тести: `npm/scripts/utils/generated-markdown.test.mjs` (bun:test, усі проходять).
- Змінено: `npm/bin/n-cursor.js` — замінено inline-логіку імпортом з `generated-markdown.mjs`.
- Версія: `1.13.60` у `npm/package.json` і `npm/CHANGELOG.md`.
