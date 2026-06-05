---
session: 950a0626-7810-4260-98c5-ecc7609bbd3a
captured: 2026-06-05T10:47:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/950a0626-7810-4260-98c5-ecc7609bbd3a.jsonl
---

## ADR Доступ до змінних оточення через `node:process` замість прямого `process.env`

## Context and Problem Statement
У файлі `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` на рядку 887 виявлено пряме звернення до `process.env.N_CURSOR_CHANGELOG_AUTOFIX`. Правило `n-js-run.mdc` забороняє такий доступ і вимагає або `env` з `@nitra/check-env` (для обов'язкових змінних із `checkEnv([...])`) або іменованого імпорту з `node:process` (для опційних).

## Considered Options
* Замінити `process.env.X` на `import { env } from 'node:process'` (опційна змінна)
* Замінити `process.env.X` на `env` з `@nitra/check-env` + `checkEnv([...])` (обов'язкова змінна)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `process.env.X` на `import { env } from 'node:process'`", because `N_CURSOR_CHANGELOG_AUTOFIX` є опційною змінною в контексті тесту — правило `n-js-run.mdc` допускає `node:process` саме для таких випадків.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення перевірка `fix js-run` завершилася без зауважень (`✨ Результат: 1/1 правил без зауважень`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл із виправленням: `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` (рядки ~887+)
- Правило: `.cursor/rules/n-js-run.mdc` (version 1.11)
- Команда перевірки: `npx @nitra/cursor fix js-run`

---

## ADR Обов'язковий крок "Release (bump + CHANGELOG + tag)" у `npm-publish.yml`

## Context and Problem Statement
GitHub Actions workflow `.github/workflows/npm-publish.yml` у job `release-publish` не містив кроку з назвою `"Release (bump + CHANGELOG + tag)"`. Правило `n-npm-module.mdc` вимагає наявності саме такого кроку для npm-модульних репозиторіїв.

## Considered Options
* Додати крок з `name: "Release (bump + CHANGELOG + tag)"` у `jobs.release-publish.steps`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати крок `name: \"Release (bump + CHANGELOG + tag)\"`", because це явна вимога правила `n-npm-module.mdc` для стандартизації CI-пайплайну npm-пакетів у монорепо.

### Consequences
* Good, because transcript фіксує очікувану користь: перевірка `fix npm-module` завершилася без зауважень після виправлення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `.github/workflows/npm-publish.yml`, job `release-publish`
- Правило: `.cursor/rules/n-npm-module.mdc` (version 1.14, glob `.github/workflows/npm-publish.yml`)
- Команда перевірки: `npx @nitra/cursor fix npm-module`
- Форматування після змін: `bunx oxfmt .`
