---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/rego/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: ee88ec44
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає `patterns` для приведення settings.json до узгодженого вигляду в проєкті, щоб налаштування редактора залишалися однаковими між середовищами. Він працює лише з цим конфігом, є read-only і не вносить змін у ФС чи БД; застосування результату лишається зовнішньому кроку.

## Поведінка

1. `patterns` формує набір правил для приведення `.vscode/settings.json` до узгодженого шаблону `rego-vscode_settings-template`.
2. `patterns` працює лише з конфігурацією редактора, спираючись на `settings.json`, щоб підтримувати однакові налаштування в проєкті.
3. `patterns` не виконує записів у ФС чи БД; результатом є опис поведінки для застосування змін зовні.
4. `patterns` охоплює лише вказаний цільовий файл і не заявляє перевірку інших шляхів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
