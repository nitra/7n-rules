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

## Джерело правил

- `.cursor/rules/n-changelog.mdc` — правило про CHANGELOG (PR-scoped, для всіх воркспейсів)
- `.cursor/rules/n-npm-module.mdc` — правило публікації пакета (типи, hk, npm-publish workflow)
- `npm/scripts/check-changelog.mjs`, `npm/scripts/check-npm-module.mjs` — алгоритми перевірки
