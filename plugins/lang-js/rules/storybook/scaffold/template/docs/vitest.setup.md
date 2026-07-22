---
type: JS Module
title: vitest.setup.js
resource: plugins/lang-js/rules/storybook/scaffold/template/vitest.setup.js
docgen:
  crc: 55eba5ca
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Setup-файл для `vitest`-проєкту `storybook`, підключений через `test.projects[].test.setupFiles`, щоб `vitest run --project=storybook` у `browser-mode` на `chromium` підхоплював decorators, loaders і parameters з `.storybook/preview.js`. Це стандартний `@storybook/addon-vitest` boilerplate для офіційної інтеграції Storybook+Vitest: без нього browser-тести не підключають анотації Storybook. Однаковий для `library`- і `app`-пакетів, не залежить від типу пакета, і відтворюється через `npx @7n/rules fix storybook`, якщо файл втрачено або пошкоджено.

## Поведінка

1. Підготовляє browser-тести Storybook так, щоб вони працювали з тими самими анотаціями, що й сам Storybook.
2. Під’єднує конфігурацію preview до vitest-проєкту `storybook`, щоб у тестах були доступні decorators, loaders і parameters з `.storybook/preview.js`.
3. Робить це однаково для library- і app-пакетів, без прив’язки до конкретного типу пакета.
4. Дає змогу `vitest run --project=storybook` запускати browser-mode тести з повною Storybook-обв’язкою.
5. Не виконує власних записів у файлову систему чи базу даних.
6. Відтворюється канонічним правилом `storybook`, тому при втраті або пошкодженні може бути згенерований заново.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
