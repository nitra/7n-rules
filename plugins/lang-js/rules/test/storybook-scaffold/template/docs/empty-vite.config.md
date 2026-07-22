---
type: JS Module
title: empty-vite.config.js
resource: plugins/lang-js/rules/test/storybook-scaffold/template/empty-vite.config.js
docgen:
  crc: f351d6d7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний порожній Vite-конфіг для `core.builder.options.viteConfigPath` у `.storybook/main.js`. Він потрібен, щоб `@storybook/builder-vite` не знаходив пакетний `vite.config.js` через `loadConfigFromFile`, не додавав у merge нефільтровані плагіни (`vue`, обгорнутий VueMacros/unplugin-auto-import) і не робив це ще до `viteFinal`. Через `mergeConfig` масив `plugins` конкатенується, тому фільтр у `viteFinal` лише додає ще один `@vitejs/plugin-vue`, а не прибирає вже змерджений дублікат. Без цього файла `storybook build` падає на кожному `.vue` з `At least one <template> or <script> is required`; `dev --smoke-test` цього не ловить, перевірка проявляється лише в повному build. `npx @7n/rules fix storybook` відтворює цей файл, якщо його видалено або зламано канон.

## Поведінка

1. Забезпечує канонічний порожній Vite-конфіг для Storybook-збирання, щоб `viteConfigPath` вказував на контрольований файл, а не на випадковий `vite.config.js` пакета.
2. Запобігає автоматичному підтягуванню пакетного Vite-конфіга `@storybook/builder-vite`, яке може непомітно додати зайві плагіни до збірки.
3. Усуває ризик подвійної трансформації Vue-компонентів під час `storybook build`, через яку збірка падає на `.vue`-файлах.
4. Підтримує відтворюваність канону: якщо файл видалено або зіпсовано, команда `npx @7n/rules fix storybook` відновлює його до очікуваного стану.
5. Не додає власної поведінки обробки даних чи побічних ефектів — файл лише фіксує безпечну точку входу для Storybook.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
