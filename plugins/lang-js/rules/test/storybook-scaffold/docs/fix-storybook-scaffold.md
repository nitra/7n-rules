---
type: JS Module
title: fix-storybook-scaffold.mjs
resource: plugins/lang-js/rules/test/storybook-scaffold/fix-storybook-scaffold.mjs
docgen:
  crc: 2cbe123e
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Відновлює канонічний Storybook scaffold з `template/` цього concern-а: `.storybook/main.js`, `.storybook/preview.js`, `.storybook/mocks/gql-sse.js` і `package.json#scripts.storybook`, щоб повернути згенеровані Storybook-файли до очікуваного стану, на який спирається `package.json#scripts.storybook`.

## Поведінка

- TEMPLATE_DIR — вказує на каталог `template/` цього concern-а, звідки беруться канонічні шаблони для відтворення Storybook scaffold.
- renderMainJs — відтворює канонічний `.storybook/main.js` для пакета, підставляючи пакетний `stories glob` замість шаблонного маркера.
- renderPreviewJs — повертає канонічний `.storybook/preview.js` як verbatim-копію з `template/`.
- renderMocksGqlSse — повертає канонічний `.storybook/mocks/gql-sse.js` як verbatim-копію з `template/`.
- renderAppMainJs — відтворює канонічний `.storybook/main.js` для app-проєктів із фіксованим `stories glob` для сторінкової структури.
- renderAppPreviewJs — повертає канонічний `.storybook/preview.js` для app-проєктів як verbatim-копію з `template/`.
- renderEmptyViteConfig — повертає канонічний `.storybook/empty-vite.config.js` як verbatim-копію з `template/` для прив’язки до `main.js`.
- patterns — описує T0-autofix-и, які відновлюють відсутні Storybook-файли та `package.json#scripts.storybook` у пакетах, а при потребі також створюють допоміжний `empty-vite.config.js`.

## Публічний API

- TEMPLATE_DIR — Каталог `template/` цього concern-а. Експортовано — переюз у `adopt/main.mjs`.
- renderMainJs — Рендерить канонічний `.storybook/main.js` для конкретного пакета (єдина заміна —
  stories-glob за layout-детекцією). Експортовано — той самий рендер переюзає
  `adopt/main.mjs` для генерації повністю відсутнього файлу (не дублювати шаблонування).
- renderPreviewJs — Вміст канонічного `.storybook/preview.js` — verbatim з template (не залежить від пакета).
  Експортовано — переюз у `adopt/main.mjs`.
- renderMocksGqlSse — Вміст канонічного `.storybook/mocks/gql-sse.js` — verbatim з template. Експортовано —
  переюз у `adopt/main.mjs`.
- renderAppMainJs — Рендерить канонічний `.storybook/main.js` для app-проєкту (хвиля 2a) — фіксований
  {@link APP_STORIES_GLOB} (без layout-детекції бібліотек: пер-сторінкова структура
  `src/pages/` не потребує розрізнення `src/components/`). Експортовано — переюз у
  `adopt/main.mjs`.
- renderAppPreviewJs — Вміст канонічного `.storybook/preview.js` для app-проєкту (хвиля 2a) — verbatim з
  template (`pageLoader`/QLayout-реєстрація не залежать від конкретного app-пакета).
  Експортовано — переюз у `adopt/main.mjs`.
- renderEmptyViteConfig — Вміст канонічного `.storybook/empty-vite.config.js` — verbatim з template (порожній
  стенд-ін для `core.builder.options.viteConfigPath` у `main.js`, не залежить від пакета).
  Експортовано — переюз у `adopt/main.mjs`.
- patterns — повертає набір шаблонів, які використовуються для відбору файлів/шляхів за правилами конфігурації

Конфіги, на які спирається код: package.json

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
