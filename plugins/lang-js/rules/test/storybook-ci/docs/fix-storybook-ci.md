---
type: JS Module
title: fix-storybook-ci.mjs
resource: plugins/lang-js/rules/test/storybook-ci/fix-storybook-ci.mjs
docgen:
  crc: 877b9feb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порожній шаблон `storybook/ci`, з якого відтворюються репо-рівневі CI-артефакти: `setup-playwright-chromium` як verbatim-копія composite action для Playwright Chromium і `.github/workflows/lint-storybook.yml` із матрицею `strategy.matrix.package`, згенерованою з фактичного списку пакетів через `collectInScopeVuePackages`. Публічні anchors: `TEMPLATE_DIR`, `renderPlaywrightAction`, `renderPackageDirsYaml`, `renderStorybookWorkflow`, `patterns`.

## Поведінка

- **TEMPLATE_DIR** — вказує на каталог `template/` цього concern-а як джерело канонічних CI-шаблонів.
- **renderPlaywrightAction** — читає канонічний composite action `setup-playwright-chromium` із шаблону без змін.
- **renderPackageDirsYaml** — перетворює список коренів пакетів у YAML-рядки для матриці Storybook CI.
- **renderStorybookWorkflow** — збирає канонічний `.github/workflows/lint-storybook.yml`, підставляючи в нього матрицю пакетів зі скоупу репозиторію.
- **patterns** — описує T0-правила автофіксу для відновлення відсутніх CI-файлів цього concern-а.

## Публічний API

- TEMPLATE_DIR — Каталог `template/` цього concern-а.
- renderPlaywrightAction — Вміст канонічного composite action `setup-playwright-chromium` — verbatim з template.
- renderPackageDirsYaml — Рендерить YAML-фрагмент `matrix.package` списку — по одному `- <rootDir>` на рядок, з тим
  самим відступом, що й токен-рядок у шаблоні (10 пробілів — рівень елемента списку під
  `strategy.matrix.package:`). `rootDir === '.'` (корінь монорепо) лишається `.` — валідний
  `working-directory` для GitHub Actions.
- renderStorybookWorkflow — Вміст канонічного `.github/workflows/lint-storybook.yml` — template з підставленою
  матрицею пакетів у скоупі.
- patterns — повертає набір шаблонів, за якими далі шукають або зіставляють потрібні значення.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
