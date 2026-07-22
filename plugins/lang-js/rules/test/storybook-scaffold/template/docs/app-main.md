---
type: JS Module
title: app-main.js
resource: plugins/lang-js/rules/test/storybook-scaffold/template/app-main.js
docgen:
  crc: 0b1952f8
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний `.storybook/main.js` для app-проєктів, який відтворюється правилом `storybook` через `npx @7n/rules fix storybook`. Конфігурація свідомо лишає `@storybook/builder-vite` працювати з повним `vite.config.js` застосунку, щоб зберегти `VueMacros`/`$ref`, `unplugin-auto-import` і `quasar` без окремих інстансів у `viteFinal`. У `viteFinal` прибираються лише `vite-plugin-pages`, `vite-plugin-vue-layouts`/`-next` і `unplugin-vue-router`, а сторінки в stories підхоплюються напряму через `pageLoader` із `.storybook/preview.js`.

## Поведінка

1. Створює канонічну Storybook-конфігурацію для app-проєктів, щоб `npx @7n/rules fix storybook` міг відновити її після видалення або пошкодження.
2. Підключає Storybook для Vue 3 у Vite-оточенні та відкриває доступ до публічних статичних assets, потрібних для service worker у Storybook.
3. Спирається на повний `vite.config.js` застосунку, щоб зберегти build-time можливості сторінок, зокрема макроси та інші проєктні налаштування, без окремого дублювання інстансів у Storybook.
4. Навмисно не використовує окремий обхід для `viteConfigPath`, бо для app-проєктів це зайве і може зашкодити узгодженості з основним build-оточенням.
5. Перед запуском Storybook прибирає з Vite-конфігурації плагіни file-system routing, щоб сторінка в stories підключалася напряму, а маршрут для неї формувався через окремий loader у preview.
6. Зберігає цю поведінкову межу тільки для routing-плагінів консюмера; інші проєктні налаштування Vite залишає без втручання.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
