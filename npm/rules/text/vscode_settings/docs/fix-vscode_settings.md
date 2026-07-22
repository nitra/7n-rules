---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/text/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: 7208a85f
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 100
---

## Огляд

Файл забезпечує нормалізацію файлу `settings.json` шляхом застосування deep-merge шаблону правила. Призначений для внесення змін до конфігурації з дотриманням структури, зберігаючи ізоляцію від налаштувань користувача.

## Поведінка

1. Застосування шаблону deep-merge для нормалізації файлу settings.json
2. Виконання deep-merge з шаблоном правила
3. Забезпечення ізоляції від локальних налаштувань користувача

## Публічний API

- patterns — Fix-патерни концерну: один шаблонний deep-merge у `.vscode/settings.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
