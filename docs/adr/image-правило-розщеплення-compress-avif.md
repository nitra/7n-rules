# Розщеплення правила `image` на `image-compress` і `image-avif`

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

У монорепо з кількома Vue-проєктами (наприклад, адмінка та публічний сайт) стиснення зображень потрібне для всіх workspace-пакетів, а AVIF-конвертація — лише для внутрішніх застосунків, де браузерна підтримка гарантована. Єдине правило `image` не дозволяло вимкнути лише AVIF для конкретного шляху, залишивши стиснення активним.

## Рішення/Процедура/Факт

Правило `image` розщеплено на два самостійних:

- **`image-compress`** — валідує `lint-image` скрипт, `.gitignore`, заборонені залежності, легасі-кеш (`npm/scripts/check-image-compress.mjs`, `npm/mdc/image-compress.mdc`).
- **`image-avif`** — AVIF-pipeline: генерація `--avif`, переписування raster-посилань у `.vue`/`.html`, прибирання сиріт (`npm/scripts/check-image-avif.mjs`, `npm/mdc/image-avif.mdc`).

Для opt-out AVIF у конкретному workspace-пакеті: `"@nitra/minify-image": { "disable-avif": true }` у `package.json` цього пакета — `check image-avif` пропускає його цілком.

Автодетект залежностей у `auto-rules.mjs`: `image-compress` залежить від `bun`; `image-avif` залежить від `vue` і `image-compress` — без `image-compress` правило `image-avif` не активується.

Автоміграція через `RULE_MIGRATIONS` у `auto-rules.mjs`: при читанні `.n-cursor.json` старий ідентифікатор `image` замінюється на `['image-compress', 'image-avif']` із відповідним логом під час виконання `npx @nitra/cursor`.

Старі файли видалено: `check-image.mjs`, `mdc/image.mdc`, `.cursor/rules/n-image.mdc`, `tests/check-image.test.mjs`. Версія пакета піднята з 1.8.194 до 1.8.199.

## Обґрунтування

Гранулярне виключення на рівні правила (а не шляху цілком) необхідне через семантичну різницю між стисненням (безпечно скрізь) та AVIF (лише де є повна підтримка браузерів). Роздроблення є єдиним способом задовольнити цей use-case без власної логіки у кожному конкретному репозиторії.

## Розглянуті альтернативи

- Розширити поле `ignore` об'єктним записом `{ "path": "apps/site", "rules": ["image"] }` — відхилено як семантично перевантажене.
- Додати окреме поле `disable-rules-paths` у `.n-cursor.json` — відхилено як надлишкове, якщо opt-out можна зробити на рівні `package.json` workspace.
- Використати наявний `"disable-avif": true` у `package.json` без розщеплення — вирішує конкретний use-case, але не дає загального механізму перемикання AVIF через `.n-cursor.json`.

## Зачіпає

`npm/scripts/check-image-compress.mjs`, `npm/scripts/check-image-avif.mjs`, `npm/scripts/auto-rules.mjs`, `npm/bin/n-cursor.js`, `npm/mdc/image-compress.mdc`, `npm/mdc/image-avif.mdc`, `npm/tests/check-image-compress.test.mjs`, `npm/tests/check-image-avif.test.mjs`, `npm/tests/auto-rules.test.mjs`, `.n-cursor.json`, `CLAUDE.md`, `AGENTS.md`, `npm/CHANGELOG.md`, `npm/package.json`.
