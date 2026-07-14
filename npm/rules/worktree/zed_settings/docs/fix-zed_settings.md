---
type: JS Module
title: fix-zed_settings.mjs
resource: npm/rules/worktree/zed_settings/fix-zed_settings.mjs
docgen:
  crc: 452faa10
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає правило `patterns` для перевірки очікуваних налаштувань проєкту. Код спирається на конфіг `settings.json` і працює read-only, щоб описати вимоги до конфігурації без самостійного внесення змін.

## Поведінка

1. `patterns` визначає правило автоматичного приведення робочого дерева до очікуваного шаблону налаштувань Zed.

2. `patterns` орієнтується на конфіг `settings.json`, щоб забезпечити наявність і узгодженість `.zed/settings.json` у проєкті.

3. `patterns` не змінює файлову систему самостійно; воно лише описує поведінку виправлення для зовнішнього механізму застосування правил.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
