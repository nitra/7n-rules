---
type: JS Module
title: main.mjs
resource: plugins/lang-php/rules/php/tooling/main.mjs
docgen:
  crc: eb9acef9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): перевіряє
лише кореневий `composer.json`/`package.json` (свідоме обмеження — деталі в `tooling.mdc`).

## Поведінка

Метод lint перевіряє наявність у кореневому каталозі файлів composer.json та package.json. Якщо ці файли відсутні, повідомляється про порушення відповідно до конфігурації php.mdc. Результат роботи методу полягає у підтвердженні наявності необхідних конфігураційних файлів, необхідних для роботи з проектом.

## Публічний API

- lint — Перевіряє відповідність проєкту правилам php.mdc.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
