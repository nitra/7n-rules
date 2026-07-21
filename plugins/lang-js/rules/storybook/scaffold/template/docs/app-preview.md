---
type: JS Module
title: app-preview.js
resource: plugins/lang-js/rules/storybook/scaffold/template/app-preview.js
docgen:
  crc: 9ba42352
  model: openai-codex/gpt-5.4-mini
  score: 90
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний `.storybook/preview.js` для app-проєктів: задає fullscreen-розкладку, підключає `msw-storybook-addon` і worker `.storybook/public/mockServiceWorker.js`, який ставиться через `bunx msw init .storybook/public --no-save`. Для GraphQL-історій використовує мережеві моки, а app-специфічний `apolloPlugin` підключає сам story-файл. `pageLoader` будує для кожної історії окремі `router` і `pinia` з `parameters.route` та `parameters.pinia` ДО mount; `await router.isReady` прибирає перший рендер без `route.params`, `createPinia` працює без `pinia-plugin-persistedstate`, а стан сідиться через `structuredClone`.

## Поведінка

1. Піднімає канонічне Storybook-оточення для app-проєктів із fullscreen-розкладкою.
2. Підключає мережеве мокування через `msw-storybook-addon`, щоб історії працювали з реальними GraphQL-запитами, але без звернення до бекенда.
3. Мовчки пропускає незамокані `GET`-запити до того ж origin, щоб не заважати dev-asset’ам і модульним ресурсам; про інші незамокані API-виклики попереджає.
4. Перед рендером сторії збирає сторінковий runtime-контекст: router — якщо задано маршрут, Pinia — якщо задано початковий стан.
5. Для сторінок гарантує готовність `route.params` уже на перший рендер, щоб UI стартував у правильному стані без проміжного порожнього кадру.
6. Для стану сторії підставляє окремий Pinia-інстанс без persistence-плагіна, щоб не було читання чи запису в localStorage під час перегляду.
7. Реєструє Quasar і потрібні layout-компоненти явно, щоб сторінки з `q-page` коректно працювали в runtime-template середовищі Storybook.
8. Якщо story надала router або pinia через параметри, підключає їх до застосунку саме для цієї історії.
9. Виставляє універсальну поведінку для всіх історій: full-screen показ і підготовлені loaders для моків та сторінкового контексту.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
