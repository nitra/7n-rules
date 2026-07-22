---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/scaffold/main.mjs
docgen:
  crc: f8ec63bd
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Визначає, чи відповідає Vue-пакет домовленому Storybook-скафолду для library- і app-проєктів, спираючись на `package.json` і очікувані записи в `.storybook/*`. `lint` перевіряє наявність потрібних Storybook-налаштувань і маркерів повідомлень з `storybook.mdc`, а `detectStoriesGlob` виводить очікуваний glob для stories, щоб відрізняти app-структуру від library-структури.

Експортовані константи фіксують канонічні значення: `STORYBOOK_SCRIPT="storybook dev -p 6006 --no-open"` — стандартний script для запуску Storybook; `APP_STORIES_GLOB="../src/**/*.stories.@(js|ts)"` — glob для stories у app-проєкті.

Поведінка fail-safe: код перехоплює помилки, не кидає винятків назовні й за певних збоїв повертає порожнє значення, наприклад `null`.

## Поведінка

- `STORYBOOK_SCRIPT` — канонічний рядок для `package.json#scripts.storybook`: `storybook dev -p 6006 --no-open`.
- `MAIN_JS_MARKERS` — набір маркерів для канонічного `.storybook/main.js` у library-проєктах; перевірка спирається на `storybook.mdc`.
- `PREVIEW_JS_MARKERS` — набір маркерів для канонічного `.storybook/preview.js` у library-проєктах; перевірка спирається на `storybook.mdc`.
- `APP_MAIN_JS_MARKERS` — набір маркерів для канонічного `.storybook/main.js` в app-проєктах.
- `APP_PREVIEW_JS_MARKERS` — набір маркерів для канонічного `.storybook/preview.js` в app-проєктах.
- `APP_STORIES_GLOB` — канонічний glob для story-файлів app-проєктів: `../src/**/*.stories.@(js|ts)`.
- `EMPTY_VITE_CONFIG_MARKERS` — набір маркерів для сусіднього `.storybook/empty-vite.config.js` у library-проєктах.
- `detectStoriesGlob` — визначає glob для story-файлів за структурою пакета; для flat-root випадку повертає корінь пакета, для `src/components` звужує до нього, інакше бере весь `src/`.
- `missingMarkers` — знаходить маркери, яких бракує у вмісті файлу.
- `lint` — перевіряє Storybook-скафолд для всіх Vue-пакетів у скоупі: `.storybook/main.js`, `.storybook/preview.js` і `package.json#scripts.storybook`, а для library-проєктів ще й `.storybook/empty-vite.config.js`; порушення маркуються через повідомлення з `storybook.mdc`, помилки не викидає назовні.

## Публічний API

- STORYBOOK_SCRIPT — Канонічне значення `package.json#scripts.storybook` (storybook.mdc).
- MAIN_JS_MARKERS — Маркери канону `.storybook/main.js`, перевірені текстовим пошуком (без AST — рядки стабільні).
Експортовано — той самий список переюзає `adopt/main.mjs` для diff-діагностики (не дублювати).
- PREVIEW_JS_MARKERS — Маркери канону `.storybook/preview.js`. Експортовано — переюз у `adopt/main.mjs`.
- APP_MAIN_JS_MARKERS — Маркери канону `.storybook/main.js` для app-проєктів (хвиля 2a) — свідома дзеркальна
асиметрія з {@link MAIN_JS_MARKERS} бібліотек: тут немає `viteConfigPath`, бо
`@storybook/builder-vite` навмисно підхоплює ПОВНИЙ `vite.config.js` app-проєкту
(ADR-розширення 2026-07-20, прототип `gt`). Експортовано — переюз у `adopt/main.mjs`.
- APP_PREVIEW_JS_MARKERS — Маркери канону `.storybook/preview.js` для app-проєктів (хвиля 2a): `pageLoader`
(router+pinia на кожну story) і явна реєстрація `QLayout`/`QPageContainer` для
layout-декоратора story-файлу — на додачу до спільних msw-маркерів бібліотеки.
Експортовано — переюз у `adopt/main.mjs`.
- APP_STORIES_GLOB — Stories-glob для app-проєктів (хвиля 2a) — фіксований, без layout-детекції бібліотек:
сторінки (`src/pages/`) і сусідні `*.stories.js` живуть у довільних піддиректоріях `src/`.
- EMPTY_VITE_CONFIG_MARKERS — Маркери канону `.storybook/empty-vite.config.js` (сусідній файл main.js — стенд-ін для
`core.builder.options.viteConfigPath`, блокує autodiscovery `vite.config` пакета
`@storybook/builder-vite`-ом). Експортовано — переюз у `adopt/main.mjs`.
- detectStoriesGlob — Layout-детекція для stories-glob (ADR Кластер 2, розширено пілотом на flat-root):
`.vue`-файли прямо в корені пакета (без `src/`) → flat-root glob по корені;
інакше `src/components/` присутній → glob звужується до нього; інакше — ширший
glob по всьому `src/`. Шлях відносний до `.storybook/` (де лежить сам `main.js`),
тому з префіксом `../`.
- lint — Перевіряє канонічний Storybook-скафолд (`.storybook/main.js`, `.storybook/preview.js`,
`package.json#scripts.storybook`) для всіх пакетів у скоупі (`scope/main.mjs`), розгалужено
за типом пакета (`library`/`app`).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
