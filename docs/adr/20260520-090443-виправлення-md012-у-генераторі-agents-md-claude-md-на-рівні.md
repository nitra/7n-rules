---
session: 4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9
captured: 2026-05-20T09:04:43+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9.jsonl
---

## ADR Виправлення MD012 у генераторі AGENTS.md / CLAUDE.md на рівні шаблонізатора

## Context and Problem Statement
`npx @nitra/cursor` генерував `AGENTS.md` і `CLAUDE.md` з подвійними порожніми рядками (порушення MD012), покладаючись на наступний `lint-text`-прохід для їх видалення. Користувач зафіксував це як recurring pattern і запропонував виправити генератор шаблонів, а не симптом.

## Considered Options
* Виправити генератор шаблонів так, щоб він одразу видавав lint-чистий markdown.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити генератор шаблонів", because transcript прямо вказує: lint-прохід не повинен компенсувати артефакти генератора; diff мав лишатися мінімальним і lint-чистим з першого разу.

### Consequences
* Good, because `npx @nitra/cursor` більше не потребує окремого lint-кроку лише для зачистки `AGENTS.md` / `CLAUDE.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нова утиліта: `npm/scripts/utils/generated-markdown.mjs` — функції `collapseMultipleBlankLines` (regex `\n{3,}` → `\n\n`), `expandMustacheSection` (trim inner-шаблону + `join('\n')` між елементами), `renderAgentsTemplate`, `formatGeneratedMarkdownLines`.
- `npm/bin/n-cursor.js` — inline-логіка замінена імпортом з нової утиліти.
- Тести: `npm/scripts/utils/generated-markdown.test.mjs`.
- Версія пакета: `1.13.60`.
- Запис у `CHANGELOG.md`: секція `[1.13.60] - 2026-05-20 ### Fixed`.

---

## ADR Структура утиліти generated-markdown.mjs

## Context and Problem Statement
Inline-логіка в `npm/bin/n-cursor.js` містила `expandMustacheSection` і збирання рядків CLAUDE.md без нормалізації пробілів. Потрібно було централізувати й покрити тестами генерацію markdown для обох файлів.

## Considered Options
* Винести логіку в окремий модуль `npm/scripts/utils/generated-markdown.mjs`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Окремий модуль `generated-markdown.mjs`", because transcript показує: функції `collapseMultipleBlankLines`, `expandMustacheSection`, `renderAgentsTemplate`, `formatGeneratedMarkdownLines` перенесені з `n-cursor.js` до утиліти з власним тест-файлом.

### Consequences
* Good, because transcript фіксує очікувану користь: функції покриті юніт-тестами (`bun:test`), ESLint і cspell перевіряють їх окремо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `collapseMultipleBlankLines(text)` — замінює `\n{3,}` на `\n\n`.
- `expandMustacheSection(template, section, items, prop)` — trim inner body + `join('\n')`.
- `renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems)` — повертає вміст `AGENTS.md` без подвійних порожніх рядків.
- `formatGeneratedMarkdownLines(lines)` — збирає рядки CLAUDE.md із завершальним `\n`, застосовує `collapseMultipleBlankLines`.
- Тест-файл: `npm/scripts/utils/generated-markdown.test.mjs`; константа `TRIPLE_OR_MORE_NEWLINES` для regex (правило `e18e/prefer-static-regex`).
