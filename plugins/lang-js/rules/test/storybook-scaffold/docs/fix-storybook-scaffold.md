---
type: JS Module
title: fix-storybook-scaffold.mjs
resource: plugins/lang-js/rules/test/storybook-scaffold/fix-storybook-scaffold.mjs
docgen:
  crc: 10336699
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:detectStoriesGlob,judge:inaccurate:0.95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відновлює канонічні Storybook-артефакти для concern-а `storybook/scaffold`: створює відсутні `.storybook/main.js`, `.storybook/preview.js`, `.storybook/mocks/gql-sse.js` і синхронізує `package.json#scripts.storybook` за шаблоном concern-а. `main.js` відновлюється з однією заміною для конкретного пакета — stories-glob за layout-детекцією (`detectStoriesGlob`, `main.mjs`); `preview.js` і `.storybook/mocks/gql-sse.js` відновлюються як verbatim-копії, однакові для всіх пакетів. Це потрібно, щоб привести пакет до канонічного Storybook-стану concern-а. Код працює fail-safe і не кидає винятків назовні; конфіги, на які спирається код: package.json

## Поведінка

1. `patterns` запускає два окремі відновлювальні сценарії для Storybook: один для відсутніх `.storybook/main.js` і `.storybook/preview.js`, інший — для відсутнього `scripts.storybook` у `package.json`.
2. Для кожного пакета з проблемою `missing-main-js` створює `.storybook/main.js` за шаблоном concern-а, підставляючи пакетний stories glob відповідно до layout-перевірки.
3. Для того ж пакета за потреби створює `.storybook/mocks/gql-sse.js` як канонічну копію з шаблону; якщо файл уже є, не перезаписує його.
4. Для кожного пакета з проблемою `missing-preview-js` створює `.storybook/preview.js` як канонічну копію з шаблону concern-а.
5. Для кожного `package.json` з проблемою `missing-storybook-script` додає або оновлює `scripts.storybook` до канонічного значення; якщо JSON не читається, запис пропускається без падіння.
6. Усі зміни застосовуються лише там, де доступний корінь concern-а або шлях до файлу, тож autofix працює fail-safe і не зупиняє весь прогін через одну некоректну ціль.
7. Орієнтується на `package.json` як на конфігураційне джерело для скрипта Storybook.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
