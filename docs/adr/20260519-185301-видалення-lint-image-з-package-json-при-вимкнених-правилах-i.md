---
session: 7dce12ed-bc92-4e37-b12d-7d0638806c61
captured: 2026-05-19T18:53:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/7dce12ed-bc92-4e37-b12d-7d0638806c61.jsonl
---

## ADR Видалення `lint-image` з `package.json` при вимкнених правилах image-avif/image-compress

## Context and Problem Statement
`npx @nitra/cursor check` виявив помилку: у кореневому `package.json` присутній скрипт `lint-image`, хоча правила `image-avif` та `image-compress` перелічені в `disable-rules` у `.n-cursor.json`. Чек `npm/rules/bun/fix/layout/check.mjs` вимагає, щоб скрипти вимкнених правил були відсутні в `package.json`.

## Considered Options
* Додати `--src=.` до наявного `lint-image` скрипту (початкова спроба)
* Видалити `lint-image` з `package.json` і прибрати `bun run lint-image` з `scripts.lint`

## Decision Outcome
Chosen option: "Видалити `lint-image` з `package.json`", because правила `image-avif`/`image-compress` знаходяться в `disable-rules` у `.n-cursor.json`, тому відповідний скрипт не повинен існувати взагалі — це вимога `npm/rules/bun/fix/layout/check.mjs` (рядок 130).

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor check` перейшов до `11/12 правил без зауважень` після видалення скрипту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Перевірка: `npm/rules/bun/fix/layout/check.mjs:130` — формує повідомлення `У .n-cursor.json немає активних власників … — прибери скрипт … з кореневого package.json`
- Конфіг: `.n-cursor.json` → `disable-rules: ["image-avif", "image-compress", ...]`
- Файл змінено: `package.json` (root) — видалено `lint-image` зі `scripts` та з `scripts.lint`
- Після синку `npx @nitra/cursor` автоматично видалено `.cursor/rules/n-image-avif.mdc`, `.cursor/rules/n-image-compress.mdc` з `.cursor/rules/` та відповідні записи з `AGENTS.md`

---

## ADR Нефіксованість changelog-помилки `demo` при відсутності `dev`-гілки

## Context and Problem Statement
`npx @nitra/cursor check changelog` повертає `❌ demo: у цій гілці є зміни, але version у demo/package.json не підвищено (на dev — ∅)`. Workspace `demo/` не існує на гілці `dev` (остання є `merge-base` з `main`, але відстає на ~309 комітів), тому `readBaseVersion` повертає `null`, і перевірка хибно вважає version не підвищеною.

## Considered Options
* Bump `version` у `demo/package.json` і додати запис у `demo/CHANGELOG.md`
* Залишити як є — помилка є хибнопозитивною і не може бути усунена з `/n-fix` без злиття `main → dev`

## Decision Outcome
Chosen option: "Залишити як є", because `demo/` не існує на `dev` (підтверджено: `git show dev:demo/package.json` → `fatal: path 'demo/package.json' exists on disk, but not in 'dev'`), а злиття `main → dev` виходить за межі `/n-fix` і потребує окремої авторизації.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку.
* Bad, because `npx @nitra/cursor check` залишається на `11/12` — одне правило (`changelog`) показує помилку для `demo` на кожному запуску до синхронізації `dev` з `main`.

## More Information
- Логіка перевірки: `npm/rules/changelog/fix/consistency/check.mjs:478` — `resolveMergeBase(baseRef)` → `workspaceHasRelevantChangesAgainstBase`
- `git rev-parse dev` → `7a2ae76` (збігається з `merge-base HEAD dev`), `demo/` відсутня на цьому коміті
- Команда для усунення: злиття `main → dev` (потребує авторизації користувача)
