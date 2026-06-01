---
session: 4380e6b2-33e6-4554-a86e-0e6f3214233c
captured: 2026-06-01T19:11:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4380e6b2-33e6-4554-a86e-0e6f3214233c.jsonl
---

## ADR Явна devDependency для `@e18e/eslint-plugin` у корені монорепо

## Context and Problem Statement
`@nitra/eslint-config@3.10.0` більше не постачає `@e18e/eslint-plugin` як транзитивну залежність (незважаючи на CHANGELOG-запис про додання у 3.8.0), тоді як `.oxlintrc.json` оголошує `"jsPlugins": ["@e18e/eslint-plugin"]`. Через це `bun run lint` падав із помилкою відсутнього плагіна.

## Considered Options
* Додати `@e18e/eslint-plugin` до root `devDependencies` явно
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `@e18e/eslint-plugin` до root `devDependencies` явно", because транзитивне підключення через `@nitra/eslint-config` виявилося ненадійним після оновлення до 3.10.0, тож користувач вирішив зафіксувати пряму залежність.

### Consequences
* Good, because `bun add -d @e18e/eslint-plugin` (версія 0.5.0) усунув помилку завантаження плагіна й дозволив `bun run lint` продовжити роботу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `.oxlintrc.json` — `"jsPlugins": ["@e18e/eslint-plugin"]`
- Правило: `npm/rules/js-lint-ci/js-lint-ci.mdc` — стверджувало транзитивне підключення через `@nitra/eslint-config` (з 3.8.0)
- Команда: `bun add -d @e18e/eslint-plugin` → встановлено `@e18e/eslint-plugin@0.5.0`
- Встановлена версія `@nitra/eslint-config`: `3.10.0`; її `package.json` не містить `@e18e/*` у залежностях
