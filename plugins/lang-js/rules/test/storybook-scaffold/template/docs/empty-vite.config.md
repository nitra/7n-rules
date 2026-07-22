---
type: JS Module
title: empty-vite.config.js
resource: plugins/lang-js/rules/storybook/scaffold/template/empty-vite.config.js
docgen:
  crc: 5c9f8904
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний порожній `Vite`-конфіг як стенд-ін для `core.builder.options.viteConfigPath` у `.storybook/main.js`. Його відсутність або поломка змушує `@storybook/builder-vite` через `loadConfigFromFile` знайти пакетний `vite.config.js` і додатково змішати нефільтровані плагіни ще до `viteFinal`; `mergeConfig` конкатенує масиви `plugins`, тож фільтр у `viteFinal` не прибирає вже доданий дублікат `@vitejs/plugin-vue`, а лише додає ще один. Без цього файлу `storybook build` падає на кожному `.vue` з `At least one <template> or <script> is required` через подвійну SFC-трансформацію; `dev --smoke-test` цього не виявляє, це підтверджує лише повний `build`. `npx @7n/rules fix storybook` відтворює цей файл, якщо він видалений або зламаний канон.

## Поведінка

1. Файл виступає канонічним порожнім `Vite`-конфігом для `storybook` і використовується як явна точка підключення в `core.builder.options.viteConfigPath`.
2. Якщо канон пошкоджено або файл зник, `npx @7n/rules fix storybook` відтворює його, щоб зберегти узгоджений режим збірки.
3. Файл не додає власної поведінки до `Vite`-збірки; його роль — заблокувати неявне підхоплення пакетного `vite.config.js` з боку `@storybook/builder-vite`.
4. Це прибирає ризик домішування сторонніх `Vite`-плагінів у `storybook build`, які інакше можуть бути обʼєднані до `viteFinal` і спричинити подвійну обробку `Vue`-компонентів.
5. Завдяки цьому `storybook build` поводиться стабільно на `.vue`-файлах у бібліотеках компонентів; без такого стенд-іну повний build може падати, тоді як `dev --smoke-test` цього не виявляє.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
