---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-scaffold/main.mjs
docgen:
  crc: 8c8f8885
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл формує lint-діагностику для Storybook-пакетів: звіряє npm-script `STORYBOOK_SCRIPT`, marker-групи `MAIN_JS_MARKERS`, `PREVIEW_JS_MARKERS`, `APP_*`, `EMPTY_VITE_CONFIG_MARKERS`, `VITEST_SETUP_JS_MARKERS` і stories-glob `APP_STORIES_GLOB` для library та app layout. `detectStoriesGlob`, `missingMarkers` і `lint` існують, щоб відсутні файли, маркери й неправильний script повертались як стабільні порушення без змін у файловій системі та без винятків назовні; за певних помилок перевірка fail-safe повертає порожнє значення, зокрема `null`.

## Поведінка

`lint` отримує контекст перевірки, визначає Storybook-пакети зі scope і для кожного звіряє канонічний скафолд із фактичними файлами та `package.json`. Результати не записуються у файлову систему: усі невідповідності повертаються як lint-порушення, а помилки обробляються fail-safe без винятків назовні.

Для бібліотек перевіряються `MAIN_JS_MARKERS`, `PREVIEW_JS_MARKERS` і `EMPTY_VITE_CONFIG_MARKERS`; для app-пакетів — `APP_MAIN_JS_MARKERS` і `APP_PREVIEW_JS_MARKERS`. `VITEST_SETUP_JS_MARKERS` описує очікувану інтеграцію setup-файлу для сценаріїв, де Storybook має працювати узгоджено з тестовим оточенням. Маркери повідомлень `` потрібні, щоб відрізняти канонічні фрагменти від локальних варіацій і давати стабільні підказки для автоматичного виправлення.

`detectStoriesGlob` підбирає stories-glob за layout пакета: flat-root `.vue`-компоненти мають пріоритет, далі використовується вузький шлях для компонентів у `src/components`, і лише за його відсутності — ширший пошук у `src`. Для app-сценарію окремо закріплено `APP_STORIES_GLOB="../src/**/*.stories.@(js|ts)"`, щоб app-проєкти не залежали від бібліотечної структури.

`missingMarkers` є спільним механізмом порівняння очікуваних маркерів із вмістом файлів: він повертає тільки відсутні канонічні ознаки, після чого `lint` перетворює їх на діагностику. Відсутні файли й відсутні маркери трактуються окремо, щоб користувач бачив, чи треба створити scaffold, чи лише привести існуючий файл до канону.

`STORYBOOK_SCRIPT="storybook dev -p 6006 --no-open"` задає канонічний npm-script для локального запуску Storybook, а `package.json` є джерелом перевірки цього script у кожному пакеті. Для app-пакетів свідомо не вимагається stand-in Vite-конфіг, бо вони мають використовувати власний повний Vite-конфіг проєкту.

## Публічний API

- STORYBOOK_SCRIPT — Канонічне значення `package.json#scripts.storybook` (storybook.mdc).
- MAIN_JS_MARKERS — Маркери канону `.storybook/main.js`, перевірені текстовим пошуком (без AST — рядки стабільні).
  Експортовано — той самий список переюзає `adopt/main.mjs` для diff-діагностики (не дублювати).
- PREVIEW_JS_MARKERS — Маркери канону `.storybook/preview.js`. Експортовано — переюз у `adopt/main.mjs`.
- APP_MAIN_JS_MARKERS — Маркери канону `.storybook/main.js` для app-проєктів (хвиля 2a) — свідома дзеркальна
  асиметрія з {@link MAIN_JS_MARKERS} бібліотек: тут немає `viteConfigPath`, бо
  `@storybook/builder-vite` навмисно підхоплює ПОВНИЙ `vite.config.js` app-проєкту
  (ADR-розширення 2026-07-20, прототип `gt`). `vite-plugin-pages` СВІДОМО НЕ фільтрується
  (окремий канон-фікс, емпірично перевірено на `gt`) — знімається лише
  `unplugin-vue-router`/`vite-plugin-vue-layouts`/`-next`, реальні layout/router-генератори;
  `vite-plugin-pages` обробляє custom-блок `<route lang="yaml">` сторінок, без нього
  `storybook build` падає глобально (`MISSING_EXPORT` на будь-якому `.vue` з таким блоком,
  деталі — коментар `scaffold/template/app-main.js`). Експортовано — переюз у `adopt/main.mjs`.
- APP_PREVIEW_JS_MARKERS — Маркери канону `.storybook/preview.js` для app-проєктів (хвиля 2a): `pageLoader`
  (router+pinia на кожну story) і явна реєстрація `QLayout`/`QPageContainer` для
  layout-декоратора story-файлу — на додачу до спільних msw-маркерів бібліотеки.
  Експортовано — переюз у `adopt/main.mjs`.
- APP_STORIES_GLOB — Stories-glob для app-проєктів (хвиля 2a) — фіксований, без layout-детекції бібліотек:
  сторінки (`src/pages/`) і сусідні `*.stories.js` живуть у довільних піддиректоріях `src/`.
- EMPTY_VITE_CONFIG_MARKERS — Маркери канону `.storybook/empty-vite.config.js` (сусідній файл main.js — стенд-ін для
  `core.builder.options.viteConfigPath`, блокує autodiscovery `vite.config` пакета
  `@storybook/builder-vite`-ом). Експортовано — переюз у `adopt/main.mjs`.
- VITEST_SETUP_JS_MARKERS — Маркери канону `.storybook/vitest.setup.js` — той самий файл для ОБОХ типів пакета
  (library/app, хвиля 2a): стандартний `@storybook/addon-vitest`-boilerplate, підключає
  анотації `.storybook/preview.js` (decorators/loaders/parameters) до `vitest run
--project=storybook` через `setupProjectAnnotations`. Без нього `storybook`-vitest-проєкт
  (`vitest-config`-концерн, `setupFiles: ['.storybook/vitest.setup.js']`) не підключає ці
  анотації взагалі — знайдено на живому пілоті gt (файл раніше був відсутній у шаблонах,
  хоча `storybook-project-entry.js` уже посилався на нього). Експортовано — переюз у
  `adopt/main.mjs`.
- detectStoriesGlob — Layout-детекція для stories-glob (ADR Кластер 2, розширено пілотом на flat-root):
  `.vue`-файли прямо в корені пакета (без `src/`) → flat-root glob по корені;
  інакше `src/components/` присутній → glob звужується до нього; інакше — ширший
  glob по всьому `src/`. Шлях відносний до `.storybook/` (де лежить сам `main.js`),
  тому з префіксом `../`.
- lint — Перевіряє канонічний Storybook-скафолд (`.storybook/main.js`, `.storybook/preview.js`,
  `package.json#scripts.storybook`) для всіх пакетів у скоупі (`scope/main.mjs`).
- missingMarkers — знаходить відсутні обов’язкові згадки у тексті правила Storybook, щоб повідомлення містили потрібні орієнтири для налаштування.

Експортовані константи-рядки: STORYBOOK_SCRIPT="storybook dev -p 6006 --no-open" задає очікувану команду запуску Storybook, APP_STORIES_GLOB="../src/\*_/_.stories.@(js|ts)" задає шаблон пошуку stories у застосунку.

Поведінка спирається на package.json і вимагає, щоб повідомлення правила містили маркери (storybook.mdc) для швидкого виявлення неповної документації або підказок.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
