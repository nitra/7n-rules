---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/worktree/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: e68a8ed3
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає `patterns` для визначення конфігураційних файлів, на які має зважати перевірка робочого дерева. Спирається на конфіги: settings.json.

## Поведінка

1. `patterns` визначає правило виправлення для робочого дерева, яке підтримує наявність очікуваного VS Code-конфігу `settings.json`.

2. `patterns` спрямовує перевірку на `.vscode/settings.json`, щоб проєкт мав узгоджені налаштування редактора для всіх учасників.

3. `patterns` не змінює файлову систему самостійно; воно лише описує доступний шаблон виправлення для зовнішнього механізму застосування правил.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
