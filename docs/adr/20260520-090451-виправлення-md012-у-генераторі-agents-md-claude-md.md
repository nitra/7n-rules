---
session: 4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9
captured: 2026-05-20T09:04:51+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9/4a58ed9e-8a61-40a9-9dcf-b10d7340d0f9.jsonl
---

## ADR Виправлення MD012 у генераторі AGENTS.md / CLAUDE.md

## Context and Problem Statement
`npx @nitra/cursor` генерував `AGENTS.md` і `CLAUDE.md` з подвійними порожніми рядками (MD012) і покладався на наступний `lint-text`-прохід для зачистки. Це призводило до мінімальних ручних правок при кожній регенерації, щоб diff лишався lint-чистим.

## Considered Options
* Виправити генератор так, щоб одразу віддавати MD012-чистий файл
* Залишити поточну поведінку (генератор → lint-прохід)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити генератор так, щоб одразу віддавати MD012-чистий файл", because ручне мінімізування diff-у при кожній регенерації було recurring-pattern; усунення проблеми на рівні генератора виключає залежність від окремого lint-проходу.

### Consequences
* Good, because `lint-text` більше не потрібен лише для зачистки подвійних рядків у двох файлах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Два джерела MD012 виявлені в transcript:
- `AGENTS.md`: `expandMustacheSection` використовував inner-шаблон `\n{{name}}\n` і `join('')`, що давало зайвий порожній рядок між кожним `- .cursor/rules/…`.
- `CLAUDE.md`: на стику `buildClaudeLintParallelismSectionLines()` (завершувався `''`) і `buildClaudeSkillsSectionLines()` (починався з `''`) виходило `\n\n\n` перед `## Skills`.

Виправлення: функція `collapseMultipleBlankLines` замінює `\n{3,}` на `\n\n`; `expandMustacheSection` тепер trim-ить inner-шаблон і з'єднує елементи через `join('\n')`.
Зміни у файлах: `npm/scripts/utils/generated-markdown.mjs` (нова утиліта), `npm/bin/n-cursor.js` (імпорт замість inline-логіки). Версія пакета: `1.13.60`.

---

## ADR Винесення утиліт генерації markdown у окремий модуль із тестами

## Context and Problem Statement
Логіка розгортання Mustache-секцій і збирання рядків `CLAUDE.md` була inline в `npm/bin/n-cursor.js`. Додавання нормалізації MD012 вимагало розширення цієї логіки, а тестувати inline-код у `bin`-файлі неможливо без запуску CLI.

## Considered Options
* Винести утиліти в `npm/scripts/utils/generated-markdown.mjs` з окремим test-файлом
* Залишити логіку в `n-cursor.js` і розширити її inline
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Винести утиліти в `npm/scripts/utils/generated-markdown.mjs` з окремим test-файлом", because окремий модуль дозволяє unit-тестувати `collapseMultipleBlankLines`, `expandMustacheSection`, `renderAgentsTemplate`, `formatGeneratedMarkdownLines` без запуску CLI.

### Consequences
* Good, because transcript фіксує очікувану користь: тести (`generated-markdown.test.mjs`) пройшли ще до lint-прогону, підтвердивши коректність нормалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові експортовані функції в `npm/scripts/utils/generated-markdown.mjs`:
- `collapseMultipleBlankLines(text)` — `\n{3,}` → `\n\n`
- `expandMustacheSection(template, section, items, prop)` — trim inner, `join('\n')`
- `renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems)` — готовий вміст `AGENTS.md`
- `formatGeneratedMarkdownLines(lines)` — збирає рядки `CLAUDE.md` із фінальним `\n`

Тести: `npm/scripts/utils/generated-markdown.test.mjs` (використовує `bun:test`).
Константа `TRIPLE_OR_MORE_NEWLINES` винесена статично у тест-файлі (`e18e/prefer-static-regex`).
