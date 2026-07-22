---
type: JS Module
title: app-storybook-project-entry.js
resource: plugins/lang-js/rules/test/storybook-vitest-config/template/app-storybook-project-entry.js
docgen:
  crc: bd910b26
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний запис `storybook` у `test.projects` для APP-пакетів: окремий `browser-mode/chromium` проєкт у тому самому каркасі, що й `storybook-project-entry.js`, але з власними `quasar`, `AutoImport` і `Pages` замість голого `extends: true`.  
Це потрібно, бо батьківський `baseVite` у `vitest.config.js` свідомо прибирає `vite:quasar`, `unplugin-auto-import` і `vite-plugin-pages` через `STRIPPED_PREFIXES`, а сторінки з `<route lang="yaml">` мають бачити `src/css/quasar.variables.scss` і обробку `route.lang=yaml`; саме цей мінімальний набір `fix-vitest-config.mjs` читає з `export default {...}`, а проєктні доповнення додаються вже поверх нього.

## Поведінка

1. Описує канонічний `storybook`-проєкт для `test.projects` у APP-пакетах як окремий browser-mode запис для Storybook-сторінок.
2. Зберігає спільний каркас із бібліотечним Storybook-записом, але додає плагіни, потрібні саме для APP-сценаріїв: Quasar, auto-import і Pages.
3. Підключає Quasar-конфігурацію, щоб Storybook-сторінки отримували потрібні стилі та змінні теми з проєктного SCSS-контексту.
4. Підключає auto-import для Vue, router, Quasar і Pinia, щоб сторінки могли використовувати типові composables та хелпери без ручних імпортів.
5. Підключає Pages, щоб сторінки з route-описом коректно працювали в Storybook і не ламалися через відсутність обробника route-блоків.
6. Встановлює запуск у Chromium у headless-режимі, щоб тестовий прогін був придатним для CI.
7. Призначає окремий setup-файл для Storybook, щоб зберігати проєктну ініціалізацію тестового середовища в одному місці.
8. Дозволяє поверх базового набору вручну додавати проєктні auto-import-и, якщо Storybook-сторінкам потрібні додаткові composables або boot-залежності.
9. Описує лише конфігураційний запис, який читає інший інструмент.

## Гарантії поведінки

- У файлі немає власних операцій запису; виклики імпортованих модулів можуть мати побічні ефекти.
