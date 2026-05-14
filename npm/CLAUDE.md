<!-- Файл генерується автоматично через `npx @nitra/cursor`. Не редагуй вручну. -->

# Робота в `npm/`

Path-scoped нагадування для агента: підвантажується автоматично, коли редагуємо файли під `npm/`.

## Перед PR з коміт-релевантними змінами в `npm/`

1. Підвищ `version` у `npm/package.json` (build-bump, не більше одного кроку відносно `HEAD`).
2. Додай запис у `npm/CHANGELOG.md` форматом Keep a Changelog: `## [версія] - YYYY-MM-DD` + секції `### Added/Changed/Fixed/Removed`.
3. Переконайся, що `"CHANGELOG.md"` є в масиві `files` у `npm/package.json` (правило `changelog`).

Логіка PR-scoped: bump і запис достатньо зробити **один раз — як суму по всьому PR** (порівняння йде з гілкою `dev`), а не на кожен коміт.

Без оновленого CHANGELOG `npx @nitra/cursor check changelog` падає, а `Stop` hook блокує завершення ходу.

## Перевірка локально

```bash
npx @nitra/cursor check changelog
npx @nitra/cursor check npm-module
```

## Перш ніж писати / розширювати `check-*.mjs`

**STOP — спершу пройди алгоритм Rego-first** (`.cursor/rules/conftest.mdc`, alwaysApply). Це стосується **і нової** перевірки, **і додавання нового deny у вже існуючий** `js/check.mjs`: подивись `npm/rules/<rule>/policy/`, чи задача не лягає у вже існуючий rego-пакет як ще одне `deny contains`.

Швидкий self-check для нової перевірки (порядок важливий):

1. **Це пер-документна перевірка одного JSON/YAML?** (наявність / форма поля, regex по значенню, перелік дозволених літералів). → **Rego, без JS-коду.** Пиши у `npm/rules/<rule>/policy/<name>/<name>.rego` + `<name>_test.rego`.
2. Потрібен `readdir`, `stat`, парність файлів, AST-парсинг JS/TS, autofix, modeline до YAML-body? → **JS** у `js/check.mjs`. Per-document частина (якщо є) усе одно лишається у rego — JS викликає її через `runConftestBatch`.
3. Не впевнений? Подивись референс **`npm/rules/k8s/policy/*`** ↔ **`npm/rules/k8s/js/check.mjs`** (Plan B: Rego-authoritative + JS-orchestrator) і список «що Rego об'єктивно не вміє» у `conftest.mdc`.

**Червоний прапор:** дописуєш `if (pkg.<field>) fail(…)` у JS — майже завжди це варто було робити як `deny contains msg if { … }` у відповідному rego-пакеті. Перевір `npm/rules/<rule>/policy/` **перед** редагуванням `js/check.mjs`.

## Джерело правил

- `.cursor/rules/n-changelog.mdc` — правило про CHANGELOG (PR-scoped, для всіх воркспейсів)
- `.cursor/rules/n-npm-module.mdc` — правило публікації пакета (типи, hk, npm-publish workflow)
- `npm/rules/changelog/js/check.mjs`, `npm/rules/npm-module/js/check.mjs` — алгоритми перевірки
