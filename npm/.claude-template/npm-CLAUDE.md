<!-- Файл генерується автоматично через `npx @nitra/cursor`. Не редагуй вручну. -->

# Робота в `npm/`

Path-scoped нагадування для агента: підвантажується автоматично, коли редагуємо файли під `npm/`.

## Перед коміт-релевантними змінами в `npm/`

1. Підвищ `version` у `npm/package.json` (build-bump, не більше одного кроку відносно `HEAD`).
2. Додай запис у `npm/CHANGELOG.md` форматом Keep a Changelog: `## [версія] - YYYY-MM-DD` + секції `### Added/Changed/Fixed/Removed`.

Без обох пунктів `npx @nitra/cursor check npm-module` падає, а `Stop` hook блокує завершення ходу.

## Перевірка локально

```bash
npx @nitra/cursor check npm-module
```

## Джерело правил

- `.cursor/rules/n-npm-module.mdc` — повний текст правила
- `npm/scripts/check-npm-module.mjs` — алгоритм перевірки
