---
session: dcbd14cd-85ea-4d0d-9118-6a0f6fc7c58a
captured: 2026-06-11T23:34:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/dcbd14cd-85ea-4d0d-9118-6a0f6fc7c58a.jsonl
---

## ADR Іменовані імпорти `node:path` замість default-імпорту

## Context and Problem Statement

У файлі `npm/skills/doc-files/js/docgen-scan.mjs` default-імпорт `import path from 'node:path'` підпадав під правило `unicorn/import-style`, налаштоване у `@nitra/eslint-config` (рядок 306) так, що для `node:path` дозволені лише named-імпорти. Для замовчування цього порушення стояв `// eslint-disable-next-line unicorn/import-style`, який і потрібно прибрати шляхом реального виправлення.

## Considered Options

* Замінити default-імпорт на named-імпорти і переписати всі `path.xxx` звернення
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Замінити default-імпорт на named-імпорти і переписати всі `path.xxx` звернення", because правило `unicorn/import-style` у `@nitra/eslint-config` явно вимагає `named: true` для `node:path`, тому коментар `eslint-disable` не є прийнятним — виправлення на рівні коду є єдиним відповідним рішенням.

### Consequences

* Good, because transcript фіксує очікувану користь: після рефакторингу `bunx eslint npm/skills/doc-files/js/docgen-scan.mjs npm/skills/doc-files/js/docgen-ignore.mjs` завершився без жодних помилок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файл до зміни: `npm/skills/doc-files/js/docgen-scan.mjs`
- Правило: `unicorn/import-style` у `node_modules/@nitra/eslint-config/index.js:306`
- Новий import-рядок: `import { join, dirname, basename, extname, relative, resolve, sep, isAbsolute, posix } from 'node:path'`
- Замінено: `path.join`, `path.dirname`, `path.basename`, `path.extname`, `path.relative`, `path.resolve`, `path.sep`, `path.isAbsolute`, `path.posix.basename`, `path.posix.dirname` → відповідні іменовані функції напряму
- `docgen-ignore.mjs` жодних `eslint-disable` коментарів не мав — змін не потребував
