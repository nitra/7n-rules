---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/text/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: 7208a85f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл задає автоматичне виправлення для `.vscode/settings.json` у межах концерну `text/vscode_settings`. Він існує, щоб доводити workspace-налаштування до канону через `deep-merge` шаблону правила, зберігаючи локальні користувацькі значення.

## Поведінка

1. `patterns` оголошує єдиний fix-патерн для приведення `settings.json` до проєктного канону.

2. Патерн застосовує шаблон правила як deep-merge, щоб додати або оновити обов’язкові налаштування без перетирання локальних користувацьких значень.

3. Результат призначений для автоматичного виправлення відхилень у VS Code workspace-конфігурації в межах концерну `text/vscode_settings`.

## Публічний API

- patterns — Fix-патерни концерну: один шаблонний deep-merge у `.vscode/settings.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
