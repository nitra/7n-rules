---
type: JS Module
title: fix-vitest-config.mjs
resource: plugins/lang-js/rules/storybook/vitest-config/fix-vitest-config.mjs
docgen:
  crc: b3961bc2
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл детерміновано приводить `vitest.config.mjs` у Vue-компонентних пакетах із Storybook до канону `test.projects`: окремі проєкти `unit` і `storybook`, а browser-mode обмежує лише `chromium`. Для Stryker він генерує ізольований `vitest.stryker.config.*` у межах того ж пакета, згідно з підходом з `ADR Кластер 5`.

Для вже наявного `vitest.config.mjs` зміни вносяться точковими `string-splice`-ами лише на вставку, щоб не переписувати решту форматування й коментарів; після цього конфіг повторно парситься, і зміни відкочуються, якщо результат невалідний. Логіка побудови покладена на `buildFreshVitestConfig`, `buildStrykerConfig` і `patterns`, а читання й аналіз виконуються через `oxc-parser`. Детектор `main.mjs` працює read-only, тоді як запис зосереджений у `fix-stryker_config.mjs`.

## Поведінка

- `buildFreshVitestConfig` — створює новий `vitest.config.mjs` для пакета з канонічним `test.projects` для `unit` і `storybook`, підставляє шлях до локального Vite-конфіга та сторінковий glob для Storybook.
- `buildStrykerConfig` — генерує ізольований `vitest.stryker.config.*` на основі canonical baseline-шаблону для того самого пакета, підставляючи шлях до локального Vite-конфіга.
- `patterns` — описує autofix-сценарій, який реагує на відсутній або неканонічний vitest-конфіг, доповнює наявний файл без переписування зайвого форматування та створює `vitest.stryker.config.*` у відповідному package root.

## Публічний API

- buildFreshVitestConfig — Генерує повністю новий `vitest.config.mjs` (unit+storybook projects) для
пакета без жодного наявного vitest-конфіга. Експортовано — переюз у
`adopt/main.mjs` (генерація лише для повністю відсутніх файлів).
- buildStrykerConfig — Генерує ізольований `vitest.stryker.config.*` (той самий basename/ext що
й основний vitest-конфіг пакета) з canonical baseline-шаблону. Експортовано —
переюз у `adopt/main.mjs`.
- patterns — повертає набір шаблонів, які використовуються для зіставлення й обробки відповідних випадків у коді

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
