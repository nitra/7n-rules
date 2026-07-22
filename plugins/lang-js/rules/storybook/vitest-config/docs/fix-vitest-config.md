---
type: JS Module
title: fix-vitest-config.mjs
resource: plugins/lang-js/rules/storybook/vitest-config/fix-vitest-config.mjs
docgen:
  crc: 4bae4173
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл приводить vitest-конфіг Vue-компонентної бібліотеки у скоупі Storybook до канону `test.projects`: окремі проєкти `unit` і `storybook`, `browser-mode` лише `chromium`. Для наявного конфіга він застосовує `insert-only` string-splice, щоб додати відсутні фрагменти без переписування решти форматування й коментарів; після зміни виконує повторний parse через `oxc-parser` і робить rollback, якщо результат невалідний.

Файл також створює ізольований `vitest.stryker.config.*` для Stryker за ADR Кластер 5. Detector `main.mjs` залишається read-only: читання, аналіз через `oxc-parser` і запис зосереджені у fixer.

Публічні точки поведінки: `buildFreshVitestConfig` формує канонічний vitest-конфіг з нуля, `buildStrykerConfig` формує окремий Stryker-конфіг, `patterns` описує цільові файли для застосування autofix.

## Поведінка

- `buildFreshVitestConfig` створює канонічний `vitest.config.mjs` для пакета без наявного vitest-конфіга, додаючи `unit` і `storybook` projects та узгоджений glob для stories.
- `buildStrykerConfig` генерує ізольований `vitest.stryker.config.*` на основі baseline-шаблону з урахуванням наявного `vite.config.*` або безпечного placeholder для source-only пакета.
- `patterns` описує T0-autofix, який для релевантних порушень доповнює або створює vitest-конфіг і додає відсутній Stryker-конфіг, не переписуючи зайве форматування наявного файлу.

## Публічний API

- buildFreshVitestConfig — Генерує повністю новий `vitest.config.mjs` (unit+storybook projects) для
пакета без жодного наявного vitest-конфіга. Експортовано — переюз у
`adopt/main.mjs` (генерація лише для повністю відсутніх файлів).
- buildStrykerConfig — Генерує ізольований `vitest.stryker.config.*` (той самий basename/ext що
й основний vitest-конфіг пакета) з canonical baseline-шаблону. Експортовано —
переюз у `adopt/main.mjs`.
- patterns — формує набір шаблонів для добору файлів, які мають потрапити в обробку.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
