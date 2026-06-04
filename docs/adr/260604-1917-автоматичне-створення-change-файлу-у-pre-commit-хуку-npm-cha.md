---
session: 07733932-6418-491f-a9b3-8f94fb6836d9
captured: 2026-06-04T19:17:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/07733932-6418-491f-a9b3-8f94fb6836d9.jsonl
---

## ADR Автоматичне створення change-файлу у pre-commit хуку `npm-changelog`

## Context and Problem Statement

Pre-commit хук `npm-changelog` (визначений у `hk.pkl`) блокує коміт, якщо у workspace `npm/**` є релевантні зміни відносно `main`, але відсутній change-файл у `.changes/`. Поточний флоу вимагає від розробника вручну виконати `npx @nitra/cursor change --bump <major|minor|patch> --section <...> --message "<...>"` перед кожним комітом. Це точка тертя: коміт відхиляється, користувач мусить вгадати параметри й повторити спробу.

## Considered Options

* Автоматично створювати change-файл у самому хуку або через `PostToolUse` hook (аналогічно до репо `7n`)
* Залишити поточний ручний флоу (користувач сам викликає `npx @nitra/cursor change ...`)

## Decision Outcome

Chosen option: "автоматичне створення change-файлу", because користувач явно попросив «давай він сам буде створювати» і вказав на репо `/Users/vitaliytv/www/vitaliytv/7n` як на еталон поведінки при push. Розслідування сфокусувалося на `npm/scripts/post-tool-use-fix.mjs` (PostToolUse-hook Claude Code) і конфігурації `.claude/settings.json` як на потенційному механізмі авто-виправлення.

### Consequences

* Good, because transcript фіксує очікувану користь: коміт проходитиме без ручного кроку `npx @nitra/cursor change ...`, що усуває точку тертя в щоденному флоу.
* Bad, because transcript не містить підтверджених негативних наслідків (реалізація на момент завершення сесії не була завершена — перерване дослідження `post-tool-use-fix.mjs`).

## More Information

* Хук, що блокує коміт: крок `npm-changelog` у `hk.pkl`, команда `bun ./npm/bin/n-cursor.js fix changelog`
* Команда для ручного створення change-файлу (поточна): `npx @nitra/cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<...>"`
* Репо-еталон: `/Users/vitaliytv/www/vitaliytv/7n` — використовує `.changes/*.md` (change-файли), `hk.pkl` і `.claude/settings.json` з PostToolUse-хуком `capture-decisions.sh`
* Досліджуваний механізм: `npm/scripts/post-tool-use-fix.mjs` + `PostToolUse` hook у `.claude/settings.json`
* Правила: `n-changelog.mdc`, `npm/rules/changelog/fix.mjs`, `npm/rules/release/change.mjs`
* Попередження в логах: `check deprecated — використовуйте fix`; `core.hooksPath is set locally` (не критично, але потребує `git config --local --unset-all core.hooksPath` для усунення шуму)
